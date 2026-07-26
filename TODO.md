# Lanza — handoff (session 14, 2026-07-26)

**Read first:** `docs/security-model.md` (authoritative on auth/authz) ·
`docs/keys-and-secrets.md` (every credential, who holds it, blast radius) ·
`docs/onboarding-workflow.md` · `docs/mcp-server.md`.

Status legend: ☑ done · ◐ in progress · ☐ todo

Everything below is committed and pushed in both repos. Typecheck clean;
`npm test` 41/41 + admin 49/49 in `lanza`, 35/35 in `lanza-broker`.

---

## Where things stand

| | |
|---|---|
| Package | **`lanza-site`** on npm (unscoped — `@lanza` belongs to someone else) |
| Versions | `latest: 0.1.10` · **`critical: 0.1.5`** — five behind, see #1 |
| Template repo | `github.com/dsottimano/lanza-template`, pins **0.1.10**, **no lockfile** |
| Broker | `connect.lanzacms.com` (Pages, deploys on push to `main`) |
| Proven tenant | `datadefine/mcp-test` — thin, self-updating, MCP-verified |

**The model, stated plainly** (it took most of a session to get straight, so don't
re-derive it):

| | URL | Notes |
|---|---|---|
| Live | `<project>.pages.dev` | **the CMS lives here** — `/admin` |
| Staging | `staging.<project>.pages.dev` | same site off the `staging` branch, `x-robots-tag: noindex`, `/admin` **302s to Live** |

An agent or editor writes to `staging`; `publish` merges `staging` → `main`. One CMS,
two windows. The staging address is a Cloudflare branch-alias convention, **not a
setting** — it appears nowhere in their dashboard.

> **A Cloudflare Pages build takes 4–6 minutes.** Three separate times this session
> someone (twice an agent, once a human) checked inside that window, read "unchanged"
> as "broken", and went hunting a bug that did not exist. Before theorising, either
> wait for the build or open the project's **Deployments** tab and look at whether a
> build was *attempted*, *failed*, or *never started*. A 404 or a stale page mid-build
> is not evidence of anything.

---

## Commands you'll want

```sh
# Broker typecheck — lanza-broker has no package.json, so use the sibling's binary:
cd lanza-broker && /home/dsottimano/source/websites/lanza/node_modules/.bin/tsc --noEmit -p tsconfig.json

# Broker tests:
cd lanza-broker && node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs \
  --test functions/_lib/oauth-util.test.mjs functions/api/oauth/oauth-flow.test.mjs \
         functions/api/mcp-multisite.test.mjs functions/_lib/fanout.test.mjs \
         functions/_lib/tenant-origin.test.mjs

# Security fan-out — DRY RUN (safe, changes nothing):
curl -s -X POST https://connect.lanzacms.com/api/admin/fanout \
  -H "authorization: Bearer $(cat ~/.config/lanza/fanout-secret)" -d '{}'
# …add -d '{"apply":true}' to actually move sites.
```

`curl` output is rewritten by the RTK hook into a schema summary — use `rtk proxy curl …`
for the real body.

### Publish checklist — all five steps, in order

1. `npm publish --otp=<code>` — Dave only; the agent cannot. *(E404 on publish means
   **not logged in**, not "package missing" — npm hides existence from anonymous callers.
   Check `npm whoami`.)*
2. **Verify the tarball took the intended code:** `npm pack lanza-site@<v>`, then grep for
   whatever the release was for. `prepack` rebuilds the admin, so a stale CMS can't ship.
3. **Bump `dsottimano/lanza-template`** to the new version — **after** the publish, never
   before. A template pinning a version npm lacks breaks every new tenant's first build.
4. **Update a real tenant** via Settings → Software; confirm the pane offers it and the
   admin renders. Before step 5, not after.
5. `npm dist-tag add lanza-site@<v> critical` — only if the release changed the CMS UI.
   Moving the floor onto a version whose admin lacks a screen is the trap that bit twice.

---

## ☐ Next up

