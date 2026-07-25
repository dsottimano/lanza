# Security model

The auth/authz rules the tenant site and the broker both depend on, and why each
exists. Written after the 2026-07-25 review, which found four ways to bypass the
`/admin` gate — every rule below is here because something got through.

Companion docs: `keys-and-secrets.md` (every credential and who holds it),
`onboarding-workflow.md` (life of an onboarding), `onboarding-broker-design.md`
(why/decisions), `mcp-server.md` (the agent surface). **This file is authoritative
where they disagree.**

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
the audience to the repo by recomputing the tenant's origin. No new state — see
§2 for how the name is derived. Custom domains can't be derived; see §4.

> This is why design §3.3's "no origin allowlist is needed" argument does not
> hold. It assumed tenants were the only consumer of a broker-signed token.

**The multi-site MCP token is the one deliberate exception, and it does not weaken
this.** `connect.lanzacms.com/api/mcp` issues a token whose `aud` is the *router*, so
audience alone can no longer name one site. The bound moves to an explicit **`sites`
claim** the user sets at consent, and the router checks it on every call before minting
anything. Two properties keep I4 intact:

- The router mints its own **per-site** downstream tokens (`aud = <tenant>/api/mcp`,
  5 min). `/api/token` still sees only single-site audiences — `audienceAllowedForRepo`
  was not relaxed, and must not be.
- The exception is not transitive. A router-audience token is refused by every tenant,
  and a tenant-audience token is refused by the router. Neither substitutes for the other.

A `sites` claim is a *grant*, not a hint: absent or empty means **nothing**, never
everything (`lanza-broker/functions/api/mcp.ts`). The consent POST is intersected with
the server's own list, so the browser can only narrow it; refresh carries it unchanged.

---

## 2. How a tenant's Pages project is named

`lanza-broker/functions/_lib/tenant-origin.ts` — read this before changing
anything about project naming, because two unrelated requirements meet in it.

**The name is not the repo name, and the user does not choose it.**

```
projectNameCandidates(owner, repo)[0] = `${slug(repo)}-${sha256(owner/repo)[0..12]}`

  datadefine/test    →  test-0304ea543eaf.pages.dev
  someone/test       →  test-f3d658bc73b5.pages.dev   (same repo name, no collision)
  acme/"My Bakery!"  →  my-bakery-ccb492ff422f.pages.dev
```

Two constraints force this shape:

1. **`*.pages.dev` is a global namespace** — unique across *every* Cloudflare
   account, not just the user's. Naming a project after its repo meant ordinary
   names (`test`, `blog`, `bakery`) collided with strangers on the first attempt.
   Worse, the collision was invisible: `projectExists` only checks *our* account,
   so a stranger's name read as "already exists → success", deployed nothing, and
   the wizard then invited the user to log in at a third party's `/admin`.
2. **The origin must be recomputable** (I4). `/api/token` has to derive a repo's
   site origin to check a session's `aud` against it. A random name would break
   that and force a persistent repo→origin store — reopening exactly the
   statelessness question §3 of the broker design just closed.

A 48-bit suffix bound to `owner/repo` satisfies both: collisions aren't a
practical concern, nobody can squat another tenant's name, and every name stays
derivable from public inputs.

**The fallback ladder.** `projectNameCandidates` returns `[base, base-2, base-3,
base-4]`. Only Cloudflare can say whether a name is genuinely free, so the create
path must be able to try again; in practice the first candidate always wins.
`allowedOriginsForRepo` accepts *every* candidate, which keeps the audience check
correct no matter which one the create landed on — the set is small, fixed, and
derived from that one repo, so it grants nothing to any other tenant.

**Constraints to respect if you touch this:** Cloudflare Pages names are
lowercase alphanumerics and hyphens, 58 chars max, start and end alphanumeric.
The base slug is capped at 42 so `base + "-" + 12 hex + "-4"` stays inside 58.
`deploy.ts` and `token.ts` must always agree — they import the same function, and
they must keep doing so.

## 3. What the MCP server may touch

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

## 4. Deployment requirements this model imposes

| Setting | Where | Why | Consequence if unset |
|---|---|---|---|
| `ALLOWED_TENANT_ORIGINS` | broker | I4 — lists custom tenant domains that can't be derived from a repo name | **A custom-domain tenant cannot save.** `/api/token` returns 403 because the derived origin doesn't match. Comma-separated full origins. |
| `HANDOFF_PUBLIC_KEY` | broker | `/api/token` verifies tenant sessions with it | First save fails with a 500 that points at the tenant, not the broker |
| `ADMIN_LOGIN` (optional) | tenant | Overrides `lanza.config.json`'s `adminLogin`; comma-list for extra editors | Falls back to the committed config — fine for a normal tenant |

**lanzacms.com specifically** (the Lanza instance we run our own site on): its
repo is `dsottimano/lanza`, so the derived origin is
`https://lanza-76cae1b6cc54.pages.dev` — not the domain it actually serves from.
The broker must carry `ALLOWED_TENANT_ORIGINS=https://lanzacms.com` or saves from
that site break.

Any tenant on a custom domain needs the same entry. That is the one thing §2's
derivation cannot cover, because a custom domain is not a function of the repo.

---

## 5. Known-accepted risks

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
  `Path=/`). The fix is Option B — a per-tenant server-side token store — designed
  and unbuilt. Scopes also still include `workers-kv-storage.write`, `d1.write`
  and `workers-r2.write`, which no broker code path uses. (`user-details.read` is
  no longer in that list: `describeIdentity()` calls `GET /user` so the wizard can
  show which Cloudflare account a site is about to be built in.)
- **`/api/auth/cf/login` honours an unauthenticated `?scope=` override.**
- **No `Origin` validation on the MCP transport.** The spec asks for it against
  DNS rebinding; impact is low because auth is Bearer, not cookie.

---

## 6. Reviewing changes to this surface

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
- Touching the multi-site MCP grant (the `sites` claim, the consent screen, the
  router)? Its adversarial cases live in `lanza-broker/functions/api/
  mcp-multisite.test.mjs` — a tampered consent POST, a broadening refresh, a replayed
  single-site token, an ungranted `site`. Each asserts refusal **and** that no request
  reached a tenant; keep both halves. If you find yourself relaxing
  `audienceAllowedForRepo` to make something work, stop — that is the check the router
  exists to avoid touching.
