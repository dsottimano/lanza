// GitHub API proxy — Cloudflare Pages Function.
//
// The Lanza CMS SPA talks to `/admin/api/gh/*` instead of api.github.com so a GitHub
// token NEVER reaches the browser. The whole /admin/* path is gated by the auth
// middleware, so only the allowlisted editor reaches here.
//
// The token is the SIGNED-IN PERSON'S OWN GitHub token, obtained by device flow and
// held in an HttpOnly cookie (docs/security-todo.md §10). The gate hands it over in
// `data` — post-refresh, which the cookie on this request may not be. There is no
// mint and no standing PAT: what this proxy can do is exactly what this person can
// do at github.com, so nothing here is an escalation of their own access. What it
// still does is NARROW that access — allowlist, repo confinement, editor write
// rules — because a user token reaches every repo they can touch, not just this one
// (§10.4).

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

// No Env: this proxy reads no configuration and holds no credential of its own. The
// token comes from the gate, the repo identity from lanza.config.json.
type Env = Record<string, never>;

const GITHUB_API = "https://api.github.com";

export const onRequest = async (context: {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
  // Set by functions/admin/_middleware.ts, which is the only thing that can reach
  // this route. Absent role = treat as an editor (the lesser of the two), never as
  // an owner — a missing claim must not be the permissive case.
  data?: { role?: Role; login?: string; token?: string | null };
}): Promise<Response> => {
  const { request, params } = context;
  const url = new URL(request.url);
  // Absent role = treat as an editor (the middle role), never as an owner — a
  // missing claim must not be the permissive case.
  const claimed = context.data?.role;
  const role: Role = claimed === "owner" || claimed === "viewer" ? claimed : "editor";

  // `[[path]]` catch-all → array of path segments after /admin/api/gh/.
  const seg = params.path;
  const subPath = Array.isArray(seg) ? seg.join("/") : (seg ?? "");

  // GET /user — answered here rather than forwarded. The gate has already asked
  // GitHub who this is, so passing it upstream would buy a second round-trip for an
  // answer we already hold. There is no longer a second source: the gate admits
  // nobody without a GitHub token, so if `login` is absent, nothing else here knows
  // it either.
  if (request.method === "GET" && subPath.replace(/[?#].*$/, "").replace(/^\/+/, "") === "user") {
    const login = context.data?.login;
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

  // The person's own token, from the gate. A browser that got in on the outgoing
  // RS256 session has none — it is a credential for OUR broker, not for GitHub, and
  // there is nothing left here to trade it for. Say "sign in", not "server error":
  // one device code fixes it, and 401 is what the SPA already reads as an auth
  // problem. (Deleted along with that family in phase 4.)
  const token = context.data?.token;
  if (!token) {
    return json(401, { message: "Sign in with GitHub again to edit this site." });
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