1. **☐ Move the `critical` floor** — it is at **0.1.5** while `latest` is 0.1.10, and
   0.1.6 changed the CMS UI (the Brand Auto/Light/Dark control), so it is owed. **Do a
   fan-out dry run first.** The fan-out was silently bricking sites until `de30ad4`
   (it bumped `package.json` while leaving a stale `package-lock.json`, so `npm ci`
   refused and the "rescue" stopped the site building). It is fixed but has never been
   run with `apply:true` since. Prove it on `mcp-test`, then move the tag.
2. **☐ Custom domains — Phase 2.** See the section below. Phase 1 (broker) shipped;
   the tenant side is owed and a customer on a custom domain currently loses their
   agent's review URL.
3. **☐ Multi-user + roles.** New feature area, see the section below. Half-wired today
   in a way that would look broken: a second user passes `/admin` and then 403s on every
   save.
4. **☐ Nothing in the product tells a tenant their MCP endpoint exists.** `admin/`,
   `frontend/` and `content/` have **zero** mentions of `api/mcp`, MCP or connectors —
   the only ones are `docs/mcp-server.md` and `docs/security-model.md`, files a customer
   never sees. Dave built it and still had to ask how to connect. Fix: a **Settings →
   Agents** pane, same shape as Settings → Software — the site's own `/api/mcp` URL, the
   multi-site URL, a copy button, and the sign-in-as-the-right-GitHub-account warning
   (`mcp-server.md:177` — GitHub silently reuses a live session, so re-authenticating
   does *not* switch accounts).
5. **☐ Say "this takes ~5 minutes" everywhere, not just the wizard.** The wizard now
   names each Cloudflare stage and ticks an elapsed counter; MCP write tools return
   `reviewUrl` and the 4–6 minute warning. **Settings → Software and the CMS save flow
   still say nothing**, which is the remaining half of "I have no idea what's going on".
6. **☐ Orphan repo on rejected install.** The tenant repo is created in the OAuth
   callback, *before* the `lanza-cms` App install screen. **Reject** leaves a repo
   nothing owns. Create it after consent, or detect the rejection at
   `/api/onboard/setup` and offer to delete. (`onboarding-workflow.md` §1.)
7. **☐ Support ticket to Cloudflare** for the already-installed trap: if the Workers and
   Pages App is already on a GitHub account, Cloudflare's own connect flow dead-ends and
   never writes the connection record. Reproduced without our code.
8. **☐ ChatGPT (developer mode) and Codex as MCP clients.** Only Claude Code is proven.

---

## ◐ Custom domains

**Goal:** a customer points `example.com` at their site, keeps the CMS working, and
their agent keeps a usable review URL.

### ☑ Phase 1 — shipped (broker `479d8b0`)

A session is bound to its origin, and the allow-list was derived purely from the project
name — every entry a `*.pages.dev` address. So a custom domain left `/admin` unreachable:
the audience check refused and the login round-trip never settled. The public site was
fine; only the CMS locked out.

Tenants now declare their own domains in their repo-root `lanza.config.json`:

```json
{ "owner": "…", "name": "…", "adminLogin": "…", "domains": ["example.com"] }
```

`/api/token` checks the derived `*.pages.dev` list first (no I/O) and only reads the
tenant config when that misses, so the common mint costs nothing extra. This replaces
`ALLOWED_TENANT_ORIGINS`, a broker-wide env var that would have needed hand-editing per
customer with everyone's domains in one shared list.

**Why self-declared is the right trust level:** that same file already carries
`adminLogin`, which decides who may edit the site at all — anyone who can write it can
already grant themselves the CMS. The check stays per-repo, so a tenant listing someone
else's domain gets a session that still only acts on **their own** repo. Validation fails
closed: no wildcards, no `http`, no hostname without a dot; unparseable JSON yields `[]`.

### ☐ Phase 2 — owed (tenant side, needs a release)

