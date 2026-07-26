# Keys, secrets, and who trusts whom

Every credential in Lanza: what it is, who holds it, what it authorizes, and what
breaks if it leaks. Written 2026-07-25, after the first onboarding ran end to end.

Companions: `security-model.md` (the invariants — **authoritative on authz**),
`onboarding-workflow.md` (the flow these credentials drive).

---

## 1. The shape of the problem

A tenant site is a static Cloudflare Pages deployment of *the customer's own* repo, in
*the customer's own* Cloudflare account. Nobody at Lanza can reach into it. Yet that
site must let exactly one GitHub user edit content, and must write to GitHub to do it.

That produces one hard requirement:

> **A tenant must be able to prove who a visitor is, and to obtain write access to its
> own repo, without ever holding a secret that could be extracted from it.**

Tenant repos are public and their build output is served to the world. Any standing
secret baked into a tenant is a secret published to the internet.

The answer is an **asymmetric split**:

| | Broker (`connect.lanzacms.com`) | Tenant (`<project>.pages.dev`) |
|---|---|---|
| Holds | every private key and client secret | **no secrets at all** |
| Can | sign sessions, mint GitHub tokens | *verify* signatures, spend a token it was handed |
| If compromised | every tenant is compromised | that one site, for as long as one token lives |

Everything below is a consequence of that table.

---

## 2. The handoff keypair (RS256) — the spine

One RSA-2048 keypair underpins all tenant authentication.

```bash
# private (PKCS#8 PEM) — broker only
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out handoff_private.pem
# public (SPKI PEM) — safe to publish
openssl rsa -pubout -in handoff_private.pem -out handoff_public.pem

# both are stored base64'd on one line (Linux -w0; macOS: base64 -i <file>)
base64 -w0 handoff_private.pem   # → HANDOFF_PRIVATE_KEY   broker secret
base64 -w0 handoff_public.pem    # → HANDOFF_PUBLIC_KEY    baked into the template
```

**Who signs:** only `lanza-broker/functions/api/auth/callback.ts`, via
`signSession()`. Nothing else ever touches the private key.

**Who verifies:** every tenant, with the public key. The tenant reads
`env.HANDOFF_PUBLIC_KEY || CONFIG_PUBLIC_KEY`, where the fallback is compiled into
`functions/_lib/tenant-config.ts` — so a freshly generated tenant verifies sessions
with **zero operator setup**. That is the whole point: the public key being public is
what makes onboarding a single click.

**The broker also verifies.** `functions/api/token.ts` holds `HANDOFF_PUBLIC_KEY` too,
because it is a *second consumer* of tenant sessions (invariant I4). It is the same
public key, and it is not a secret there either.

### What a session actually is

A signed JWT, 7-day TTL, delivered as the `lanza_session` cookie:

| claim | meaning | who enforces |
|---|---|---|
| `login` | the GitHub username GitHub confirmed | tenant `handoff.ts`, `_middleware.ts`, broker `token.ts` |
| `aud` | the one site origin this session is for | tenant `session.ts`, MCP (stricter: `<origin>/api/mcp`), broker `token.ts` |
| `exp` | expiry | all of the above |
| `nonce` | matched against a one-shot cookie during handoff | tenant `handoff.ts` |

**A valid signature is not authorization.** The broker signs a session for *anyone*
who authenticates with GitHub — that is what makes onboarding self-serve. Identity and
ownership are two checks, and every gate makes both. See `security-model.md` §I1; that
gap was a live `/admin` bypass.

### Rotation and blast radius

Rotating `HANDOFF_PRIVATE_KEY` **signs out every tenant at once** and invalidates every
outstanding session — it is the only revocation mechanism that exists (there is no
`jti`, no server-side session state; see `security-model.md` §5). Rotating the
*public* key is worse: it requires redeploying every tenant, because the fallback is
compiled into the template. Treat the keypair as long-lived.

---

## 3. Two GitHub OAuth client pairs — not a duplicate

