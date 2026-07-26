# Onboarding broker — operator runbook (the parts only Dave can do)

The one-time setup behind a working broker. **Already done for
`connect.lanzacms.com`** — this is here for rebuilding it, rotating a credential, or
standing up a second broker.

For what each credential authorizes and what breaks if it leaks, see
`keys-and-secrets.md` — that file is the inventory; this one is the procedure.

> ⚠ GitHub/Cloudflare UI labels drift — if a field name here doesn't match exactly,
> match by intent and tell me.

## 1. Register the `lanza-cms` GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.

- **Name:** `Lanza CMS` (slug becomes `lanza-cms`).
- **Homepage URL:** `https://lanzacms.com`
- **Callback URL (the "Sign in with GitHub" web flow):**
  `https://connect.lanzacms.com/api/auth/callback`  ← the single shared callback the
  whole design hinges on. It points at the **broker**, not a tenant: the App can only
  register a handful of callbacks, so it cannot point at each customer's domain.
- **Setup URL (where GitHub returns after an install):**
  `https://connect.lanzacms.com/api/onboard/setup`  · leave "Redirect on update"
  unchecked.
- **Webhook:** uncheck **Active** (not needed yet).
- **Permissions → Repository → Contents: Read and write.** (Nothing else — this is the
  standing access a tenant grants: one repo, content only.)
- **Account permissions:** none needed (identity/login comes from the user web-flow
  token, which needs no extra scope).
- **Where can this be installed:** **Any account** (multi-tenant).
- Create the app, then on its page:
  - **Generate a client secret.** Record **Client ID** + **Client secret**.
  - **Generate a private key** (downloads a `.pem`). Record the **App ID** (top of page).

## 2. Generate the handoff keypair (RS256)

The broker signs session/handoff tokens with the private key; tenants verify with the
public key (baked into the template — safe, it's public). See design §3.

```bash
# private key (PKCS#8 PEM)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out handoff_private.pem
# public key (SPKI PEM)
openssl rsa -pubout -in handoff_private.pem -out handoff_public.pem

# single-line base64 for env vars (Linux: -w0 ; macOS: use `base64 -i <file>`)
base64 -w0 handoff_private.pem   # → HANDOFF_PRIVATE_KEY  (broker secret)
base64 -w0 handoff_public.pem    # → HANDOFF_PUBLIC_KEY   (template/tenant)
```

Also base64 the GitHub App private key the same way for the broker:
```bash
# convert the downloaded App key to PKCS#8, then base64 (matches gh-app.ts importer)
openssl pkcs8 -topk8 -nocrypt -in lanza-cms.*.private-key.pem -out gh_app_pkcs8.pem
base64 -w0 gh_app_pkcs8.pem       # → GH_APP_PRIVATE_KEY  (broker secret)
```

## 3. Broker secrets (Cloudflare Pages → the broker project)

Set via **Pages → Settings → Variables & Secrets** (as *Secret*), or
`wrangler pages secret put <NAME>`:

| Secret | Value |
|---|---|
| `GH_APP_ID` | the App ID from §1 |
| `GH_APP_PRIVATE_KEY` | base64 PKCS#8 from §2 |
| `GH_APP_CLIENT_ID` | Client ID from §1 |
| `GH_APP_CLIENT_SECRET` | Client secret from §1 |
| `HANDOFF_PRIVATE_KEY` | base64 private key from §2 |
| `TEMPLATE_OWNER` / `TEMPLATE_REPO` | the thin template repo (§Phase 4) |

## 4. Template repo

- `HANDOFF_PUBLIC_KEY` (base64 SPKI from §2) — committed as a Pages var or a config
  file the tenant middleware reads.
- The committed **owner login** slot (`lanza.owner`) is written by the broker at repo
  creation, not by you.

## 5. The second OAuth client (onboarding)

Repo creation cannot use the App's login client, because login is deliberately
scopeless. Register a separate OAuth client with `public_repo` and set
`OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET`. Reasoning: `keys-and-secrets.md` §3.

## 6. Cloudflare OAuth client

Response Type **Code**, Token Auth **Client Secret POST**, grant type
`authorization_code`, redirect URI exact-match
`https://connect.lanzacms.com/api/auth/cf/callback`. Set
`CLOUDFLARE_OAUTH_CLIENT_ID` / `_SECRET`.

The `refresh_token` grant is **no longer needed** — since 2026-07-25 the broker does
not request `offline_access` and never refreshes (onboarding is a single ≤1h session;
`keys-and-secrets.md`). Leaving the grant enabled is harmless. Scopes the client must
offer: `account-settings.read`, `user-details.read`, `page.read`, `page.write`.

## 7. Verify it works

- `GET https://connect.lanzacms.com/api/onboard/status` → 200 JSON
- Run the wizard against a throwaway GitHub account whose Cloudflare account has **no**
  git connection record — that is the only state in which step 3 is actually exercised
  (`onboarding-workflow.md` §3). Check with
  `/accounts/<id>/pages/connections` → must be `result: []` before you start.

---

# The one manual step — Cloudflare connects itself to GitHub

> **Rewritten 2026-07-25 after the first live run.** This section used to describe the
> user creating the Pages project by hand and typing build settings. None of that
> happens any more — the broker creates the project and triggers the deploy. What
> survives is a single click, and it is *not* the one this doc originally described.
> Full detail: `onboarding-workflow.md` §3.

The user's only manual act here is letting **Cloudflare** connect itself to GitHub.
The wizard opens Cloudflare's own account-scoped page:

```
https://dash.cloudflare.com/<accountId>/pages/new/provider/github
```

They click **GitHub → Connect GitHub → Install & Authorize** (choosing just their
repo), and can close the tab. The wizard is polling and takes over.

**Why it must be Cloudflare's page, not GitHub's.** Cloudflare stores an account-level
git *connection record* and only writes it when Cloudflare itself starts the install —
its URL carries a `state` that binds the installation back to the account. Sending the
user to `github.com/apps/cloudflare-workers-and-pages/installations/new` skips that, no
record is written, and every project create then fails with `8000011`. Confirmed both
directions against `/accounts/<id>/pages/connections`.

**The trap.** If that App is *already* installed on their GitHub account, Cloudflare's
own flow dead-ends at `github.com/settings/installations/<id>` and writes nothing —
their bug, reproduced with our code out of the picture. They must uninstall
**Cloudflare Workers and Pages** and let Cloudflare reinstall it. The wizard hints at
this after ~6 polls.

**Build settings are no longer typed by anyone** — `deploy.ts` sets
`production_branch: main`, `npm run build`, `dist`, `NODE_VERSION=22` at create time,
and triggers the first deployment (a git-sourced create does not auto-deploy).

**Nothing else is entered by the user**: no secrets, no `ADMIN_LOGIN`, no session key.
The project name is derived, not chosen (`security-model.md` §2).
