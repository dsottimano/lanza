# Security model

The auth/authz rules the tenant site and the broker both depend on, and why each
exists. Written after the 2026-07-25 review, which found four ways to bypass the
`/admin` gate — every rule below is here because something got through.

Companion docs: `onboarding-broker-design.md` (the flow), `mcp-server.md` (the
agent surface). **This file is authoritative where they disagree.**

---

## 1. The four invariants

### I1 — A valid signature is not authorization

The broker mints a session for **anyone** who authenticates with GitHub; that is
what makes onboarding self-serve. So `verifySession()` returning a login means
only "GitHub says this is who they are". Whether that person may touch *this*
site is a second, separate check: `isAllowedLogin(login, ADMIN_LOGIN || repo.adminLogin)`.

Every gate that admits a session must make both checks. Currently:

| Gate | File | Identity | Ownership |
|---|---|---|---|
| `/admin/*` (SPA + both proxies) | `functions/admin/_middleware.ts` | ✅ | ✅ |
| Login handoff | `functions/admin/api/auth/handoff.ts` | ✅ | ✅ |
| MCP | `functions/api/mcp.ts` | ✅ | ✅ |

`functions/admin/api/cf/[[path]].ts` performs **no session check of its own** — it
trusts the middleware completely and then attaches an account-scoped Cloudflare
API token. Anything that weakens the middleware hands out that token. Do not add
a route under `/admin/` that bypasses it.

> The review found the middleware checking identity only. Any GitHub user could
> log in and reach `/admin/api/cf/*`.

### I2 — A denial is not an outage

`/admin/api/gh/*` asks the broker to mint a repo-scoped token and falls back to a
standing `GITHUB_TOKEN` PAT when the broker cannot answer. That fallback must
never trigger on a **refusal**: a caller the broker just rejected would be handed
broader credentials than the ones it was denied.

`brokerToken()` returns a three-state result — `{token}` / `"denied"` / `null`.
Only `null` (network error, 5xx, malformed response) may fall through to the PAT.
401 and 403 are terminal.

### I3 — Validate the URL you are about to fetch, not the string you were given

A path allowlist inspects a string; what actually leaves the Worker is a **parsed
URL**, and only the parser decides what a path segment means. They disagree in
ways that are not obvious:

