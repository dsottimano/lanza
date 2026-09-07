# Keys, secrets, and who trusts whom

Every credential in Lanza: what it is, who holds it, what it authorizes, and what
breaks if it leaks. Rewritten 2026-08-29, after the release that deleted most of them.

Companions: `security-model.md` (the invariants — **authoritative on authz**),
`onboarding-workflow.md` (the flow these credentials drive), `release-plan.md` (why the
deleted ones were deleted).

---

## 1. The shape of the problem

A tenant site is a static Cloudflare Pages deployment of *the customer's own* repo, in
*the customer's own* Cloudflare account. It must let the right people edit content, and
must write to GitHub to do it — while being a public static site with no server-side
storage of its own.

The old answer was an asymmetric split: the broker held every private key and signed
sessions tenants could only verify. It worked, and it meant one Worker held a key to
every customer's site.

**The current answer is that there is nothing to hold.** Sign-in is GitHub Device Flow,
which needs a `client_id` and no secret. The person's own token does the writing.
Authorization is `permissions` on the repo, asked of GitHub per request. No key signs
anything a tenant accepts, so no key can be stolen to impersonate one.

| | Broker (`connect.lanzacms.com`) | Tenant (`<project>.pages.dev`) |
|---|---|---|
| Holds | two OAuth client secrets, onboarding-only | nothing required; one optional Cloudflare token |
| Can | create a repo and a Pages project *for a consenting user* | spend the token the signed-in person brought |
| If compromised | future onboardings; **no existing tenant** | that one site, until the person's token is revoked |

---

## 2. The tenant holds nothing, and that is the design

A tenant site needs **no configuration to work**. Everything it must know is either
committed to the repo or asked of GitHub at request time:

- `lanza.config.json` — `{owner, name}`, plus optional `domains` and `pagesProject`.
  Which repo this site edits. **Not who may edit it**; that question goes to GitHub.
- `functions/_lib/tenant-config.ts` — two public GitHub App client ids
  (`lanza-cms` for sign-in, `lanza-agents` for MCP) and the broker's origin. Public by
  definition: a client id appears in every authorize request.

### What a sign-in actually is

Three HttpOnly cookies on `/admin`, all from GitHub Device Flow
(`functions/_lib/device-flow.ts` — grep it for "secret"; there is none):

| Cookie | Life | What it is |
|---|---|---|
| `lanza_gh` | 8h | the GitHub user access token (`ghu_`) |
| `lanza_gh_refresh` | 184d, rotating | refreshed server-side, silently, on expiry |
| `lanza_gh_device` | 15m | the device code, for the length of one sign-in |

The refresh window slides, so **a person who opens the CMS at least once every 184 days
enters a device code exactly once, per browser, ever.** Refresh needs only the
`client_id`, verified live.

Revocation is real: the role is re-read from GitHub at most 60 seconds old, so removing
someone's repository access locks them out within a minute. The session this replaced
was a 7-day bearer that could not be revoked at all.

---

## 3. Two GitHub Apps, and why they are two

| | `lanza-cms` | `lanza-agents` |
|---|---|---|
| Client id | `Iv23ct5fK2N5QtDUbzyx` | `Iv23lieeiFXkwsOETNGj` |
| Used for | signing in to `/admin` | the MCP bearer an agent carries |
| Permissions | Contents: read/write | Contents: read/write |
| **Expire user tokens** | **on** — 8h + refresh | **off** — permanent until revoked |
| Private key | **none — deleted** | none, never generated |

The expiry setting is the whole difference, and it is a genuine trade in both
directions. A CMS cookie should be short-lived because the server can refresh it
invisibly. An MCP token is pasted into another program's config where nothing can
refresh it, so expiry would mean re-pasting three times a day. One App cannot be both;
the setting is App-wide.

**Neither App has a private key.** A private key mints *installation* tokens — acting as
the App, on every repo it is installed on. Device flow needs only the public client id,
so the key was pure blast radius and it is gone. The App itself stays installed on each
tenant repo, because a user-to-server token only reaches repositories the App is
installed on.

> **What that means for revocation.** A person revokes their own access at
> github.com/settings/applications (immediate, per person). An *owner* removes the App
> from a repository in that repo's settings, which cuts every token for that site at
> once.

## 3a. Two OAuth client pairs on the broker — not a duplicate

| Env | Belongs to | Used by | Scope | Purpose |
|---|---|---|---|---|
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | a classic OAuth App | `api/onboard/oauth/{start,callback}` | `public_repo` | create the tenant's repo from the template, write `lanza.config.json`, cut `staging`. Discarded immediately after |
| `CLOUDFLARE_OAUTH_CLIENT_ID` / `_SECRET` | the Lanza Cloudflare OAuth client | `api/auth/cf/{login,callback}` | four (below) | create the Pages project and trigger the first deploy |

Repo creation runs on a classic OAuth App on purpose: it keeps the GitHub App off the
`Administration` permission. **Neither user token is ever persisted** — the GitHub one
is discarded in the callback, and the Cloudflare one lives in an HttpOnly cookie for at
most an hour.

Both are useless without a fresh user authorization. That is why a broker compromise no
longer reaches an existing tenant: there is nothing there to replay.

---

## 4. Cloudflare credentials

**Onboarding** uses the OAuth client above, scoped to four permissions, each with a
caller: `account-settings.read` (resolve the account), `user-details.read` (name the
account in the wizard), `page.read` and `page.write` (create the project, trigger the
deploy). `page.read` alone returns `10000` on a create.