The broker carries two GitHub client ID/secret pairs. They look interchangeable and
are not.

| Env | Belongs to | Used by | Scope requested | Purpose |
|---|---|---|---|---|
| `GH_APP_CLIENT_ID` / `GH_APP_CLIENT_SECRET` | the `lanza-cms` GitHub App's web flow | `api/auth/callback.ts` | **none** (scopeless) | Prove *who someone is* at `/admin` login. The token is used once to read the login, then **discarded** — never stored. |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | the onboarding OAuth client | `api/onboard/oauth/{start,callback}.ts` | `public_repo` | *Create the tenant's repo* from the template, write `lanza.config.json`, cut `staging`. Also discarded immediately after (`callback.ts:78`). |

Why separate: login must be scopeless, because a login credential that could write
repos would make every `/admin` visit a repo-write grant. Repo creation genuinely needs
`public_repo`. One client cannot be both.

**Neither user token is ever persisted.** On the broker, the only GitHub credential
that outlives a request is the App's own private key (§4).

**The Telegram bot is the exception, and it is outside the broker.** It carries a
standing fine-grained PAT with `Contents: read+write` on `dsottimano/lanza`, writing to
`main`. It is the one long-lived repo-write credential in the system — see §6.

---

## 4. The GitHub App private key → the token chain

