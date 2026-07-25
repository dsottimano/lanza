# Life of an onboarding

How a stranger goes from nothing to a live site they own, in detail. **Status:
2026-07-25 — proven end to end.** `datadefine/bbbb` → `bbbb-2db67eab8649.pages.dev`,
driven as a third-party tenant (not as the Lanza owner), including `/admin` login, an
edit, a publish, and Cloudflare rebuilding from the merge.

Companions: `keys-and-secrets.md` (credentials), `security-model.md` (**authoritative
on authz**), `onboarding-broker-design.md` (why/decisions).

> The previous version of this file was written before the first live run and was
> wrong in one load-bearing way: it sent users to GitHub's App-install URL at step 3.
> That is precisely what produces `8000011`. See §3.

---

## 0. The model

The user owns their GitHub account and their Cloudflare account. The broker
(`connect.lanzacms.com`, repo `lanza-broker`) automates everything between them and
holds every secret; the tenant holds none.

**Three manual acts survive by design**, and only three:

1. create a GitHub account
2. create a Cloudflare account
3. let Cloudflare connect itself to GitHub (§3 — one click, on Cloudflare's own page)

Everything else is headless. The wizard's entire state is HttpOnly cookies on the
broker origin — no KV, no database.

| cookie | set by | carries |
|---|---|---|
| `lanza_gh` | `onboard/oauth/callback.ts` | `{owner, repo, login}` |
| `lanza_cf` | `auth/cf/callback.ts` | `{access, refresh, expires_at, account_id}` |
| `lanza_cf_state` | `auth/cf/login.ts` | CSRF nonce, 600s |

`POST /api/onboard/reset` expires all three. The page cannot — they are HttpOnly.

---

## 1. Name → repo (steps 1–2)

The visitor types a site name and clicks through to GitHub OAuth
(`OAUTH_CLIENT_ID`, scope `public_repo`).

In the callback (`onboard/oauth/callback.ts`), before the user sees another screen:

1. sanitise the name → `[a-z0-9._-]`, collapse the rest to `-`, cap 90 chars,
   fall back to `<login>-site`
2. `POST /repos/{TEMPLATE_OWNER}/{TEMPLATE_REPO}/generate` → the tenant's repo
3. `setTenantConfig()` → write `lanza.config.json` = `{owner, name, adminLogin}`
4. `ensureStaging()` → cut `staging` from the default branch
5. discard the user token — it is never stored
6. redirect to the `lanza-cms` App install, pre-filled:
   `…/installations/new/permissions?suggested_target_id=<user id>&repository_ids[]=<repo id>`

That pre-fill is why GitHub shows the new repo already selected and badged
*suggested*: **the repo exists before the install screen renders.**

> **Two races live here, both real.**
>
> `/generate` returns when GitHub *registers* the repo, not when it has committed the
> template. Writing `lanza.config.json` too early creates it on a near-empty repo and
> GitHub's own "Initial commit" then lands **on top**, reverting it — the tenant boots
> with the template's `dsottimano/lanza` identity, locked out of its own `/admin`.
> Observed on `star-real-estate` and `blah-blah`. `setTenantConfig` now polls for the
> placeholder (8 × 1s) and updates **by SHA**, never blind-creates. `ensureStaging`
> has always had its own wait for the branch ref.
>
> A user who clicks **Reject** on the install screen leaves an orphan repo, because
> creation precedes consent. Unresolved.

GitHub returns to the App's Setup URL → `/api/onboard/setup`, which confirms the
install covers *that* repo and resumes the wizard at Cloudflare.

---

## 2. Connect Cloudflare

Standard OAuth against `dash.cloudflare.com/oauth2/{auth,token}` (see
`keys-and-secrets.md` §5 for scopes and the refresh-token requirement).

**The account is chosen, never guessed.** Cloudflare's consent screen has the user tick
which accounts to grant, which *scopes the token* — so `GET /accounts` returns only
those. `resolveAccount()` then:

- uses a stored `account_id` if the token still grants it
- picks implicitly when there is exactly **one** (so most users see no picker)
- otherwise asks

The choice is persisted in `lanza_cf` and survives token refresh. It used to be
`accounts[0]`, resolved *independently* by the deploy POST and the polling GET — so
anyone in more than one account could get their site built in an employer's, and a
listing-order change stranded the wizard on an account the project was never in.

---

## 3. The one manual step — Cloudflare connects itself to GitHub

**This is the step everything else depended on, and the one we got wrong.**

Cloudflare keeps an **account-level git connection record**, entirely separate from the
GitHub App installation:

```
GET https://api.cloudflare.com/client/v4/accounts/<id>/pages/connections
```

- `result: []` → creating a git-sourced Pages project returns **8000011**
  (*"internal issue with your Cloudflare Pages Git installation"*)
- one record present → the **identical** create call succeeds immediately

Proven both directions on `datadefine/aaaaaa`, same account, same repo, same code.

**Only Cloudflare can write that record.** Its connect button sends the user to

```
github.com/apps/cloudflare-workers-and-pages/installations/new/permissions
  ?state=<cf token>&target_id=<github user id>
```

and that **`state`** is what binds the resulting installation back to the Cloudflare
account. Sending the user to GitHub's bare install URL — what this doc used to
prescribe — carries no state, so GitHub's post-install redirect lands on
`dash.cloudflare.com/pages/installations/github` with **no account context** and
Cloudflare writes nothing. The App looks installed on GitHub, Cloudflare disagrees, and
every project create fails.

So the wizard opens Cloudflare's own page, account-scoped:

```
https://dash.cloudflare.com/<accountId>/pages/new/provider/github
```

Account-scoped deliberately: the accountless variant binds to whichever account the
dashboard session happens to resolve to.

### The trap we cannot fix

If the Cloudflare Workers and Pages App is **already installed** on that GitHub
account, Cloudflare's own connect flow deep-links to
`github.com/settings/installations/<id>` and still writes no record — an infinite
loop with no error. Reproduced entirely inside Cloudflare's UI with our code absent, so
it is their bug.

The only escape is to **uninstall** the App on GitHub and let Cloudflare install it
fresh. The wizard surfaces this as a hint after ~6 polls. It is worth a support ticket.

### Detection

The old claim that "no API can confirm this step" is false — `pages/connections` is
exactly that API, and it works with the tenant's OAuth token, not just a dashboard
session. The wizard still *advances* on the create attempt succeeding, but the health
screen and the site list check the record directly (§6).

---

## 4. Create and deploy

`POST /api/onboard/deploy` walks a deterministic candidate ladder from
`projectNameCandidates(owner, repo)` and for each name:

1. `projectExists` in *our* account → adopt it (idempotent re-poll)
2. else create with a `github` source, `production_branch: main`,
   `npm run build` → `dist`, `NODE_VERSION=22`
3. `8000010/8000011` → return `awaiting_git_authorize` **with Cloudflare's verbatim
   error, the accountId, the project name and the source repo** — this state used to
   discard all of that and spin forever with no clue
4. "already exists" but **not** in our account → a stranger holds the global name; try
   the next candidate

**The project name is derived, not the repo name** —
`<repo-slug>-<sha256(owner/repo)[0..12]>`. `*.pages.dev` is one global namespace across
every Cloudflare account, so `test`, `blog`, `bakery` collided with strangers on the
first attempt *and the collision read as success* — deploying nothing and pointing the
user at a third party's `/admin`. Derived rather than random because `/api/token` must
recompute a tenant's origin to check a session's `aud`. Full rationale:
`security-model.md` §2.

A git-sourced create **does not auto-deploy**; `ensureDeployment` triggers
`POST …/deployments` with `branch=main`. The wizard then polls
`GET /api/onboard/deploy?project=<name>` until `stage: deploy, status: success`.

---

## 5. Land in `/admin`, edit, publish

1. `/admin` → broker-mediated GitHub login → RS256 session (`keys-and-secrets.md` §2)
2. `handoff.ts` checks signature, `aud`, `nonce`, `exp`, **and** `adminLogin` — the
   ownership check is separate from identity and both are required
3. saves go to `staging` via `/admin/api/gh`, which mints a repo-scoped
   Contents:write token per request
4. **Publish** merges `staging` → `main`; Cloudflare rebuilds from the push

`draft: true` is the publish gate — an unticked post merges but stays hidden.

---

## 6. Returning, and knowing your site is healthy

A bare `connect.lanzacms.com` used to resume whatever the cookies held, so a finished
run showed its completion screen forever and creating a *second* site was effectively
impossible. It now offers **Continue / Start a new site**, plus the Lanza sites already
on the connected account (`GET /api/onboard/sites`, filtered by our
`-<12 hex>` naming convention).

OAuth callbacks always return with an explicit `?step=`, so asking here never
interrupts a flow in progress.

**Each site row reports whether the git connection exists**, because this failure is
otherwise invisible:

> A Pages project created while Cloudflare held no connection record still *displays* a
> linked repo, builds once, and then never rebuilds. Every later edit publishes into a
> void. Nothing in the CMS, in GitHub, or on the Cloudflare project page says so.
> `star-real-estate` was exactly this, and the wizard congratulated us on it.

---

## 7. Invariants

1. **Never inhibit self-hosting.** Dual-mode throughout: own `CLOUDFLARE_API_TOKEN` and
   `GITHUB_TOKEN` and `ADMIN_LOGIN`, or the broker. The broker is an optional layer
   over a self-sufficient CMS.
2. **Broker holds secrets; tenants verify only.**
3. **Stay free-tier and all-Cloudflare; cache public routes** (CLAUDE.md rules 1–2).
   The wizard shell itself is `no-cache` — it is an app, not a document, and a
   zone-level 4h Browser Cache TTL once hid two shipped fixes mid-test.

---

## 8. Code map

| Concern | Files |
|---|---|
| Wizard UI + state machine | `lanza-broker/index.html` |
| GitHub OAuth → repo | `functions/api/onboard/oauth/{start,callback}.ts`, `_lib/gh-app.ts` |
| App install resume | `functions/api/onboard/setup.ts` |
| Cloudflare OAuth | `functions/api/auth/cf/{login,callback}.ts` |
| Account choice / identity / connection check | `functions/_lib/cf-accounts.ts` |
| Create + deploy + poll | `functions/api/onboard/deploy.ts` |
| Existing sites + health | `functions/api/onboard/sites.ts` |
| Abandon a run | `functions/api/onboard/reset.ts` |
| Project naming / audience | `functions/_lib/tenant-origin.ts` |
| Edit tokens | `functions/api/token.ts` |
| Tenant login | tenant `functions/admin/api/auth/{login,handoff}.ts`, `_lib/session.ts` |

---

## 9. Cloudflare API notes (hard-won — don't re-derive)

- `/accounts` **requires** `page`/`per_page`; `/accounts/<id>/pages/projects`
  **rejects** them — `?per_page=50&page=1` returns 400 code `8000024`. An empty sites
  list came from exactly this.
- `page.write` is needed to create a project; `page.read` alone → `10000`.
- Git-sourced create does not auto-deploy.
- Scopes must be sent explicitly, in dot notation.
- `offline_access` **and** the `refresh_token` grant are both required for a refresh
  token; either alone yields none.

## 10. Still open

- **Option B** — move Cloudflare tokens out of the browser cookie into a per-tenant
  server-side store. Until then every onboarded tenant's Site Health panel 503s, since
  the broker sets only `NODE_VERSION` on new projects.
- **Orphan repo** when a user rejects the App install.
- **The already-installed trap** (§3) — Cloudflare's to fix.
- Unused Cloudflare scopes still requested; trim the code before the client.
