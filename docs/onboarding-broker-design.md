# Lanza Onboarding Broker — Design Spec (Model B)

Status: **DRAFT for review** · 2026-07-04 · owner: Dave

The *build* spec for managed onboarding. The *why* (user-facing narrative, Live/Planned
tags) lives in `admin/src/help/09-onboarding-and-hosting.md`; this is the *how*,
sequenced into shippable phases. All external-API claims below were **verified against
live GitHub/Cloudflare docs on 2026-07-04** (not asserted from memory); §9 logs the
sources' conclusions as decisions.

**v1 shape (decided):** guided onboarding **on Cloudflare Pages** (no Workers
migration), one shared `lanza-cms` GitHub App for login routed through the broker,
asymmetric handoff. The Deploy-to-Cloudflare button is **deferred** (§5.1).

---

## 0. Model & non-goals

- **Model B — managed onboarding, self-owned accounts.** The customer owns their
  GitHub repo and their Cloudflare hosting; a wizard on **lanzacms.com** automates
  everything between the two unavoidable sign-ups (a GitHub account, a Cloudflare
  account — neither is creatable by API, by design).
- **Not** a fully-hosted SaaS (accounts are the customer's). **Not** agency/DIFM.
- Target user: a non-developer (plumber, bakery, salon) replacing WordPress.

## 1. Components & where trust lives

| Component | Role | Holds | Never holds |
|---|---|---|---|
| **Broker** (`lanza-broker`, own Pages project = lanzacms.com) | marketing, wizard, the shared login callback | GitHub App private key + client secret, **handoff PRIVATE key** | per-tenant state (aim: stateless) |
| **Tenant site** (customer's own Pages, from template) | Astro site + Lanza admin (via `@lanza/site`) + content | broker's **handoff PUBLIC key**, its owner login (public), its session state (§3.4) | any signing secret shared across tenants |
| **`lanza-cms` GitHub App** (one, Lanza-owned) | identity login for every tenant + Contents-only repo edits | — | broad/Administration repo access |
| **Template repo** (Lanza-owned, **public**) | thin content starter | — | — |

**Core invariant:** a tenant can *verify* what the broker signed, but can never *sign
as* the broker or another tenant. Hence the asymmetric handoff (§3).

## 2. The keystone problem

`09-...md` intends *one shared `lanza-cms` app logs users into every site*. But the
**shipped** `functions/admin/api/auth/{login,callback}.ts` points each tenant's OAuth
`redirect_uri` at its *own* domain — which only works with a *per-tenant* app (Model
A). A single shared app can't register a callback per customer (**verified:** GitHub
Apps cap at 10 callback URLs). **So shipped auth silently contradicts the design.**
Phase 1 fixes it by routing login through the broker's one callback.

---

## 3. Phase 1 — Auth keystone (broker-mediated login + asymmetric handoff)

**Locked:** handoff tokens are **asymmetric (RS256)** — broker signs with a private
key, tenants verify with a public key baked into the template. A shared HMAC secret
would let one compromised tenant forge a "logged in as <owner>" token for *every*
site (signing key == verifying key). Asymmetric gives tenants verify-only power.
(Reuses the RS256 WebCrypto style already in `lanza-broker/functions/_lib/gh-app.ts`.)

### 3.1 Login sequence

```
1. Unauth hit on tenant /admin
   → functions/admin/_middleware.ts   302 → /admin/api/auth/login

2. tenant login.ts
   → set HttpOnly nonce cookie (CSRF)
   → 302 GitHub authorize:
        client_id    = <shared lanza-cms app>
        redirect_uri = https://lanzacms.com/api/auth/callback   (broker, fixed)
        scope        = (none — identity only)
        state        = base64({ origin: <this tenant>, nonce })

3. GitHub → broker /api/auth/callback?code&state
   broker: exchange code w/ shared client_secret → read GitHub login → DISCARD token

4. broker mints handoff JWT, RS256-signed with HANDOFF_PRIVATE_KEY:
        { login, aud: <origin from state>, nonce, iat, exp ≤120s, jti }

5. broker 302 → https://<origin>/admin/api/auth/handoff?token=<JWT>

6. tenant handoff.ts:
        verify RS256 sig with baked-in HANDOFF_PUBLIC_KEY
        assert aud == own origin, nonce == nonce cookie, exp fresh, jti unseen
        assert login == ADMIN_LOGIN (§3.4)
        → establish session (§3.4) → 302 /admin/
```

> **Steps 4–6 above describe the ORIGINAL design, not the shipped code.** §3.4-B
> (decided later) made the handoff token *become* the 7-day session, which
> dropped `exp ≤ 120s` and `jti`, and delivery is an auto-submitting POST form,
> not a redirect (so the bearer never lands in a URL). The shipped shape is:
>
> - claims `{ login, aud, nonce, iat, exp: +7d }` — **no `jti`**
> - broker renders a POST form → tenant `/admin/api/auth/handoff` (**POST only**;
>   a GET gets 405)
> - tenant asserts sig, `aud == own origin`, `nonce ==` cookie, `exp` fresh,
>   `login ∈ ADMIN_LOGIN` — there is no `jti` replay check
>
> See `security-model.md` §4 for the consequences (sessions can't be revoked).

### 3.2 Security properties

- **No cross-tenant forgery** — tenants hold only the public key. ✓ (the requirement)
- **client_secret stays on the broker.** ✓
- **`aud` binding** — a token minted for tenant A is rejected by tenant B. ✓
  *and*, since 2026-07-25, by the broker's own `/api/token` (§3.3).
- **CSRF** — the `nonce` cookie must match the `nonce` echoed through `state`. ✓
- **Replay-bounded** — ❌ **NOT IMPLEMENTED.** Superseded by §3.4-B: `exp` is 7
  days and there is no `jti`. Only the `nonce` is one-shot, and only on the
  tenant side. Treat a handoff token as a 7-day bearer.
- **`ADMIN_LOGIN` is the real boundary** (§3.3). ✓ — but it is *a* boundary, not
  the only one; see the correction in §3.3.

### 3.3 Origin handling — the original argument, and why it was wrong

**Original reasoning (kept for the record):** the broker redirects a freshly-minted
token to the `origin` it read from `state`, which an attacker *could* forge. That
was judged fine because the receiving tenant's own `ADMIN_LOGIN` check rejects any
login that isn't its owner — so a token phished onto the wrong origin is only
usable where that user is already admin. Hence no origin allowlist, no tenant
registry, stateless broker.

**Correction (2026-07-25 review).** The argument holds only while **tenants are the
only consumer** of a broker-signed token. They are not — the broker's own
`/api/token` is a second consumer, and it authorized on `owner == login` alone.
So a token minted for `aud: https://evil.com` (the attacker builds the authorize
URL themselves; a victim who has already authorized the App is redirected with no
consent screen) could be POSTed to `/api/token` to mint `Contents:write` on **any**
repo the victim owns — full repo takeover, and via the Pages build, code execution.

**Fix:** `/api/token` now binds the audience to the repo —
`audienceAllowedForRepo()` in `functions/_lib/tenant-origin.ts` recomputes the
tenant's expected origin from `owner`+`repo` (the Pages project name is derived
from them — see `security-model.md` §2 — so this needs no new state) and requires
`aud` to match, plus any custom domains listed in `ALLOWED_TENANT_ORIGINS`. The
broker stays stateless.

The general rule, now in `security-model.md` §1 (I4): **an audience claim is
worthless unless every consumer checks it.** Adding a third consumer of these
tokens means adding the check there too.

### 3.4 Self-configuring tenant — `ADMIN_LOGIN` solved, session handling OPEN

Because a tenant deploy can't be handed a secret cleanly (§5.1), we minimize what it
needs:

- **`ADMIN_LOGIN` — solved.** It's a public GitHub username, not a secret. The broker
  creates the repo (§4) and commits the owner login into it (e.g. `site.json →
  lanza.owner`). No secret store, no injection. `handoff.ts` reads it from the built
  site config.

- **Session signing — OPEN DESIGN POINT.** The tenant must turn a valid handoff into a
  7-day session. Two candidates, and the choice interacts with hosting (§5):

  | | **A — tenant-held `SESSION_SECRET`** | **B — broker-signed session** |
  |---|---|---|
  | How | tenant generates a secret once, stores it in a **KV/D1 binding**, HMAC-signs its own cookie (today's `session.ts`) | broker mints a `{login, aud, exp:7d}` RS256 token; tenant sets it as the cookie; middleware verifies with the **public key** (no tenant secret at all) |
  | Needs | a storage binding the tenant must provision (free w/ the button; **one dashboard step on guided-Pages**) | nothing extra on the tenant; a longer-lived token delivered via redirect (mitigate URL exposure) |
  | Cost | one more setup click on Pages | a small round-trip to re-issue on expiry, or a refresh flow |

  **DECIDED (2026-07-04): B** — the broker mints an RS256-signed session token; the
  tenant sets it as an HttpOnly cookie and `_middleware.ts` verifies it with the
  baked-in public key. **Zero per-tenant secrets, no provisioned binding.** Mitigate
  the longer-lived token's URL exposure by delivering it via the handoff redirect once
  and immediately re-issuing as an HttpOnly cookie (never re-exposed in a URL after).

### 3.5 Files (Phase 1)

- **Tenant (main repo):** `functions/admin/api/auth/login.ts` (redirect → broker +
  nonce cookie); new `functions/admin/api/auth/handoff.ts`; `functions/_lib/session.ts`
  (add RS256 verify + public-key import; keep HMAC only if §3.4-A wins);
  `functions/admin/_middleware.ts` (verify path per §3.4 choice); retire the old
  per-tenant `callback.ts` (or keep behind a Model-A flag for the dogfood site).
- **Broker:** `functions/api/auth/callback.ts` (shared-app exchange + mint handoff);
  `functions/_lib/handoff.ts` (RS256 sign).
- **Template repo:** ship `HANDOFF_PUBLIC_KEY` + the committed `lanza.owner`.

### 3.6 Verification (Phase 1)

Broker + one tenant on `*.pages.dev`: unauth `/admin` → GitHub → lands authed; wrong
GitHub account → rejected; token minted for tenant A rejected by tenant B (aud);
expired token rejected; byte-flipped token rejected; nonce-mismatch rejected.

---

## 4. Phase 2 — Repo creation (OAuth `public_repo`, broker-driven)

**VERIFIED:** a *user OAuth token* with `public_repo` drives `POST
/repos/{template}/generate` directly — no App token, no `Administration:write`. (And
when a *GitHub App* uses `/generate`, the new repo is **not** auto-added to its
installation — another reason to prefer the OAuth path.)

Flow (replaces the shipped `/generate`-via-App path):

1. Wizard "Connect GitHub" → OAuth `public_repo` (one-time).
2. `POST /repos/{TEMPLATE}/generate` with the user token → tenant repo created; broker
   commits `lanza.owner` (§3.4).
3. Install `lanza-cms` App on **just that repo** (Contents-only) for ongoing edits;
   **discard** the OAuth token.
4. `ensureStaging` (already built) → hand to Phase 3.

Rework target: `lanza-broker/functions/_lib/gh-app.ts` `generateFromTemplate` +
`functions/api/onboard/setup.ts`. **This phase stands** (the button, which would have
absorbed it, is deferred — §5.1).

---

## 5. Phase 3 — Hosting: manual Pages+Git connect, everything else via CF OAuth

**DECIDED (2026-07-05):** the user does exactly **two** things by hand; a **Lanza
Cloudflare OAuth client** does all the rest headless. (Supersedes the earlier
"no OAuth path, fully guided-dashboard" verdict — Cloudflare shipped third-party
OAuth clients, GA "OAuth for all" 2026-06.)

- **User-done (accepted, not worth automating):** create the free Cloudflare account +
  Pages project and authorize the **"Cloudflare Workers and Pages"** GitHub app on
  their account. This is the one step no CF credential can self-grant —
  `source:{type:github}` returns 8000010/8000011 until that GitHub-side app authorize
  exists (**VERIFIED**). It's CF↔GitHub consent, outside anything our OAuth can reach.
- **OAuth-done (headless):** the user authorizes Lanza's CF OAuth client **once**; the
  broker then drives every other CF operation with the granted token — resource
  provisioning (KV/D1/R2), build config, deploys, status polling. No user-created API
  token, no secret typed.

Token lifecycle (**VERIFIED 2026-07-05**): the access token is a **~16h bearer** AND a
**refresh token IS available** — the recipe is enable **both** the `authorization_code`
and `refresh_token` grant types on the client AND request the **`offline_access`** scope
(grant alone or scope alone → no refresh token; both → one comes back). So the broker
**consents once, then refreshes silently** in the background; the user does not re-auth
every 16h. The broker stores `{access, refresh, expires_at}` and refreshes on demand.
**Open sub-point:** where the runtime
`functions/admin/api/cf/[[path]].ts` proxy sources the token — broker-injected into the
tenant Pages project vs. proxied through the broker — resolve when wiring Phase 3.

No Workers migration; no CF API token from the user; no secret typed (given §3.4-B).

**VERIFIED end-to-end (2026-07-05).** Built + proven live on `lanza-broker.pages.dev`:
`functions/api/auth/cf/{login,callback}.ts` (confidential client, `client_secret_post`,
CSRF `state` cookie). The **entire headless chain works**: authorize → consent → code →
token exchange → `GET /accounts` + `GET /pages/projects` (read) → **`POST /pages/projects`
with a github source (create + connect repo) → `POST …/deployments` (trigger build) →
a real `index.html` deployed and served live at `*.pages.dev`** — zero dashboard steps
after the one-time git authorize. Concrete facts learned:
- **Endpoints** (`dash.cloudflare.com`): `/oauth2/auth`, `/oauth2/token`, `/oauth2/userinfo`.
- **Scopes must be sent explicitly** — omitting `scope` triggers a generic "unexpected
  error" at consent. Scope IDs are **dot notation = API-token permission IDs** (not the
  `resource:access` colon strings wrangler uses); fetch via `GET /client/v4/oauth/scopes`.
- **Scope set (trimmed 2026-07-10 for public-app publishing):** `account-settings.read`
  (resolve account id), `page.read` **+ `page.write`** (create/deploy Pages — read alone →
  10000 auth error on POST) **+ `offline_access`** (refresh token). The client must be
  configured with these scopes AND both grant types (`authorization_code` + `refresh_token`).
  Dropped `user-details.read`, `workers-kv-storage.write`, `d1.write`, `workers-r2.write`:
  the OAuth token never called KV/D1/R2 or `/user` — that provisioning runs on the separate
  hand-made `CLOUDFLARE_API_TOKEN` (cf-proxy). Re-add only if the proxy moves onto this token.
- **Two deploy gotchas:** (a) `page.write` is required to create a project, not just read;
  (b) creating a git-sourced project **does not auto-deploy** — the UI shows "no deployment"
  until a push or an explicit **`POST …/deployments`** (branch=main), which we now call so no
  dummy commit is needed.
- **The one manual step** (git authorize) is handled by deep-linking the user to
  **`github.com/apps/cloudflare-workers-and-pages/installations/new`** right after the CF
  OAuth (warm CF session) — same install Cloudflare's own "Connect to Git" funnels to; the
  account link rides the CF session cookie. No API to confirm it (feature request open), so
  the `POST /pages/projects` attempt is the detector (succeeds once linked; 8000010 until).
- **Redirect URI must exactly match** a registered one; broker now on `connect.lanzacms.com`
  (custom domain) — `lanza-broker.pages.dev` kept during transition.

### 5.1 Why the Deploy-to-Cloudflare button is deferred

The button (`deploy.workers.cloudflare.com`) would collapse steps by having Cloudflare
run the connect+clone+deploy. **VERIFIED behavior:**

- ✅ clones the template into the user's own repo; connects CI/CD; auto-provisions &
  binds **KV/D1/R2/DO**; performs the git authorize the API can't.
- ❌ **Workers-only** — needs a `wrangler.jsonc`; an Astro **+ Pages-Functions** repo
  (what Lanza is) won't deploy without a **full Pages→Workers migration**.
- ❌ **No secret injection** — every declared secret is a mandatory user-typed form
  field (blank blocks deploy, issue #14075); no URL param passes a value.
- ❌ **No callback** — the broker never learns what was created.
- ❌ template must be **public**; no monorepo.

**Verdict:** the button buys ~one fewer user click and costs a whole-app hosting
migration. Bad v1 trade. Revisit **if/when** we move to Workers for platform reasons
(Cloudflare is steering new full-stack projects to Workers Static Assets) — the button
comes nearly free then, and its free KV would make §3.4-A viable.

---

## 6. Phase 4 — Thin repo + `@lanza/site`

**VERIFIED:** a Pages build (`npm install && build`) pulling a versioned package works.
Pin **Node 22** (`NODE_VERSION`/`.nvmrc`; build image v3) to match `@lanza/site`; keep
`@lanza/site` **public** (a private pkg needs `.npmrc` + `NPM_TOKEN` per project).

Tenant repo holds **content only** (`content/`, `schema.json`, `package.json`); the CMS
+ Astro + admin ship as versioned `@lanza/site`, pulled at build. Auto-update via a
`@lanza/site@stable` tag: land on the dogfood canary first, advance `stable`, fan-out
redeploy. Fix core once → every site gets it next build.

---

## 7. Phase 5 — Wizard (broker UI, lanzacms.com)

The target flow (name → instant preview → Connect GitHub → guided Cloudflare connect →
pick address → land in `/admin`). Built in the broker, **skinned in the flat Freehold
identity** now shared by the CMS so onboarding and the editor read as one product.

---

## 8. Prerequisites (only Dave can provision; gate Phases 1–3 going live)

1. **Register the `lanza-cms` GitHub App** — *Contents: read/write* on installed repos,
   account identity read, **user authorization (web) enabled**; a Setup URL;
   generate a private key. Record App ID, client_id, client_secret.
   **Callbacks live on the BROKER, not the tenant** — the code sends
   `https://connect.lanzacms.com/api/auth/callback` (`functions/_lib/tenant-config.ts`).
   Two must be registered:
   - `https://connect.lanzacms.com/api/auth/callback` — CMS login
   - `https://connect.lanzacms.com/api/oauth/github-callback` — MCP authorization server
   (An earlier draft of this doc said `https://lanzacms.com/api/auth/callback`. That
   is wrong; registering it would break `/admin` login for every tenant.)
2. **Generate the handoff keypair** (I'll give exact `openssl` commands): private →
   broker secret `HANDOFF_PRIVATE_KEY`; public → template repo.
3. **Register the Lanza CF OAuth client** (Manage Account → OAuth clients) — **DONE +
   verified 2026-07-05.** Config that works: Response Type **Code**, grant
   **Authorization Code**, token auth **Client Secret POST**, scopes = the four IDs in
   §5, redirect URIs include `https://lanza-broker.pages.dev/api/auth/cf/callback` (add
   the lanzacms.com one once that domain fronts the broker). Domain-verification TXT
   required. client_id + client_secret recorded.
4. **Broker secrets** (Pages) — the code reads all of these; a missing one fails at
   runtime, usually with an error that points somewhere else:

   | Var | Used by | Missing → |
   |---|---|---|
   | `GH_APP_ID`, `GH_APP_PRIVATE_KEY` | `/api/token`, `/api/onboard/setup` | 500 "Broker not configured" |
   | `GH_APP_CLIENT_ID`, `GH_APP_CLIENT_SECRET` | `/api/auth/callback` (CMS login) | login fails at code exchange |
   | `HANDOFF_PRIVATE_KEY` | signs the handoff | login fails |
   | **`HANDOFF_PUBLIC_KEY`** | **`/api/token` verifies tenant sessions** | **every tenant's first save 500s** |
   | **`OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`** | **`/api/onboard/oauth/*`** — the *classic OAuth App* (`public_repo`, for `/generate`), **not** the GitHub App | **onboarding step 2 500s; onboarding cannot start** |
   | `GH_APP_SLUG` | `/api/onboard/oauth/callback` (install link) | defaults to `lanza-cms` |
   | `TEMPLATE_OWNER`, `TEMPLATE_REPO` | repo creation | onboarding fails |
   | `CLOUDFLARE_OAUTH_CLIENT_ID`, `CLOUDFLARE_OAUTH_CLIENT_SECRET` (§5) | CF connect + deploy | step 3 fails |
   | **`ALLOWED_TENANT_ORIGINS`** | **`/api/token` audience binding (§3.3)** | **custom-domain tenants can't save.** Set `https://lanzacms.com` — that site's repo is `lanza`, so the derived origin is `lanza-76cae1b6cc54.pages.dev` (see `security-model.md` §2), which won't match its real domain. |

   Note §8.1 registers the **GitHub App**; `OAUTH_CLIENT_ID`/`SECRET` come from a
   **separate classic OAuth App** — repo creation deliberately runs on its
   `public_repo` grant so the App needs no Administration permission (§4).
5. **Thin template repo** (Lanza-owned, public) — content-only (Phase 4 shapes it).
6. **Broker Pages project + lanzacms.com domain.**

## 9. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-04 | Commit to **Model B** (managed onboarding, self-owned accounts) | Dave |
| 2026-07-04 | Login = **broker-mediated shared-app** flow | GitHub Apps cap at 10 callbacks → can't do per-tenant |
| 2026-07-04 | Handoff = **asymmetric RS256**, tenants verify-only | shared HMAC → one tenant could forge sessions for all |
| 2026-07-04 | **No** origin allowlist / broker-signed tenant credential | the tenant's own `ADMIN_LOGIN` check is the real gate (§3.3) |
| 2026-07-25 | **Reversed in part**: `/api/token` binds `aud` to the repo | the 2026-07-04 rationale assumed tenants were the only consumer of a broker-signed token; `/api/token` is a second one, and checked ownership only (§3.3) |
| 2026-07-25 | `/admin` middleware checks `adminLogin`, not just a valid signature | a signature only proves the broker authenticated *someone* — see `security-model.md` I1 |
| 2026-07-25 | Pages project name = `<repo-slug>-<sha256(owner/repo)[0..12]>`, **not** the repo name | `*.pages.dev` is global across all Cloudflare accounts, so ordinary repo names collided with strangers on the first try — and the collision read as success. Kept *derivable* (rather than random) so `/api/token` can still recompute a tenant's origin with no store. See `security-model.md` §2 |
| 2026-07-25 | Cloudflare account is **chosen**, not `accounts[0]` | anyone in >1 account had their site created in whichever listed first; the POST and polling GET also resolved it independently, stranding the wizard. Stored in the `lanza_cf` cookie |
| 2026-07-04 | `ADMIN_LOGIN` = **owner login committed into the repo** at creation | it's public, not a secret — no store/injection needed |
| 2026-07-04 | Session signing = **B — broker-signed, public-key verified** | removes the last per-tenant secret + needs no provisioned KV on Pages (§3.4) |
| 2026-07-04 | **Dogfood our own site first** as tenant #0 / canary | feel the onboarding + new-auth pain before a real customer does |
| 2026-07-04 | `@lanza/site` extraction **IN v1 scope** (Dave, reversed the earlier defer) | thin content repo is the point — do the code/content split as part of v1, not later |
| 2026-07-04 | Repo creation = **OAuth `public_repo` once + App Contents-only** | avoids App Administration/all-repos + the `/generate` install gotcha |
| 2026-07-04 | Hosting = **guided dashboard connect on Pages** | no API path wires git-integration; the one authorize is unavoidable |
| 2026-07-04 | **Deploy button deferred** | Workers-only → whole-app migration to save ~one click |
| 2026-07-04 | Publishing stays **staging → main** merge | unchanged |
| 2026-07-05 | Hosting = **user manually creates Pages project + authorizes the CF GitHub app; all other CF ops via a Lanza CF OAuth client** (Dave) | OAuth-for-all shipped 2026-06; the git-authorize is the only step no CF credential can self-grant — not worth automating |
| 2026-07-05 | CF OAuth = **consent once, broker refreshes silently** | refresh token IS available — recipe: `authorization_code`+`refresh_token` grants on the client + `offline_access` scope (both needed); ~16h access token, refresh in background |
| 2026-07-05 | CF OAuth **verified end-to-end** on `lanza-broker.pages.dev` (`/api/auth/cf/{login,callback}`) | token exchange + `GET /accounts` work; scopes must be sent explicitly as dot-notation IDs (§5) |
| 2026-07-05 | **Full headless deploy chain proven** — token creates git-sourced Pages project + triggers deployment → live site | needs `page.write`; git-create doesn't auto-deploy so `POST …/deployments` after; the one manual git-authorize = deep-link `github.com/apps/cloudflare-workers-and-pages/installations/new` (Dave) |

## 10. Build order

Phase 1 (auth keystone — pure code, testable on previews; resolve §3.4 first) → Phase 2
(repo creation) → Phase 3 (guided-hosting = mostly wizard copy + docs) → Phase 4 (thin
repo/package) → Phase 5 (wizard UI). Each verifies on a `*.pages.dev` preview.

## 11. Review resolutions

1. **§3.4 session signing** — ✅ **B** (broker-signed, public-key verified). Locked.
2. **Dogfood** — ✅ migrate our own site to the shared-app flow **first**, as tenant #0
   / canary. (Dave rec-confirmed.)
3. **Custom domains** — ⏸ deferred; v1 ships `*.pages.dev`. Revisit post-v1.
4. **`@lanza/site` extraction** — ✅ **deferred**; v1 ships a fat template, extract the
   package as a follow-up once the flow is proven end-to-end.

Remaining before Phase-1 code: Dave's prereqs in §8 (register the `lanza-cms` GitHub
App + hand over the App ID / client id+secret; generate the handoff keypair).
