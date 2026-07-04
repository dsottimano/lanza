# Onboarding broker — operator runbook (the parts only Dave can do)

The one-time setup that unblocks Phase 1–3 going live (see
`docs/onboarding-broker-design.md` §8). Do these once; hand me the recorded values
(or set them as secrets yourself) and I can wire the code end-to-end.

> ⚠ GitHub/Cloudflare UI labels drift — if a field name here doesn't match exactly,
> match by intent and tell me.

## 1. Register the `lanza-cms` GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.

- **Name:** `Lanza CMS` (slug becomes `lanza-cms`).
- **Homepage URL:** `https://lanzacms.com`
- **Callback URL (the "Sign in with GitHub" web flow):**
  `https://lanzacms.com/api/auth/callback`  ← this is the single shared callback the
  whole design hinges on.
- **Setup URL (optional, for the install→repo flow later):**
  `https://lanzacms.com/api/onboard/setup`  · leave "Redirect on update" unchecked.
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

## 5. Hand-off to me

Give me: **App ID, Client ID, Client secret** (or confirm they're set as broker
secrets), and the **public key** file. Then I wire `login.ts` → broker, the broker
`callback.ts` + `handoff.ts`, and the tenant `handoff.ts`/middleware, and we test the
round-trip on a `*.pages.dev` preview.
