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
  upstreamTargetAllowed,
  BRANCH,
  WORKING_BRANCH,
} from "../../../_lib/gh-proxy";
import { editorMayCall, roleMayWrite, type Role } from "../../../_lib/roles";
// Per-tenant repo identity — the broker writes this at repo creation; the proxy is
// the single place that turns repo-relative CMS paths into repos/<owner>/<name>/…
import repo from "../../../../lanza.config.json";
import { mintRepoToken, type TokenCache } from "../../../_lib/broker-token";
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
//
// The mint itself lives in _lib/broker-token.ts, shared with the MCP server, so I2
// ("a denial is not an outage") has exactly one implementation. This file used to
// carry its own copy; the MCP server carried a second one that got I2 WRONG, which is
// the whole argument for not having two.
const tokenCache: TokenCache = new Map();

export const onRequest = async (context: {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
  // Set by functions/admin/_middleware.ts, which is the only thing that can reach
  // this route. Absent role = treat as an editor (the lesser of the two), never as
  // an owner — a missing claim must not be the permissive case.
  data?: { role?: Role; login?: string };
}): Promise<Response> => {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const session = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  // Absent role = treat as an editor (the middle role), never as an owner — a
  // missing claim must not be the permissive case.
  const claimed = context.data?.role;
  const role: Role = claimed === "owner" || claimed === "viewer" ? claimed : "editor";

  // `[[path]]` catch-all → array of path segments after /admin/api/gh/.
  const seg = params.path;
  const subPath = Array.isArray(seg) ? seg.join("/") : (seg ?? "");

  // GET /user — an installation token can't call it. Synthesize {login} from the
  // broker-signed session (the CMS uses this only for its health-check display).
  if (request.method === "GET" && subPath.replace(/[?#].*$/, "").replace(/^\/+/, "") === "user") {
    // The gate already asked GitHub who this is (device-flow family), so take its
    // answer; only fall back to re-verifying the broker session for a browser that
    // holds one of those instead.
    const publicKey = env.HANDOFF_PUBLIC_KEY || CONFIG_PUBLIC_KEY;
    const login =
      context.data?.login ||
      (publicKey && session
        ? await verifySession(session, await importPublicKey(publicKey), url.origin)
        : null);
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

  // The body is read ONCE, here, and the same bytes are forwarded below. The role
  // check has to inspect what GitHub will actually execute — a re-read or a
  // re-serialized copy would be checking a different request than the one that runs.
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const bodyBytes = hasBody ? await request.arrayBuffer() : undefined;

  // Role. The allowlist above says which endpoints the CMS may use at all; this says
  // which of them THIS person may use. Asked here rather than inherited from the
  // middleware's admission, because being let into /admin has never been the same
  // thing as being allowed to do a particular write (security-model.md I1).
  // A viewer writes nothing, anywhere — there is no path-by-path nuance to check.
  // Their token could not write the repo either, but a refusal here says why, where
  // GitHub's would arrive mid-save as an unexplained failure.
  if (!roleMayWrite(role) && hasBody) {
    return json(403, { message: "A viewer has read-only access to this site." });
  }

  if (role === "editor") {
    let parsed: unknown = null;
    if (bodyBytes && bodyBytes.byteLength) {
      try {
        parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
      } catch {
        // Unparseable body on a write: refuse rather than check nothing. Every
        // write the CMS makes is JSON, so this is malformed or hostile either way.
        return json(403, { message: "Blocked: unreadable request body." });
      }
    }
    const decision = editorMayCall(request.method, subPath, parsed, {
      workingBranch: WORKING_BRANCH,
      productionBranch: BRANCH,
    });
    if (!decision.ok) {
      return json(403, { message: decision.reason ?? "Not allowed for your role." });
    }
  }

  // Token: broker-minted (multi-tenant) first, else the legacy GITHUB_TOKEN PAT.
  const broker = env.BROKER_ORIGIN || CONFIG_BROKER;
  const result =
    session && broker
      ? await mintRepoToken(broker, session, repo.owner, repo.name, tokenCache)
      : null;
  // A refusal is final. Only an UNAVAILABLE broker may fall through to the PAT,
  // otherwise a caller the broker just rejected would be handed the standing
  // token instead — turning a denial into an escalation.
  if (result === "denied") {
    return json(403, { message: "Your session is not authorized to edit this repository." });
  }
  const token = result ? result.token : (env.GITHUB_TOKEN ?? null);
  if (!token) {
    return json(500, {
      message: "GitHub proxy: no token — the broker was unavailable and no GITHUB_TOKEN is set.",
    });
  }

  const target = `${GITHUB_API}/${upstreamPath(subPath, repo.owner, repo.name)}${url.search}`;
  // Last line of defence — the parsed URL, not the string, is what gets fetched.
  if (!upstreamTargetAllowed(target, repo.owner, repo.name)) {
    return json(403, { message: "Blocked by proxy: request resolves outside this repository." });
  }

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/vnd.github+json");
  headers.set("User-Agent", "lanza-cms");

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: bodyBytes,
  });

  const respHeaders = new Headers(upstream.headers);
  for (const name of STRIP_RESPONSE_HEADERS) respHeaders.delete(name);
  // Enforce "never cached" rather than inherit it (CLAUDE.md Rule 2). This response
  // carries repo contents fetched with a privileged token; no cache, anywhere, should
  // hold it.
  respHeaders.set("Cache-Control", "no-store");

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
