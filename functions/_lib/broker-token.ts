// Minting the repo-scoped GitHub App installation token from the broker.
//
// Exists so invariant I2 ("a denial is not an outage", docs/security-model.md) is
// implemented in ONE place. Both GitHub callers on a tenant — the CMS proxy
// (functions/admin/api/gh/[[path]].ts) and the MCP server (functions/api/mcp.ts) —
// fall back to a standing GITHUB_TOKEN PAT when the broker cannot answer. That
// fallback is only correct for "could not answer". A broker that positively
// REFUSED (the owner revoked the App, the audience check failed, the session is
// not the owner) must be terminal: handing a rejected caller the broader standing
// credential turns a denial into an escalation, and means revocation does not
// revoke.
//
// Hence the three-state result rather than `string | null`. The MCP server had the
// two-state version and collapsed 401/403 into "unavailable" — that was the bug.

export type TokenResult = { token: string } | "denied" | null;

/** Cache shape: repo key → token. Best-effort per isolate; a miss just re-mints. */
export type TokenCache = Map<string, { token: string; exp: number }>;

export async function mintRepoToken(
  broker: string,
  session: string,
  owner: string,
  name: string,
  cache: TokenCache,
): Promise<TokenResult> {
  const key = `${owner}/${name}`;
  const cached = cache.get(key);
  if (cached && cached.exp > Date.now() + 60_000) return { token: cached.token };

  const res = await fetch(`${broker}/api/token`, {
    method: "POST",
    headers: { "X-Lanza-Session": session, "Content-Type": "application/json" },
    body: JSON.stringify({ owner, repo: name }),
  });
  // 401/403 are a positive refusal — terminal. Everything else (network error,
  // 5xx, malformed body) is "could not answer" and may fall through to the PAT.
  if (res.status === 401 || res.status === 403) return "denied";
  if (!res.ok) return null;

  const data = (await res.json()) as { token?: string; expiresAt?: string };
  if (!data.token) return null;
  const exp = data.expiresAt ? Date.parse(data.expiresAt) : NaN;
  cache.set(key, {
    token: data.token,
    // A NaN expiry would make every future `exp > now` false and silently disable
    // the cache — fall back to a fixed ~50min TTL instead.
    exp: Number.isFinite(exp) ? exp : Date.now() + 3_000_000,
  });
  return { token: data.token };
}