The token lands in `lanza_cf` — HttpOnly, `Max-Age=3600`, carrying no refresh token
(`offline_access` is not requested), so it is bounded by the cookie's own hour.

**After onboarding, Lanza holds no Cloudflare credential for any tenant.** The CMS's
hosting features (Site Health, KV/D1/R2 provisioning) are **opt-in and off by default**:
the tenant creates their own API token and sets `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `PAGES_PROJECT` on their own Pages project. Until they do,
those panels 503 and say why.

That was a decision, not an omission. A broker-held token store would have made one
namespace custodian of `page.write` on the entire fleet. The store-nothing alternative
was **verified impossible**: Cloudflare's OAuth vocabulary has 371 scopes, none grant
API-token management, and `GET /user/tokens` on an OAuth token returns `403 code 9109`.

---

## 5. Complete inventory

### Broker (Cloudflare Pages → Settings → Variables & Secrets)

| Name | Kind | Consumer | Leak impact |
|---|---|---|---|
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | OAuth client | `onboard/oauth/*` | Obtain `public_repo` as users who consent. No existing tenant is reachable. |
| `CLOUDFLARE_OAUTH_CLIENT_ID` / `_SECRET` | OAuth client | `auth/cf/*` | Obtain Cloudflare tokens as users who consent. Same bound. |
| `GH_APP_SLUG` | plain (default `lanza-cms`) | `onboard/oauth/callback.ts` | None. |
| `TEMPLATE_OWNER` / `TEMPLATE_REPO` | plain | `_lib/gh-app.ts` | None. |

**Deleted 2026-08-29** — if any of these still exists anywhere, remove it:
`HANDOFF_PRIVATE_KEY`, `HANDOFF_PUBLIC_KEY`, `GH_APP_ID`, `GH_APP_PRIVATE_KEY`,
`GH_APP_CLIENT_ID`, `GH_APP_CLIENT_SECRET`, `ALLOWED_TENANT_ORIGINS`, `FANOUT_SECRET`.

Deleting the Pages secret is half the job. **The App's private keys must also be deleted
on GitHub**, or a copy still exists and the blast radius is unchanged.

### Bot (Cloudflare Worker `telegram-bot`, `wrangler secret put`)

| Name | Kind | Leak impact |
|---|---|---|
| `BOT_TOKEN` | Telegram bot token | Full control of the bot: read every allow-listed chat, post as it. |
| `BOT_INFO` | `getMe` JSON | None — public metadata. |
| `WEBHOOK_SECRET` | plain bearer | Drive the draft-creation path directly, bypassing Telegram. |
| `GITHUB_TOKEN` | fine-grained PAT | **The only long-lived standing repo-write credential left in the system.** `Contents: read+write` on `dsottimano/lanza`. |

**The bot's PAT cannot be eliminated.** It is an unattended Worker with no human at a
browser, and device flow needs one. A machine that writes a repo has to hold something.
What it can be is *scoped* and pointed at `staging` rather than `main` — still owed.

It is also the one credential that contradicts the headline: "no standing repo-write
credential exists" is true of the product and false while the bot is deployed. It writes
to one repo, ours.

### Tenant

| Name | Required? | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `PAGES_PROJECT` | no | Opt-in hosting features. The tenant's own token, on their own project. |
| `GITHUB_CLIENT_ID` | no | Override the committed `lanza-cms` client id. |
| `AGENT_CLIENT_ID` | no | Override the committed `lanza-agents` client id. |
| `BROKER_ORIGIN` | no | Override the compiled `https://connect.lanzacms.com`. |

Nothing on that list is needed for a tenant to work.

### Committed, not secret

`lanza.config.json` at the tenant repo root — `{owner, name}`, plus optional `domains`
and `pagesProject`. Written by the broker during onboarding; the single source for
*which repo the CMS edits*. It no longer says who may edit — `adminLogin` and `editors`
were removed, because a list of ours could only ever disagree with GitHub.

> This file is why the generation race mattered: GitHub commits template content *after*
> `/generate` returns, so an early write was reverted by "Initial commit" and the tenant
> booted pointed at `dsottimano/lanza`. `setTenantConfig` waits for the placeholder and
> updates by SHA.

---

## 6. Rotation

| Credential | Procedure | Cost |
|---|---|---|
| A person's GitHub token | they revoke at github.com/settings/applications | They sign in again. Immediate. |
| An agent token | same, per App | The agent stops working until re-pasted. |
| A whole site's access | remove the App from the repository | Every token for that site dies at once. |
| Any OAuth client secret | regenerate on the provider, set the secret | In-flight authorizations fail; users retry. |
| The bot's PAT | regenerate on GitHub, `wrangler secret put` | Bot writes fail until set. |

There is no fleet-wide kill switch any more, because there is no fleet-wide key. That is
the trade the release made: nothing to rotate, because nothing is held.

**Owed now:**
- Delete every private key on the `lanza-cms` App (the Pages secret is only half).
- Rotate the exploratory Cloudflare API token and the broker `OAUTH_CLIENT_SECRET` —
  both were pasted or screenshotted in earlier sessions.
- Scope the local `gh` PAT down (`admin:org`, `admin:enterprise`, `delete_repo`).
- Point the bot's `GITHUB_TOKEN` at `staging`.