- **Settings → Domains field** that writes `domains`, so nobody hand-edits JSON on
  GitHub. Chosen flow: the user adds the domain in **Cloudflare's dashboard** themselves
  (works today, needs no API token), then enters it in the CMS.
- **Store `pagesProject`** in `lanza.config.json` and have `stagingUrlFor`
  (`functions/_lib/mcp-core.ts`) use it instead of deriving from the request host. Today
  the derivation only works on `*.pages.dev`, so **`get_site` returns `stagingUrl: null`
  on a custom domain** — the customers most likely to want a review URL are the ones who
  lose it. The broker knows the real project name at creation (`deploy.ts`); the CMS can
  also read it from its own hostname when running on the production origin.
- **Document the asymmetry:** production moves to `example.com`, but **staging stays at
  `staging.<project>.pages.dev`** — Cloudflare does not alias branch builds onto custom
  domains. The two addresses stop looking related, and that will surprise people.

---

## ☐ Multi-user + roles

**Goal:** more than one person can work on a site, with different permissions.

### What already exists

`isAllowedLogin` (`functions/_lib/session.ts:85`) already accepts a **comma-separated
list**, so the tenant's `/admin` gate technically admits several GitHub logins today —
all of them with identical, full access. There is no notion of a role anywhere.

### The blocker, and why a naive attempt looks broken

`/api/token` (broker) refuses anyone who is not the repo owner:

```ts
if (owner.toLowerCase() !== verified.login.toLowerCase())
  return json(403, { message: "Session login does not own this repo." });
```

So adding a second login to `adminLogin` today produces the **worst possible failure**:
they sign in, the CMS loads, and every save 403s. Half-wired, and it looks like a bug
rather than a missing feature. Do not ship a list-of-users UI without changing this.

### Design questions to settle first

- **Where do roles live?** `lanza.config.json` is the natural home — the broker already
  writes it, reads it per-repo, and it is already the source of truth for `adminLogin`
  and now `domains`. Something like
  `users: [{ login, role }]`, with `adminLogin` kept as the owner.
- **What roles?** At minimum owner / editor. Is there a viewer (read-only CMS), and does
  a role gate *publishing* separately from *editing*? Publishing is the irreversible one
  — an editor who can stage but not publish is the obvious first useful split, and it
  maps exactly onto the existing staging/`publish` boundary.
- **How does a non-owner get write access?** `/api/token` mints a repo-scoped App
  installation token. Minting one for a non-owner means the broker vouches for a
  delegation the repo itself declared — same trust model as `domains`, and defensible
  for the same reason, but it must be re-derived deliberately rather than assumed.
  Note the collaborator may have no GitHub access to the repo at all; the App
  installation is what actually writes, not their account.
- **Enforcement points — all three, or the role is decorative:**
  1. tenant `functions/admin/_middleware.ts` (can they load `/admin`)
  2. broker `/api/token` (can they save)
  3. **MCP** — `functions/_lib/mcp-core.ts` tools, and the broker's multi-site `sites`
     claim, which today is built from repos whose `adminLogin` matches
     (`gh-app.ts:160`). An editor's agent must not out-permission the editor.
- **Revocation.** Removing someone from the list does not invalidate their existing
  session — sessions are stateless 7-day bearers with no `jti` (see security items).
  For roles this stops being theoretical: "remove Bob" that doesn't remove Bob for a
  week is a security bug, not a papercut.

---

## ☑ Shipped this session (don't re-litigate)

- **☑ The staging/production model actually works end to end**, verified on
  `datadefine/mcp-test`: an MCP edit lands on `staging`, builds to its own deployment
  (different md5 from production), carries `x-robots-tag: noindex`, and `publish` merges
  it live. **There was never a staging bug** — two confident diagnoses (a missing
  `preview` deployment config; `preview_deployment_setting` never being set) were both
  wrong, and both came from measuring inside the 4–6 minute build window.
