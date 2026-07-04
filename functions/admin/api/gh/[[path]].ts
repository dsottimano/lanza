// GitHub API proxy — Cloudflare Pages Function.
//
// The Lanza CMS SPA talks to `/admin/api/gh/*` instead of api.github.com so a GitHub
// token NEVER reaches the browser. The whole /admin/* path is gated by the auth
// middleware, so only the allowlisted editor reaches here.
//
// Multi-tenant token: instead of a standing GITHUB_TOKEN PAT, this proxy asks the
// BROKER to mint a short-lived, repo-scoped App installation token (Contents:write),
// forwarding the editor's broker-signed session. Zero standing secret on the tenant.
// A GITHUB_TOKEN env var, if set, is used as a fallback (the dogfood keeps one while
// we transition). `GET /user` can't use an installation token, so it's synthesized
// from the session (the CMS uses it only for a health-check login display).

import {
  FORWARD_REQUEST_HEADERS,
  STRIP_RESPONSE_HEADERS,
  crossOriginBlocked,
  isAllowed,
  upstreamPath,
} from "../../../_lib/gh-proxy";
// Per-tenant repo identity — the broker writes this at repo creation; the proxy is
// the single place that turns repo-relative CMS paths into repos/<owner>/<name>/…
import repo from "../../../../lanza.config.json";
import { SESSION_COOKIE, readCookie, importPublicKey, verifySession } from "../../../_lib/session";
import { BROKER_ORIGIN as CONFIG_BROKER, HANDOFF_PUBLIC_KEY as CONFIG_PUBLIC_KEY } from "../../../_lib/tenant-config";

interface Env {
  GITHUB_TOKEN?: string;
  BROKER_ORIGIN?: string;
  HANDOFF_PUBLIC_KEY?: string;
}

const GITHUB_API = "https://api.github.com";

// Best-effort per-isolate cache of the repo-scoped installation token — the token is
// the same for every editor of the repo, so caching by repo avoids a broker round-trip
// on each CMS call. A cache miss just re-fetches; correctness never depends on it.
const tokenCache = new Map<string, { token: string; exp: number }>();

async function brokerToken(broker: string, session: string): Promise<string | null> {
  const key = `${repo.owner}/${repo.name}`;
  const cached = tokenCache.get(key);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${broker}/api/token`, {
    method: "POST",
    headers: { "X-Lanza-Session": session, "Content-Type": "application/json" },
    body: JSON.stringify({ owner: repo.owner, repo: repo.name }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { token?: string; expiresAt?: string };
  if (!data.token) return null;
  tokenCache.set(key, {
    token: data.token,
    exp: data.expiresAt ? Date.parse(data.expiresAt) : Date.now() + 3_000_000,
  });
  return data.token;
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
}): Promise<Response> => {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const session = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);

  // `[[path]]` catch-all → array of path segments after /admin/api/gh/.
  const seg = params.path;
  const subPath = Array.isArray(seg) ? seg.join("/") : (seg ?? "");

  // GET /user — an installation token can't call it. Synthesize {login} from the
  // broker-signed session (the CMS uses this only for its health-check display).
  if (request.method === "GET" && subPath.replace(/[?#].*$/, "").replace(/^\/+/, "") === "user") {
    const publicKey = env.HANDOFF_PUBLIC_KEY || CONFIG_PUBLIC_KEY;
    const login =
      publicKey && session
        ? await verifySession(session, await importPublicKey(publicKey), url.origin)
        : null;
    if (!login) return json(401, { message: "Not authenticated." });
    return json(200, { login });
  }

  // Enforce the method+path allowlist BEFORE attaching a token: only the endpoints
  // the CMS calls, on this one repo, are reachable.
  if (!isAllowed(request.method, subPath)) {
    return json(403, {
      message: `Blocked by proxy allowlist: ${request.method} /${subPath} is not a permitted GitHub endpoint.`,
    });
  }

  // CSRF guard: reject a cross-origin write riding an authenticated editor's browser.
  if (crossOriginBlocked(request.method, request.headers.get("origin"), url.host)) {
    return json(403, { message: "Cross-origin write rejected." });
  }

  // Token: broker-minted (multi-tenant) first, else the legacy GITHUB_TOKEN PAT.
  const broker = env.BROKER_ORIGIN || CONFIG_BROKER;
  let token: string | null = null;
  if (session && broker) token = await brokerToken(broker, session);
  if (!token) token = env.GITHUB_TOKEN ?? null;
  if (!token) {
    return json(500, {
      message: "GitHub proxy: no token — the broker was unavailable and no GITHUB_TOKEN is set.",
    });
  }

  const target = `${GITHUB_API}/${upstreamPath(subPath, repo.owner, repo.name)}${url.search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/vnd.github+json");
  headers.set("User-Agent", "lanza-cms");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  });

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
