// Cloudflare API proxy — Cloudflare Pages Function.
//
// The Lanza CMS SPA talks to `/admin/api/cf/*` instead of api.cloudflare.com so
// the Cloudflare API token NEVER reaches the browser or the build output. This
// Function runs at the edge, resolves the `self` placeholders (account + project)
// to server-side values, and forwards the request to the Cloudflare API with
// `Authorization: Bearer <CLOUDFLARE_API_TOKEN>` from a Pages runtime secret. The
// whole /admin/* path (this route included) is already gated by Cloudflare Zero
// Trust (Access), so only authorized editors reach it.
//
// Set in the Pages project (Settings → Variables & Secrets, encrypted):
//   CLOUDFLARE_API_TOKEN   — scoped token (KV/D1/R2/Pages: Edit — see README)
//   CLOUDFLARE_ACCOUNT_ID  — the account the CMS provisions into
//   PAGES_PROJECT          — this Pages project's name

import {
  FORWARD_REQUEST_HEADERS,
  STRIP_RESPONSE_HEADERS,
  crossOriginBlocked,
  isAllowed,
  resolveProject,
  substituteAccount,
} from "../../../_lib/cf-proxy";

interface Env {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  PAGES_PROJECT?: string;
}

const CF_API = "https://api.cloudflare.com/client/v4";

export const onRequest = async (context: {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
}): Promise<Response> => {
  const { request, env, params } = context;

  // Missing config → a distinctive, machine-readable 503 so the UI can render a
  // friendly "not configured, here's how to fix it" state (see cloudflare.ts).
  const missing: string[] = [];
  if (!env.CLOUDFLARE_API_TOKEN) missing.push("CLOUDFLARE_API_TOKEN");
  if (!env.CLOUDFLARE_ACCOUNT_ID) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!env.PAGES_PROJECT) missing.push("PAGES_PROJECT");
  if (missing.length) {
    return json(503, {
      configured: false,
      missing,
      message:
        "Cloudflare proxy is not configured: set these Pages secrets (Settings → Variables & Secrets).",
    });
  }
  const accountId = env.CLOUDFLARE_ACCOUNT_ID as string;
  const project = env.PAGES_PROJECT as string;

  // `[[path]]` catch-all → array of path segments after /admin/api/cf/.
  const seg = params.path;
  const subPath = Array.isArray(seg) ? seg.join("/") : (seg ?? "");
  const url = new URL(request.url);

  // Resolve the project placeholder first so the allowlist validates the real
  // project; the account placeholder stays `self` until after the check.
  const resolved = resolveProject(subPath, project);

  // Enforce the method+path allowlist BEFORE attaching the token: only the
  // endpoints the CMS actually calls, on this account/project, are reachable.
  if (!isAllowed(request.method, resolved, project)) {
    return json(403, {
      message: `Blocked by proxy allowlist: ${request.method} /${subPath} is not a permitted Cloudflare endpoint.`,
    });
  }

  // CSRF guard: a cross-origin write from an authenticated editor's browser is
  // rejected. Access gates the route; this stops a malicious page riding along.
  if (crossOriginBlocked(request.method, request.headers.get("origin"), url.host)) {
    return json(403, { message: "Cross-origin write rejected." });
  }

  const target = `${CF_API}/${substituteAccount(resolved, accountId)}${url.search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Authorization", `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  });

  // Return Cloudflare's response, stripping headers that won't survive
  // re-serialization plus rate-limit headers we don't leak.
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
