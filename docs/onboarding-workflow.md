# Lanza Onboarding — The Explicit Workflow

Status: **2026-07-05.** The end-to-end *mechanics* are proven (a live site was deployed
headless from OAuth). What's left is the **wizard UI** that orchestrates them. This doc is
the explicit "life of an onboarding" — the *how it all fits*. The *why/decisions* live in
`onboarding-broker-design.md`; the GitHub-side details in there + `onboarding-runbook.md`.

**Model B:** the user owns their GitHub + Cloudflare accounts; the broker
(`connect.lanzacms.com`, repo `lanza-broker`) automates everything between the two
unavoidable sign-ups. Two manual acts survive by design: creating those two accounts, and
one GitHub↔Cloudflare authorize click (step 4). Everything else is headless.

---

## The full journey (new non-technical user)

Legend: ✅ proven/built · 🟡 built earlier, needs wizard wiring · 🔲 to build

| # | Step | How | State |
|---|---|---|---|
| 1 | Land on wizard | `connect.lanzacms.com` — name → instant preview → "Get started" | 🔲 (Phase 5) |
| 2 | **Connect GitHub** | OAuth (`public_repo`, one-time) → broker `POST /repos/{template}/generate` → new tenant repo; commit `lanza.config.json` (owner/name/adminLogin); ensure `staging` branch | 🟡 `functions/api/onboard/setup.ts` + `_lib/gh-app.ts` |
| 3 | **Connect Cloudflare** | CF OAuth → broker gets access + **refresh** token, stores `{access, refresh, expires_at}` | ✅ `functions/api/auth/cf/{login,callback}.ts` |
| 4 | **Authorize GitHub↔CF** | deep-link `github.com/apps/cloudflare-workers-and-pages/installations/new` while CF session is warm → CF links the install to their account | 🔲 (one click; the only unavoidable dashboard-side act) |
| 5 | **Create + deploy site** | with CF token: `POST /pages/projects` (github source) → `POST …/deployments?branch=main` → live `*.pages.dev` | ✅ proven end-to-end |
| 6 | **Land in /admin** | broker-mediated GitHub login → RS256 handoff → tenant session → the CMS | 🟡 (Phase 1 auth) |
| 7 | **Edit + publish** | CMS saves → broker mints repo-scoped edit-token → GitHub Contents write; publish = staging→main merge | 🟡 built |
| 8 | **Provision KV/D1/R2** (when a listing needs it) | CMS `cf/[[path]].ts` proxy → **through the broker** (Option B) using the CF token | 🔲 (decided, not built) |

---

## The Cloudflare OAuth recipe (hard-won — don't re-derive)

- **Endpoints** (`dash.cloudflare.com`): `/oauth2/auth`, `/oauth2/token`, `/oauth2/userinfo`.
  Discovery: `dash.cloudflare.com/.well-known/openid-configuration`.
- **Client config:** Response Type `Code`, Token Auth `Client Secret POST`, **both** grant
  types `authorization_code` **and** `refresh_token`, redirect URI exact-match. Client ID
  `4b126e72…`; secrets `CLOUDFLARE_OAUTH_CLIENT_ID` / `CLOUDFLARE_OAUTH_CLIENT_SECRET` in the
  broker Pages env.