`GH_APP_PRIVATE_KEY` (base64 PKCS#8) plus `GH_APP_ID` is how a tenant gets write access
to its repo *without holding anything*.

```
GH_APP_PRIVATE_KEY  --appJwt()-->  App JWT (10 min, signs as the App)
                    --getRepoInstallationId(owner, repo)-->  installation id
                    --scopedInstallationToken(id, repo)-->   token: ONE repo,
                                                             Contents:write, ~1 hour
```

The tenant's `/admin/api/gh` proxy calls `POST <broker>/api/token` per request,
forwarding the editor's session in `X-Lanza-Session`. The broker checks, in order:

1. session signature valid (public key)
2. `owner === session.login` — you may only mint for a repo you own
3. `aud` matches an origin derived from `owner/repo` — ownership alone is **not**
   enough (I4), or a session from any origin would mint write on every repo you own

Only then does it mint. The tenant receives a token that is already scoped to one repo,
one permission, one hour.

**`GITHUB_TOKEN` (tenant, optional)** is the self-host escape hatch: a standing PAT used
when there is no broker. In managed hosting it must stay unset, and a broker *denial*
must never fall back to it — see `security-model.md` §I2, which was a live bug.

---

## 5. Cloudflare credentials

| Env / artifact | Where | What it authorizes |
|---|---|---|
| `CLOUDFLARE_OAUTH_CLIENT_ID` / `_SECRET` | broker | The confidential OAuth client used to obtain each tenant's Cloudflare token. `client_secret_post`, no PKCE; CSRF is a random `state` in a short-lived HttpOnly cookie. |
| `lanza_cf` cookie | the **user's browser** | `{access, expires_at, account_id}` as unauthenticated base64 JSON, `HttpOnly; Secure; Path=/`, `Max-Age=3600`. Drives every wizard call to the Cloudflare API. **Access token only** — no refresh token is issued (see scopes below). |
| `CLOUDFLARE_API_TOKEN` (tenant, optional) | tenant | The tenant's **own** API token, created by them, for the Site Health panel and its KV/D1/R2 provisioning. Never held by Lanza — see "Cloudflare features are opt-in" below. |

**Scopes** are sent explicitly (omitting `scope` makes Cloudflare return a generic
error) as dot-notation IDs, which *are* the API-token permission IDs — not wrangler's
`resource:access` strings. Full list: `GET /client/v4/oauth/scopes`.

Currently requested (`api/auth/cf/login.ts`): `account-settings.read`,
`user-details.read`, `page.read`, `page.write`. **Four, and every one has a caller.**

- `page.write` is required to *create* a project — `page.read` alone returns a `10000`
  auth error.
- `user-details.read` **is** used — `describeIdentity()` calls `GET /user` to show the
  tenant which Cloudflare account they are about to build in.
- `account-settings.read` backs `resolveAccount()` in `_lib/cf-accounts.ts`.

**Removed 2026-07-25** — do not re-add without a caller to point at:

- `workers-kv-storage.write`, `d1.write`, `workers-r2.write` — no broker code path ever
  provisioned storage. The tenant CMS does, but on the tenant's own token through
  `functions/_lib/cf-proxy.ts`, never on this grant. They only widened the consent screen.
- `offline_access` — would issue a refresh token. Access tokens last ~16h while the
  `lanza_cf` cookie is capped at 3600s, so the token always outlives its own cookie and
  the refresh branch in `api/onboard/deploy.ts` was unreachable. Removed along with
  `refreshCfToken()`. (It yields a refresh token only if the client also has the
  `refresh_token` grant enabled — grant alone or scope alone gives nothing.)

Trim the *code* before the Cloudflare client — trimming the client first breaks the
connect step with a generic error. The code side is done; the client still lists the
old scopes, which is harmless (a client may offer more than a request asks for).

> ### Cloudflare features are opt-in, and Lanza holds no tenant CF credentials
>
> **Decided 2026-07-25.** Lanza will not store per-tenant Cloudflare tokens. The
> Site Health panel's provisioning features are therefore **optional and off by
> default**: a tenant who wants them creates their own scoped API token and sets
> `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `PAGES_PROJECT` on their own
> Pages project. Until they do, `functions/admin/api/cf/[[path]].ts` returns its
> `503 {configured:false}` and the CMS renders a "this is optional" setup card.
>
> This closes **Option B** (a per-tenant server-side token store) as *deliberately
> not built* rather than pending. Option B would have made the broker custodian of
> every tenant's Cloudflare refresh token — one namespace whose compromise carries
> `page.write` on the whole fleet. The store-nothing alternative (minting a scoped
> API token per tenant during onboarding) was **verified impossible**: Cloudflare's
> OAuth vocabulary has 371 scopes and none grant API-token management, and
> `GET /user/tokens` on an OAuth token returns `403 code 9109`.
>
> The residual, accepted: the wizard's `lanza_cf` cookie still carries a CF **access**
> token in the browser for up to an hour. Recorded in `security-model.md` §5.

`/api/auth/cf/login` also honours an unauthenticated `?scope=` override, kept for
debugging. That is a real loose end.

---

## 6. Complete inventory

### Broker (Cloudflare Pages → Settings → Variables & Secrets, type *Secret*)

| Name | Kind | Consumer | Leak impact |
|---|---|---|---|
| `HANDOFF_PRIVATE_KEY` | RSA private, base64 | `api/auth/callback.ts` | **Total.** Forge a session for any login on any tenant. |
| `HANDOFF_PUBLIC_KEY` | RSA public, base64 | `api/token.ts` | None — public by design. |
| `GH_APP_ID` | id | `token.ts`, `onboard/setup.ts` | None alone. |
| `GH_APP_PRIVATE_KEY` | RSA private, base64 PKCS#8 | `token.ts`, `onboard/setup.ts` | **Severe.** Contents:write on every repo the App is installed on. |
| `GH_APP_CLIENT_ID` / `GH_APP_CLIENT_SECRET` | OAuth client | `api/auth/callback.ts` | Impersonate the login flow. |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | OAuth client | `onboard/oauth/*` | Obtain `public_repo` as consenting users. |
| `CLOUDFLARE_OAUTH_CLIENT_ID` / `_SECRET` | OAuth client | `api/auth/cf/*` | Obtain Cloudflare tokens as consenting users. |
| `GH_APP_SLUG` | plain (default `lanza-cms`) | `onboard/oauth/callback.ts` | None. |
| `TEMPLATE_OWNER` / `TEMPLATE_REPO` | plain | `_lib/gh-app.ts` | None. |
| `ALLOWED_TENANT_ORIGINS` | plain, comma-separated | `api/token.ts` | Widens which origins may mint. Keep tight, and **scope each entry to its repo** (`owner/repo=https://origin`) — a bare origin applies to every repo. |
| `FANOUT_SECRET` | plain bearer | `api/admin/fanout.ts` | **Fleet-wide.** One header value plus `{"apply":true}` writes `package.json` on every repo the App can reach, including strangers'. No rate limit, no audit trail. Unset = endpoint disabled (503), which is the safe default. |

### Bot (Cloudflare Worker `telegram-bot`, `wrangler secret put`)

Absent from this document until 2026-07-26, which mattered: §1 states "the only GitHub
credential that outlives a request is the App's own private key". **That is false while
the bot is deployed.**

| Name | Kind | Consumer | Leak impact |
|---|---|---|---|
| `BOT_TOKEN` | Telegram bot token | `bot/src/index.ts` | Full control of the bot: read every allow-listed chat, post as it. |
| `BOT_INFO` | `getMe` JSON | `bot/src/index.ts` | None — public metadata. |
| `WEBHOOK_SECRET` | plain bearer | `bot/src/index.ts` | Drive the bot's draft-creation path directly, bypassing Telegram. |
| `GITHUB_TOKEN` | fine-grained PAT | `bot/src/index.ts` | **The only long-lived standing repo-write credential in the system.** `Contents: read+write` on `dsottimano/lanza`, targeting `main` — the branch Astro builds from. Everything else was deliberately engineered into per-request installation tokens; this one was not. |

Rotate the bot PAT on age alone: unlike the broker's installation tokens it has no
natural expiry, and nothing else in §7 covers it. Consider pointing `GITHUB_BRANCH` at
`staging` so the bot cannot write to `main` at all.

### Tenant

| Name | Required? | Purpose |
|---|---|---|
| `HANDOFF_PUBLIC_KEY` | no | Overrides the template-baked key. Preview/self-host only. |
| `ADMIN_LOGIN` | no | Overrides `lanza.config.json`'s `adminLogin`; comma-list adds editors. |
| `GITHUB_TOKEN` | self-host only | Standing PAT when there is no broker. **Unset in managed hosting.** |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `PAGES_PROJECT` | self-host only | Direct-mode Cloudflare access. |
| `GITHUB_CLIENT_ID` | no | Own GitHub OAuth app instead of the broker. |
| `BROKER_ORIGIN` | no | Overrides the compiled `https://connect.lanzacms.com`. |

### Committed, not secret

`lanza.config.json` at the tenant repo root — `{owner, name, adminLogin}`. Written by
the broker during onboarding and the single source for both *which repo the CMS edits*
and *who may enter `/admin`*.

> This file is why the generation race mattered: GitHub commits template content
> *after* `/generate` returns, so an early write got reverted by "Initial commit" and
> every tenant booted with the template's identity — locked out of its own `/admin`,
> CMS pointed at `dsottimano/lanza`. `setTenantConfig` now waits for the placeholder
> and updates by SHA.

---

## 7. Rotation

| Credential | Procedure | Cost |
|---|---|---|
| `HANDOFF_PRIVATE_KEY` | regenerate the pair, set both halves, redeploy every tenant | Signs everyone out; only revocation that exists |
| `GH_APP_PRIVATE_KEY` | generate a new key on the App, set the secret, delete the old | None to tenants — installation tokens are minted per request |
| Any OAuth client secret | regenerate on the provider, set the secret | In-flight authorizations fail; users retry |
| `CLOUDFLARE_OAUTH_CLIENT_SECRET` | regenerate | Tenants mid-wizard must reconnect Cloudflare |

**Owed now:** the exploratory Cloudflare API token, the broker `OAUTH_CLIENT_SECRET`,
and the old tenant `GITHUB_TOKEN` were pasted or screenshotted in earlier sessions.
Rotate them. Broker private keys are already stored as *Secret* type.
