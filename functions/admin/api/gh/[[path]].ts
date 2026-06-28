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

interface Env {
  GITHUB_TOKEN?: string;
}

const GITHUB_API = "https://api.github.com";

// Request headers worth forwarding upstream. Everything else (cookies, CF
// headers, host, the client's own auth) is dropped — we set auth ourselves.
const FORWARD_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "x-github-api-version",
  "if-none-match",
  "if-modified-since",
];

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
  const search = new URL(request.url).search;
  const target = `${GITHUB_API}/${subPath}${search}`;

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

  // Return GitHub's response verbatim. Strip encoding/length headers that won't
  // survive re-serialization (the body is already decoded by fetch()).
  const respHeaders = new Headers(upstream.headers);
  respHeaders.delete("content-encoding");
  respHeaders.delete("content-length");
  respHeaders.delete("transfer-encoding");

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