- **☑ Lockfile removed from the template + self-heal in both writers**
  (`4c9be7f`, broker `de30ad4`, template `b0bc5b8`). A committed `package-lock.json`
  makes Cloudflare run `npm ci`, which refuses when it disagrees with `package.json` —
  and **nothing ever updated the lock**, so *every* self-update silently bricked the
  build while Pages kept serving the last good deployment. The **fan-out had the same
  flaw**, which means the mechanism for rescuing unsafe sites would have broken every
  site it touched; never run with `apply:true` against a tenant carrying a lockfile,
  which is the only reason it is a near miss and not an incident. Both writers now delete
  the lockfile *before* bumping, so the intermediate commit still builds.
- **☑ `/admin` on a preview build redirects to the live CMS** (`a9d4a5e`). The wrong URL
  is now impossible to be on. It redirects ahead of the `/admin/api/auth/` exemption —
  starting a login round-trip on a preview host was the dead end being removed.
- **☑ Custom-domain audiences** (broker `479d8b0`) — see the section above.
- **☑ Build progress in the wizard** (broker `5789c4b`): "3–6 minutes" up front, each
  Cloudflare stage named in words, and an elapsed counter that ticks every second.
- **☑ MCP: `get_site` returns `liveUrl`/`stagingUrl`; write tools return `reviewUrl`**
  plus the build-delay warning. The staging URL existed nowhere in the protocol, so
  clients were re-deriving Cloudflare's branch-alias convention by hand.
- **☑ MCP leaner** (`d1d2edc`): responses are compact JSON, not `indent: 2` — measured at
  **46%** of a `get_schema` response (3,714 → 2,003 tokens). `create_content` dropped a
  duplicated GitHub round-trip (6 → 5).
- **☑ Option B closed + Cloudflare features made opt-in** (`6d0ca98`, broker `bf3fb5c`).
  Lanza holds **no** per-tenant Cloudflare token; a broker store would have put
  `page.write` on the whole fleet in one namespace. The store-nothing alternative is
  impossible — CF OAuth has 371 scopes, none for API-token management, and
  `GET /user/tokens` on an OAuth token is `403 code 9109`. Scopes trimmed to four in code
  **and on the CF client**; `offline_access` and the unreachable `refreshCfToken()` deleted.
- **☑ Brand `scheme: "auto" | "light" | "dark"`** (`c315646`). lanzacms.com was never
  dark — `site.css`'s `prefers-color-scheme` flip had no opt-out, and `site.css` ships in
  the package so it could not simply be gated. Pinning a mode emits all 14 differing
  tokens inline (no `data-theme` revival). Tenants without the key are byte-identical,
  verified by executing `resolveBrand`.
- **☑ Two-digit version ordering pinned** (`c4b3748`). 0.1.10 is the first release past
  nine; string comparison would make it *older* than 0.1.9, hiding every future update
  and inverting the `critical` floor so the fan-out would "rescue" sites onto older code.
  Both comparators were already numeric; tests now hold them there.
- **☑ Wizard identity strip + width** (broker `1f899e0`): each account is a labelled chip
  linking to the GitHub account, the repo, and the Cloudflare dashboard.
- **☑ Pre-package tenants retired.** `define-media-group`, `delete`, `delete22` deleted;
  `datadefine` holds one Lanza site. MCP config: dead `dmg` entry removed, `lanza` moved
  to **user scope** so it works from any directory.
- **☑ MCP verified end-to-end through the multi-site router** against a real tenant —
  the session-12 failure mode (green transport, dead content tools) is not present.

**The lesson worth carrying:** nearly every defect this session was invisible from inside
this repo and appeared within minutes of real use — and the three *non*-defects cost just
as much, because an async system was measured before it finished. Prefer one real run
over another green suite; then let the run finish before you believe it.

---

## ☐ Known-open security items (reviewed, deliberately not fixed)

Full detail in `docs/security-model.md` §5.

- ☐ **Sessions can't be revoked.** Stateless 7-day RS256 bearer, no `jti`. Also covers
  MCP grants: a multi-site `sites` claim can't be revoked before its 1h expiry.
  **Blocks credible roles** — see that section.