- WHATWG URL treats `\` as a path separator, so `..\..\x` traverses.
- `%2e%2e` **is** a dot segment per RFC 3986 and normalizes on parse.
- `encodeURIComponent` does not escape `.`, so encoding a path does not neutralize `..`.

Both GitHub clients therefore validate twice:

| | String check | Resolved check |
|---|---|---|
| `functions/_lib/gh-proxy.ts` | `isAllowed()` — folds `\` and repeated percent-decoding before the dot-segment test | `upstreamTargetAllowed()` — the parsed URL must stay under `/repos/<owner>/<name>/` or be `/user` |
| `functions/_lib/lanza-content.ts` | `assertSafePath()` — rejects `..`, `.`, leading `/`, `\`, `%`, NUL, empty segments, `.git` | (paths are repo-relative by construction) |

> Verified bypasses, all now blocked and covered by tests:
> `PUT contents/..\..\..\..\repos/attacker/evil/contents/pwn.md` → wrote to another repo.
> `DELETE contents/%2e%2e/…/git/refs/heads/main` → deleted the branch Astro builds from.

### I4 — An audience claim is worthless unless every consumer checks it

A session's `aud` scopes it to one site. The tenant checks it
(`session.ts:verifySession`), and the MCP route checks a stricter form
(`aud === <origin>/api/mcp`, RFC 8707).

The broker's `/api/token` is a **second consumer** and must check it too. Without
that, a session minted for *any* origin mints `Contents:write` on *every* repo its
login owns — because ownership (`owner === login`) was the only test.

`audienceAllowedForRepo()` (`lanza-broker/functions/_lib/tenant-origin.ts`) binds
the audience to the repo by recomputing the tenant's origin from the repo name.
No new state: the Pages project name is derived from the repo, so the expected
origin is derivable. Custom domains can't be derived — see §3.

> This is why design §3.3's "no origin allowlist is needed" argument does not
> hold. It assumed tenants were the only consumer of a broker-signed token.

---

## 2. What the MCP server may touch

The MCP tools run on behalf of an **agent**, which may be acting on
prompt-injected input. They are confined twice:

1. `assertSafePath()` — structural (I3 above). Applies to every path reaching the
   Contents API, including `data/site.json` and `data/schema.json` reads.
2. `assertEntryPath()` (`mcp-core.ts`) — the entry tools (`read`/`update`/`delete`)
   additionally require a `.md` file inside a folder some collection in
   `data/schema.json` actually declares.

`locale` is untrusted input, not a label: it is interpolated into a write path, so
`resolveLocale()` requires it to be a locale the site declares in `data/site.json`.

Why both: without confinement, "update an entry" is whole-repo write. In range
would be `lanza.config.json` (which decides who owns `/admin`),
`.github/workflows/*` (arbitrary code in the tenant's CI, reachable by staging a
workflow then calling `publish`), and `astro.config.mjs`.

`create_content` refuses to overwrite an existing path — it is a create, not an
upsert. Two titles that slugify alike would otherwise destroy an entry silently.

---

## 3. Deployment requirements this model imposes

| Setting | Where | Why | Consequence if unset |
|---|---|---|---|
| `ALLOWED_TENANT_ORIGINS` | broker | I4 — lists custom tenant domains that can't be derived from a repo name | **A custom-domain tenant cannot save.** `/api/token` returns 403 because the derived origin doesn't match. Comma-separated full origins. |
| `HANDOFF_PUBLIC_KEY` | broker | `/api/token` verifies tenant sessions with it | First save fails with a 500 that points at the tenant, not the broker |
| `ADMIN_LOGIN` (optional) | tenant | Overrides `lanza.config.json`'s `adminLogin`; comma-list for extra editors | Falls back to the committed config — fine for a normal tenant |

**lanzacms.com specifically** (the Lanza instance we run our own site on): its
repo is `dsottimano/lanza`, so the derived origin is `https://lanza.pages.dev`,
which is not the domain it actually serves from. The broker must carry
`ALLOWED_TENANT_ORIGINS=https://lanzacms.com` or saves from that site break.

---

## 4. Known-accepted risks

Real, reviewed, not currently fixed. Listed so they are decisions rather than
oversights.

- **Sessions cannot be revoked.** The session is a stateless 7-day RS256 bearer
  with no `jti` and no server-side state. Logout clears the cookie only; a
  captured token stays valid for its full life, and removing a login from
  `ADMIN_LOGIN` does not invalidate outstanding sessions. The only kill switch is
  rotating `HANDOFF_PRIVATE_KEY`, which signs every tenant out at once. Design
  §3.2's "Replay-bounded — `exp ≤ 120s` + one-shot `jti`" describes a system that
  was never built; §3.4-B superseded it by making the handoff token *become* the
  session.
- **The handoff token is the session token.** One artifact serves as both
  transport credential and session credential, so anything that observes the
  handoff once holds a 7-day session.
- **Proxy responses relay upstream headers.** `new Headers(upstream.headers)`
  copies GitHub's `Cache-Control: private, max-age=60` and `Access-Control-Allow-Origin: *`.
  Not exploitable today (`SameSite=Lax`; `ACAO: *` is rejected with credentials),
  but the "never cached" rule in CLAUDE.md Rule 2 is inherited rather than
  enforced. Switching the session cookie to `SameSite=None` would make this live.
- **Cloudflare OAuth tokens live in a browser cookie.** `lanza_cf` holds the CF
  access + refresh tokens as unauthenticated base64 JSON (`HttpOnly; Secure`,
  `Path=/`). Contradicts `onboarding-workflow.md`'s "token never exposed to the
  browser" invariant. Scopes also still include `workers-kv-storage.write`,
  `d1.write`, `workers-r2.write` and `user-details.read`, which no broker code
  path uses.
- **`/api/auth/cf/login` honours an unauthenticated `?scope=` override.**
- **No `Origin` validation on the MCP transport.** The spec asks for it against
  DNS rebinding; impact is low because auth is Bearer, not cookie.

---

## 5. Reviewing changes to this surface

- Adding a route under `/admin/`? It inherits the middleware — confirm it should.
- Adding a GitHub call? Use an existing client. A third one means a third place
  I3 can be forgotten.
- Adding an MCP tool that takes a path or a path fragment? Route it through
  `assertEntryPath` (entries) or `assertSafePath` (anything else). Interpolating a
  tool argument into a path without one of those is the bug class that produced
  the CI-workflow write.
- Changing `isAllowed`, `assertSafePath`, or the audience binding? The adversarial
  cases live in `functions/_lib/gh-proxy.test.mjs` and `mcp-core.test.mjs`. They
  assert refusal **and** that nothing was written — keep both halves.
