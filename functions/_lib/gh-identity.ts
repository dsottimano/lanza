// "May this GitHub user write this repo?" — asked of GitHub, which is the only
// authority on it (docs/security-todo.md §10.2). This is the other half of the
// secretless path: device-flow.ts obtains a user token, this turns that token into
// an identity and a role, with no list of people anywhere.
//
// Dependency-free and runtime-neutral like device-flow.ts and gh-proxy.ts, so the
// Pages bundler, Vite and `node --experimental-strip-types` all take it. `fetch` and
// `crypto.subtle` are injected/standard rather than Node- or Workers-specific.
//
// TWO CALLS, NOT ONE: `GET /repos/{owner}/{name}` carries `permissions` (the role)
// but not who is asking; `GET /user` carries the login. They run in parallel, and
// the pair is cached together — see the cache note below.
import { roleFromPermissions, type Role } from "./roles";

const GITHUB_API = "https://api.github.com";

export interface Identity {
  login: string;
  role: Role;
}

// Four outcomes, deliberately distinct. Collapsing `expired` into `denied` would
// sign a person out every 8 hours instead of refreshing; collapsing `unavailable`
// into `denied` would turn a GitHub outage into "you have been removed from this
// repository", which is both false and alarming.
export type IdentityResult =
  | { status: "ok"; identity: Identity }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "unavailable" };

type Fetch = typeof globalThis.fetch;

// Per-isolate, 60-second cache of the answer, keyed by a hash of the access token.
// One `GET /repos` + `GET /user` per request is a round-trip the CMS does not need
// on every call, and 60s is the deliberate ceiling on how long a removal of access
// keeps working — against 7 days for the session it replaces. Keyed by a HASH so
// the token itself is not sitting in a long-lived map; the cache is best-effort and
// correctness never depends on a hit.
const TTL_MS = 60_000;
const cache = new Map<string, { result: IdentityResult; expires: number }>();

/** Tests only — the cache is process-wide and would otherwise leak between cases. */
export function resetIdentityCache(): void {
  cache.clear();
}

async function cacheKey(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function get(request: string, token: string, fetchImpl: Fetch): Promise<Response> {
  return fetchImpl(`${GITHUB_API}${request}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "lanza-cms",
    },
  });
}

/**
 * Who is this token, and what may they do to this repo?
 *
 * Both `denied` and `ok` are cached; `expired` and `unavailable` are not — the first
 * is about to be refreshed into a different token, and the second is a transient
 * condition that must not be remembered as an answer.
 */
export async function identityFor(
  token: string,
  owner: string,
  name: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<IdentityResult> {
  const key = await cacheKey(token);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.result;

  const result = await ask(token, owner, name, fetchImpl);
  if (result.status === "ok" || result.status === "denied") {
    cache.set(key, { result, expires: Date.now() + TTL_MS });
  }
  return result;
}

async function ask(
  token: string,
  owner: string,
  name: string,
  fetchImpl: Fetch,
): Promise<IdentityResult> {
  let repoRes: Response;
  let userRes: Response;
  try {
    [repoRes, userRes] = await Promise.all([
      get(`/repos/${owner}/${name}`, token, fetchImpl),
      get("/user", token, fetchImpl),
    ]);
  } catch {
    return { status: "unavailable" };
  }

  // 401 is the token, not the person: it expired or was revoked. The caller refreshes.
  if (repoRes.status === 401 || userRes.status === 401) return { status: "expired" };
  // GitHub answers 404 — not 403 — for a private repo you cannot see, so the two mean
  // the same thing here: this account has no access.
  if (repoRes.status === 403 || repoRes.status === 404) return { status: "denied" };
  if (!repoRes.ok || !userRes.ok) return { status: "unavailable" };

  let permissions: unknown;
  let login: unknown;
  try {
    permissions = ((await repoRes.json()) as Record<string, unknown>).permissions;
    login = ((await userRes.json()) as Record<string, unknown>).login;
  } catch {
    return { status: "unavailable" };
  }

  const role = roleFromPermissions(permissions);
  // A repo readable with every boolean false should not exist, but if GitHub ever
  // omits `permissions` we must not invent a role from the absence of one.
  if (!role || typeof login !== "string" || !login) return { status: "denied" };
  return { status: "ok", identity: { login, role } };
}