- ☐ **The handoff token *is* the session token.**
- ◐ **A CF access token still passes through the browser** (`lanza_cf`) — now for at most
  its 3600s cookie life and **with no refresh token**. The wizard needs `page.write` in
  the browser flow, so the cookie can't be removed outright. Accepted.
- ☐ **Proxy relays upstream headers verbatim** (inherits GitHub's `Cache-Control` /
  `ACAO: *`). Latent unless the session cookie moves to `SameSite=None`.
- ☐ **No `Origin` validation on the MCP transport** (broker router included).
- ☐ **Wizard polls with no cap or backoff** — ~1,200 authenticated CF calls/hour if a
  user walks away.
- ☐ **`ensureDeployment` ignores `res.ok`** — a failed trigger still reports
  `state:"deploying"`, so the poll spins forever.
- ☐ **Fan-out reach.** `listAllInstalledRepos` returns every repo the App can write to,
  across all accounts — including strangers'. Fan-out-only by design; keep it that way,
  and keep the dry run.
- ☐ **Unsafe-version blocking is UI-only.** The owner can still pin a bad version by
  editing `package.json` on GitHub. The fan-out is the real enforcement.

---

## ☐ Cleanup owed

- ☐ **Pages projects** for the deleted `datadefine` repos, plus `dsottimano/dave-test`.
- ☐ Delete `dsottimano/lanza-deploytest-11556` + the two `lanza-deploytest-*` Pages
  projects.
- ☐ **Delete the nested `lanza/lanza-broker` checkout.** Canonical is the **sibling**
  `../lanza-broker`. The nested copy is stale with uncommitted junk.
- ☐ **Rotate secrets pasted or screenshotted in earlier sessions:** the exploratory CF
  API token, the broker `OAUTH_CLIENT_SECRET` / App client secret, the old tenant
  `GITHUB_TOKEN`. Procedure: `docs/keys-and-secrets.md` §7.
- ☐ Sweep the word "dogfood" out of the repo (~16 places).
- ☐ `docs/lanza-site-extraction-plan.md` still says "P4 deploy actions left to Dave" —
  they're done. Mark P4/P5 shipped.
- ☐ **Correct broker `4de76c1`'s commit message.** It claims to fix the staging build by
  adding a `preview` deployment config. That diagnosis was wrong (the template ships
  `.nvmrc: 22`, which Pages honours). The commit is harmless — explicit beats default —
  but its message should not be trusted.

---

## ☐ Backlog / deferred

- ☐ **Fan-out has no scheduler.** It's a manual `curl`. Pages has no cron; a Worker with
  a cron trigger could call it.
- ☐ **No release notes.** The Software pane lists versions and dates but can't say what
  changed. A `CHANGELOG` or a field the pane fetches would fix it.
- ☐ **MCP: wrong-GitHub-account failure is invisible on the single-site endpoint** — a
  bare 403; the client just loops. Multi-site solves it by construction.
- ☐ **Wizard: GitHub-account gate before step 1** — "Connect GitHub" with no account is a
  dead end.
- ☐ **Wizard: gamified progress — plane + skydiver** (honor `prefers-reduced-motion`).
- ☐ **MCP media/image upload tool.**
- ☐ **MCP self-host story** — no broker means no OAuth AS. Single-site can work with
  `GITHUB_TOKEN`; the multi-site router is broker-only by definition.
- ☐ **Variables page in Settings** — site-wide `{{ placeholders }}`.
- ☐ **Taxonomy-rename referential integrity** — renaming a slug doesn't rewrite posts.
- ☐ **Slug-collision UX** — raw GitHub 422 today.
- ☐ **Preview brand accuracy** — CMS preview uses `site.css` defaults, not
  `appearance.json`, and only maps six of the brand tokens.
- ☐ **CMS in-place visual editing (Phase 2)** — needs a DOM→template source map.
- ☐ **Admin dark mode** — needs a var-ification sweep across ~36 files.