- **Scopes are sent explicitly** in the authorize request (omitting `scope` → generic
  "unexpected error"). They are **dot-notation IDs = API-token permission IDs** (NOT
  wrangler's `resource:access` colon strings). Full list: `GET /client/v4/oauth/scopes`.
  Current set: `offline_access account-settings.read user-details.read
  workers-kv-storage.write d1.write workers-r2.write page.read page.write`.
- **Refresh token** requires the `refresh_token` grant on the client **AND** `offline_access`
  in scope — *both*, neither alone. Access token ~16h; broker refreshes silently.
- **Deploy gotchas:** `page.write` (not just `page.read`) to create a project — read alone
  → `10000` auth error. Creating a git-sourced project **does not auto-deploy**; follow with
  `POST /accounts/{id}/pages/projects/{name}/deployments` (`branch=main`) — no dummy commit.
- **Git-link detection:** no API to confirm the step-4 authorize exists (CF feature request
  open). The `POST /pages/projects` attempt IS the detector: succeeds once linked,
  `8000010/8000011` until. Retry.

---

## Invariants (do not violate)

1. **Never inhibit self-hosting developers.** CF access is dual-mode: if the tenant has its
   own `CLOUDFLARE_API_TOKEN`, the proxy uses it directly (no broker); else it proxies
   through the broker (managed). Same for auth (own GitHub OAuth + `ADMIN_LOGIN` vs.
   broker-mediated). The broker is an *optional layer over a self-sufficient CMS*.
2. **Broker holds secrets + tokens; tenants verify-only** (asymmetric RS256 handoff).
3. **Stay free-tier, all-Cloudflare; cache public routes** (repo CLAUDE.md rules).
4. **Token never exposed to the browser** — CF calls are server-side (proxy / broker).

---

## Code map

- **CF OAuth:** `lanza-broker/functions/api/auth/cf/{login,callback}.ts` — login builds the
  authorize redirect (+ `?scope=` / `?deploytest=owner/repo` debug overrides); callback
  exchanges the code and (currently) runs smoke tests incl. the deploy probe.
- **GitHub App / repo creation:** `lanza-broker/functions/_lib/gh-app.ts`,
  `functions/api/onboard/setup.ts`.
- **Broker-mediated login + handoff:** `lanza-broker/functions/api/auth/*` (GitHub side),
  tenant `functions/admin/api/auth/{login,handoff}.ts`, `functions/_lib/session.ts`.
- **Runtime CF proxy (tenant):** `functions/admin/api/cf/[[path]].ts` + `_lib/cf-proxy.ts`
  (allowlist). Today static-token; Option B adds the broker path.
- **Broker origin constant:** `functions/_lib/tenant-config.ts` → `BROKER_ORIGIN` (flip to
  `connect.lanzacms.com`).

---

## NEXT SESSION: build the onboarding wizard (Phase 5)

The mechanics are proven; assemble them into the guided UI on `connect.lanzacms.com`.

**Goal:** the step 1→6 flow above as a real wizard — name → instant preview → Connect GitHub
→ Connect Cloudflare → Authorize GitHub↔CF (deep-link) → we create+deploy → land in `/admin`.
Skinned in the flat Freehold identity the CMS uses so onboarding + editor read as one product.

**Sequencing notes for the wizard:**
- After **step 3 (Connect Cloudflare)** the CF session is warm — that's the moment to
  deep-link **step 4** (`github.com/apps/cloudflare-workers-and-pages/installations/new`).
- After step 4, **poll by attempting `POST /pages/projects`** (the only integration detector)
  — retry past `8000010` until it succeeds, then trigger the deployment and poll the
  `*.pages.dev` until it serves, then hand off to `/admin`.
- The `callback.ts` smoke-test scaffolding (create-project + trigger-deploy) is throwaway
  proof code — lift the *real* create+deploy into a proper broker endpoint the wizard calls,
  using the **stored** token (not inline in the OAuth callback).

**Also pending (can precede or follow the wizard):**
- **Option B** — broker CF-proxy endpoint + tenant `cf-proxy.ts` local-token-or-broker
  switch (invariant #1). This is what actually wires the CF token into the running CMS.
- Flip `BROKER_ORIGIN` → `connect.lanzacms.com`.
- Decide the broker's token store (KV? DO?) for `{access, refresh, expires_at}` per tenant.

**Cleanup owed from this session:**
- Delete test GitHub repo `dsottimano/lanza-deploytest-11556` and the two
  `lanza-deploytest-*` Pages projects.
- **Burn the API token** pasted in the session, and the CF OAuth flow's exploratory
  `?deploytest` scaffolding once the real endpoint exists.

See `onboarding-broker-design.md` §5 (verified block) + §9 (decision log) for full detail.
