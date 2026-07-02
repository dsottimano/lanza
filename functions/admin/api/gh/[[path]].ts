// GitHub API proxy — Cloudflare Pages Function.
//
// The Lanza CMS SPA talks to `/admin/api/gh/*` instead of api.github.com so the
// GitHub token NEVER reaches the browser or the build output. This Function runs
// at the edge, forwards the request to https://api.github.com verbatim, and
// injects `Authorization: Bearer <GITHUB_TOKEN>` from a Cloudflare Pages runtime
// secret. The whole /admin/* path (this route included) is already gated by
// Cloudflare Zero Trust (Access), so only authorized editors reach it.
//
// Set the secret in the Pages project: Settings → Variables → GITHUB_TOKEN
// (encrypted). A fine-grained PAT with Contents: read/write on the repo.

import {
  FORWARD_REQUEST_HEADERS,
  STRIP_RESPONSE_HEADERS,
  crossOriginBlocked,
  isAllowed,
} from "../../../_lib/gh-proxy";

interface Env {
  GITHUB_TOKEN?: string;
}

const GITHUB_API = "https://api.github.com";

export const onRequest = async (context: {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
}): Promise<Response> => {
  const { request, env, params } = context;

  if (!env.GITHUB_TOKEN) {
    return json(500, {
      message:
        "GitHub proxy is not configured: the GITHUB_TOKEN secret is missing on the server.",
    });
  }

  // `[[path]]` catch-all → array of path segments after /admin/api/gh/.
  const seg = params.path;
  const subPath = Array.isArray(seg) ? seg.join("/") : (seg ?? "");
  const url = new URL(request.url);

  // Enforce the method+path allowlist BEFORE attaching the token: only the
  // endpoints the CMS actually calls, on this one repo, are reachable.
  if (!isAllowed(request.method, subPath)) {
    return json(403, {
      message: `Blocked by proxy allowlist: ${request.method} /${subPath} is not a permitted GitHub endpoint.`,
    });
  }

  // CSRF guard: a cross-origin write from an authenticated editor's browser is
  // rejected. Access gates the route; this stops a malicious page riding along.
  if (crossOriginBlocked(request.method, request.headers.get("origin"), url.host)) {
    return json(403, { message: "Cross-origin write rejected." });
  }

  const target = `${GITHUB_API}/${subPath}${url.search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Authorization", `Bearer ${env.GITHUB_TOKEN}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/vnd.github+json");
  // GitHub requires a User-Agent on every request.
  headers.set("User-Agent", "lanza-cms");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  });

  // Return GitHub's response, stripping headers that won't survive
  // re-serialization plus token-scope / rate-limit headers we don't leak.
  const respHeaders = new Headers(upstream.headers);
  for (const name of STRIP_RESPONSE_HEADERS) respHeaders.delete(name);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
