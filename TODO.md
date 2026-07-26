# Lanza — handoff (session 16, 2026-07-26)

> ## Everything is committed, pushed and deployed.
>
> Both repos are clean and match `origin/main`. The security sweep shipped, the broker
> is live, and `lanza-site` **0.1.11 is on npm**. There is no uncommitted work.
>
> **One thing is owed immediately:** `0.1.12` is committed but **not published** — it
> carries the untitled-entry build fix. Until it ships, any tenant can brick their own
> build by pressing Save on a new page.

> ## 🔥 What the first live customer session cost, and the rules it earned
>
> A real user (`byrobychoi`, site `roby-s-world`) tried to connect an MCP client during
> a demo. **Four separate failures, three of them shipped by us that same afternoon**,
> all with a green test suite and clean server logs. This is the most valuable section
> in this file — the bugs are fixed, the rules are not yet habits.
>
> **1. A security header is a behaviour change, and only a browser can prove it.**
> The consent page shipped with `form-action 'self'`. Chrome enforces `form-action`
> across the whole redirect **chain**, so the consent POST succeeded server-side —
> consent consumed, auth code minted — and then the browser silently refused the 302
> back to `https://claude.ai`. The code never arrived. Nothing failed on the server, so
> nothing appeared in logs, and 60 tests stayed green.
> → **Rule: any header that changes browser behaviour (CSP, `X-Frame-Options`, COOP/
> COEP, `SameSite`, `Permissions-Policy`) is not done until the real flow has been run
> in a real browser with the console open.** The deploy notes said exactly this for the
> tenant CMS, and Dave did it. Nobody said it for the broker. That is where it bit.
>
> **2. One message for several states costs hours.** "Access not granted. No token was
> issued." covered *cancelled*, *expired*, and *already used* — and it was the wrong
> sentence for two of them, actively implying failure where a token HAD been issued.
> → **Rule: if two states need different actions from the user, they get different
> messages.** Log which branch fired, so the next report is answerable from logs.
>
> **3. Get client-side evidence before theorising about server internals.** Two
> confident diagnoses were offered here — a KV read-after-write race, and "he probably
> clicked Cancel" — and both were wrong. One screenshot of the browser console ended it
> in seconds.
> → **Rule: ask for the console, the network tab, and the response headers first.**
> This is the same lesson as the 4–6 minute build window below, in a new costume.
>
> **4. Cloudflare hides a failed build.** A schema-invalid entry
> (`content/pages/en/untitled.md`, no `title`) failed the build, and Pages kept serving
> the last good deployment — so the site looked healthy while every later edit silently
> stopped going live.
> → **Rule: after a content-shaped change, check the Deployments tab, not the page.**
> A page that looks right is not evidence the build ran.
>
> **5. Publishing is not testing.** `0.1.11` went to npm and needed `0.1.12` within the
> hour. A tarball can be exercised before it is public: `npm pack`, install it into a
> scratch tenant, build.
>
> **The through-line:** every one of these was invisible from inside this repo and
> appeared within minutes of a real person using it. That is now the third session in a
> row where that sentence is true. **Prefer one real run over another green suite.**

**Read first:** `docs/security-model.md` (authoritative on auth/authz) ·
`docs/keys-and-secrets.md` (every credential, who holds it, blast radius) ·
`docs/onboarding-workflow.md` · `docs/mcp-server.md`.

Status legend: ☑ done · ◐ in progress · ☐ todo

Both repos clean and pushed. Typecheck clean; `npm test` 105/105 + admin 83/83 in
`lanza`, 60/60 in `lanza-broker`.

> **⚠️ `/goal` hook bug, if you use it again:** a goal phrased as an absolute
> ("100% safe", "zero bugs") makes the Stop hook block forever — it re-checks the
> literal, never sees it met, and loops until Claude Code's 9-block cap force-ends the
> turn. The hook should check `stop_hook_active` in its input and return success while
> true. Phrase goals as verifiable states.

---

## Where things stand

| | |
|---|---|
| Package | **`lanza-site`** on npm (unscoped — `@lanza` belongs to someone else) |
| Versions | `latest: 0.1.11` · **`0.1.12` committed, NOT published** · **`critical: 0.1.5`** — six behind |
| Template repo | `github.com/dsottimano/lanza-template`, pins **0.1.10**, **no lockfile** |
| Broker | `connect.lanzacms.com` (Pages, deploys on push to `main`) |
| Proven tenant | `datadefine/mcp-test` — thin, self-updating, MCP-verified |
| First real customer | `byrobychoi/roby-s-world` — onboarded 2026-07-26, hit every bug in the box above |

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
# To actually move sites you must CONFIRM the floor the dry run reported. `apply`
# alone is refused (409) — the floor comes from npm, so a stale command from shell
# history must not be able to act on a version you never saw:
#   -d '{"apply":true,"expectCritical":"0.1.6"}'
```

`curl` output is rewritten by the RTK hook into a schema summary — use `rtk proxy curl …`
for the real body.

### Publish checklist — all six steps, in order

0. **Exercise the tarball BEFORE it is public.** `npm pack`, install the resulting
   `.tgz` into a scratch tenant, run a build, load `/admin`. Publishing is not testing:
   0.1.11 went to npm and needed 0.1.12 within the hour for a bug one save would have
   caught. A published version cannot be unpublished cleanly, and every new tenant
   installs `latest`.
1. `npm publish --ignore-scripts=false --otp=<code>` — Dave only; the agent cannot.
   **The flag is now required:** `.npmrc` sets `ignore-scripts=true` (supply-chain
   hardening for tenant builds), and that also suppresses our own `prepack`, which is
   what rebuilds the admin SPA. Publishing without it ships a stale CMS. Step 2 catches
   it if forgotten. *(E404 on publish means **not logged in**, not "package missing" —
   npm hides existence from anonymous callers. Check `npm whoami`.)*
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

**Owed from the live session — do these first.**

1. **☐ Publish `0.1.12`.** Committed, not published. It refuses to save an entry with
   no title — the bug that broke a customer's build tonight. Until it ships, every
   tenant can brick their own site with one click.
   `npm publish --ignore-scripts=false --otp=<code>`
2. **☐ Bump `dsottimano/lanza-template`** — still pins **0.1.10**, two releases behind,
   so every NEW tenant starts on code with the untitled-entry bug and without the
   security sweep. Also still needs its own `.npmrc` (`ignore-scripts=true`); the one in
   this repo protects only this repo, and an `.npmrc` is not inherited from a dependency.
3. **☐ Browser-verify the broker's auth flows end to end.** The consent-page CSP fix
   (`85e786d`) is deployed but has only been reasoned about, not *run*: press Allow with
   devtools open and confirm the 302 reaches `claude.ai` and the client gets tools. Same
   for the two new pages (already-authorized, expired) and the wizard. This is rule 1
   from the box at the top, applied to the thing that just broke.
4. **☐ Any schema-invalid entry can still brick a build.** `title` is guarded now, but
   that fixed one path, not the class — any required field missing on any collection
   fails the whole build, and Cloudflare masks it by serving the last good deployment.
   Options: validate against the collection schema in the editor before write (the CMS
   already has `data/schema.json`), or make the build report the bad entry and skip it
   rather than abort. **The MCP writers are already safe** — `create_content` requires
   `title` — so this is a CMS-side gap only.
5. **☐ Nothing in the product tells a tenant their MCP endpoint exists.** Promoted from
   #4 last session because it stopped being theoretical: a real customer could not
   connect, and neither could Dave without asking. `admin/`,
   `frontend/` and `content/` have **zero** mentions of `api/mcp`, MCP or connectors —
   the only ones are `docs/mcp-server.md` and `docs/security-model.md`, files a customer
   never sees. Dave built it and still had to ask how to connect. Fix: a **Settings →
   Agents** pane, same shape as Settings → Software — the site's own `/api/mcp` URL, the
   multi-site URL, a copy button, and the sign-in-as-the-right-GitHub-account warning
   (`mcp-server.md:177` — GitHub silently reuses a live session, so re-authenticating
   does *not* switch accounts).

**Carried over.**

6. **☐ Move the `critical` floor** — it is at **0.1.5** while `latest` is 0.1.11, and
   0.1.6 changed the CMS UI (the Brand Auto/Light/Dark control), so it is owed — now
   more so, since 0.1.11/0.1.12 carry the security sweep and the build-breaking fix.
   **Do a fan-out dry run first.** The fan-out was silently bricking sites until
   `de30ad4` (it bumped `package.json` while leaving a stale `package-lock.json`, so
   `npm ci` refused and the "rescue" stopped the site building). It is fixed but has
   never been run with `apply:true` since. Prove it on `mcp-test`, then move the tag.
7. **☐ Custom domains — Phase 2.** Phase 1 (broker) shipped, and the `stagingUrl` half
   is now done too (see that section). What remains is the **Settings → Domains field**,
   so nobody hand-edits JSON on GitHub.
8. **☐ Multi-user + roles.** New feature area, see the section below. Half-wired today
   in a way that would look broken: a second user passes `/admin` and then 403s on every
   save.
9. **☐ Say "this takes ~5 minutes" everywhere, not just the wizard.** The wizard now
   names each Cloudflare stage and ticks an elapsed counter; MCP write tools return
   `reviewUrl` and the 4–6 minute warning. **Settings → Software and the CMS save flow
   still say nothing**, which is the remaining half of "I have no idea what's going on".
10. **☐ Orphan repo on rejected install.** The tenant repo is created in the OAuth
    callback, *before* the `lanza-cms` App install screen. **Reject** leaves a repo
    nothing owns. Create it after consent, or detect the rejection at
    `/api/onboard/setup` and offer to delete. (`onboarding-workflow.md` §1.)
11. **☐ Support ticket to Cloudflare** for the already-installed trap: if the Workers and
    Pages App is already on a GitHub account, Cloudflare's own connect flow dead-ends and
    never writes the connection record. Reproduced without our code.
12. **☐ ChatGPT (developer mode) and Codex as MCP clients.** Only Claude Code is proven.

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
- **☑ SHIPPED — `stagingUrl` works on a custom domain.** The old note here said the
  project name could not be learned off `*.pages.dev`. That was wrong: the broker's
  name is a *pure function* of owner+repo (`<repo-slug>-<12 hex of sha256("owner/repo")>`,
  `tenant-origin.ts`), and owner/repo are in `lanza.config.json` — so the hostname was
  never needed. `functions/_lib/pages-project.ts` now resolves it in three steps:
  the request host (free, on `*.pages.dev`), then an explicit `pagesProject`, then the
  derivation. `get_site`/`reviewUrl` and the CMS's per-entry **View** links both use it.
  **`pagesProject` is not optional for every site:** derivation describes how the broker
  NAMES a project, not how every project got its name — `dsottimano/lanza` predates the
  scheme and is plainly `lanza`, verified by probing (the derived
  `lanza-76cae1b6cc54.pages.dev` does not resolve; `mcp-test-736f7e918662.pages.dev`
  does). Any hand-created project needs the key. The derivation is now a **third copy**
  (broker, `admin/src/backend/site-urls.ts`, `functions/_lib/pages-project.ts`) —
  cross-checked against the broker on 7 inputs incl. edge cases, but they are separate
  deployables and a divergence fails silently.
- ☑ **Cloudflare Access removed from `staging.lanza.pages.dev`** (Dave, 2026-07-26).
  A leftover Zero Trust policy 302'd every review link to `dsottimano.cloudflareaccess.com`.
  Now 200 with `x-robots-tag: noindex`, as designed.
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

## ☑ Shipped in the live session (session 16)

- **☑ The security sweep is committed, pushed and deployed.** 16 commits — 10 in
  `lanza`, 6 in `lanza-broker` — chunked by finding, each message carrying the reasoning
  rather than the diff. Broker went first (it protects the fleet immediately; tenant
  fixes only reach a site when it updates).
- **☑ `form-action 'self'` was blocking every OAuth connection** (broker `85e786d`).
  The afternoon's CSP. See rule 1 at the top of this file — this is the one that cost
  the demo.
- **☑ Consent failures now say which failure it was** (broker `bf8d44e`). "Access not
  granted" covered cancel / expired / already-used. A tombstone (`consent-used:<id>`,
  10-min TTL) distinguishes a re-submit from an expired link, and the branch is logged.
  Also fixed impossible advice on the picker: "go back and tick at least one site" could
  not work, because the record had already been consumed — it is put back now.
- **☑ Saving an untitled entry no longer breaks the build** (`d34b3b7`, ships in
  0.1.12). `slugify("")` → `untitled.md` with no `title` key → `InvalidContentEntryDataError`
  → Pages keeps serving the last good deployment. One click, whole site frozen.
- **☑ `stagingUrl` works on a custom domain** (`de74ae5`). The old note claimed the
  Pages project name could not be learned off `*.pages.dev`. Wrong: it is a pure
  function of owner+repo. Three-step resolution (request host → explicit `pagesProject`
  → derivation), used by both `get_site`/`reviewUrl` and the CMS's new View links.
  **`pagesProject` is required for hand-created projects** — `dsottimano/lanza` is one,
  its project is plainly `lanza`, and the derived name does not resolve.
- **☑ CMS: per-entry View links + wider lists** (`86029ba`). View points at STAGING,
  because that is where the CMS writes.
- **☑ `parse5` pinned as a direct dependency** (`e73b766`). It was reached transitively
  and is a build-blocking import; tenants install with no lockfile, so that tree was not
  ours to rely on.
- **☑ `lanzacms.com` declared in `domains`** (`c98e71f`) + `pagesProject`, so this site
  stops being the one exception to the path we point every customer at.
- **☑ Cloudflare Access removed from `staging.lanza.pages.dev`** (Dave). It had been
  302'ing every review link to a Zero Trust login.
- **☑ CHANGELOG.md exists.** The Software pane could list versions but never say what
  changed, so an owner had no way to judge an update.

---

## ☑ Shipped in session 15 (don't re-litigate)

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

## ☑ Security sweep — findings and fixes (shipped 2026-07-26)

**Deployed.** Broker live; tenant side ships in `lanza-site` 0.1.11+. Kept in full
because the reasoning is the durable part — the audit reports went to a session
scratchpad that no longer exists.

Suites after: **105/105** tenant · **83/83** admin · **60/60** broker · `tsc` clean in
tenant + broker + bot · real `lanza build` green (15 pages). Counts rose because every
fix landed with an adversarial test that asserts refusal *and* that nothing was written.

> **The sweep's own postscript:** two of its fixes caused outages the same day — the
> consent-page CSP blocked every OAuth connection, and the always-consent change
> introduced a misleading error page. Hardening is a behaviour change. See the rules at
> the top of this file.

`npm test` now runs the admin suite too. It didn't, which meant the menu-URL policy,
the media allowlist and the theme allow-list had tests no documented step executed.

**A red-team pass reviewed the fixes themselves**, and it earned its keep — it found a
regression the sweep introduced (`href="/blog/{{slug}}"` silently rendered `/blog/#`,
because the first cut treated every placeholder as a whole URL) plus five live bypasses
of the new template guard: a `>` inside an earlier attribute value ended the tag, so
`javascript:` reached `href` untouched; `href = "…"` with whitespace before the `=`
skipped the URL check; `<a {{attrs}}>` injected an event handler; `srcdoc` is
entity-decoded and re-parsed so escaping it does nothing; and `/\evil.example` passed
the root-relative test because `\` is a path separator to the URL parser.

**The subtlest one was found last, by attacking the fix rather than the bug**: the
classifier kept a flat 256-character window of preceding template text, so 300
characters of `class` — or an inline SVG `d=` — pushed the opening `<` out of view. It
then saw no tag at all, classified an `href` as ordinary text, and failed **open**.
That flaw was in the first version of the fix too, not only the rewrite; long
attributes are completely ordinary in the HTML this engine exists to ingest. The window
now never drops the last `<`.

**A second red-team round then broke the fix again**, four more ways — and the first was
the same bug relocated: round 1's fix seeked back to the last `<`, so `alt="a<b>c"` made
it anchor on the `<` *inside* the value and the following `>` read as the tag closing.
Also: `{{{raw}}}` in a plain quoted attribute (`title="{{{x}}}"`) was emitted verbatim,
because a quoted ordinary attribute was byte-identical to a text position; a
`{{#if}}` body inside an attribute value counted as a literal prefix even though it
renders to nothing when false, so `href="{{#if p}}/p{{/if}}{{u}}"` emitted a bare
`javascript:`; and `/` was treated as a name character, so `<a/href=` — which
html-minifier emits — evaded every attribute rule.

The lesson is in the pattern, not the payloads: **three separate attempts to answer "am
I inside a tag?" by looking backwards were all bypassable**, because a quoted attribute
value may legally contain `<` or `>`. It is now a forward state machine that advances
one character at a time and cannot be fooled by where a lookback lands.

A fourth round then found the state machine treated constructs that are **not markup**
as markup. `<!-- don't -->` — an ordinary English contraction inside an HTML comment —
opened an attribute value that never closed, so the next real `href` was swallowed as
attribute text and never checked. Same for a `"` or `<` inside `<script>`, `<style>`,
`<title>`, and for an IE conditional comment. `pushTail` is now a small HTML tokenizer:
comments end at `-->` (not the first `>`), raw-text elements end at their close tag, and
a quote only opens a value directly after `=`.

**A fifth round found six more**, using **parse5 as a differential oracle** — parsing the
RENDERED output and asking what a browser actually sees, instead of grepping the string.
That technique is why it found what four rounds of string assertions had not, and the
suite now uses it. The six: comment terminators the tokenizer did not implement (`--!>`,
`<!-->`, `<!--->` — any one of them left it inside a comment *forever*, silently
disabling every guard for the rest of the template); `<<a href=` dropping the character
that opened the tag; raw-text being applied inside SVG/MathML where `title` and
`textarea` are ordinary elements; a value inside `<script>`/`<style>` getting HTML
escaping, which does nothing for a backtick literal or an unquoted CSS slot; a
conditional block that opens a tag rewinding to the *least* restrictive position; and an
attribute NAME supplied by data matching no rule at all.

All fixed, each with a test proven to fail when its guard is reverted.

**Critical**

- **☑ An MCP OAuth token was accepted as an `/admin` session cookie.** The broker signs
  CMS sessions and MCP access tokens with the *same* key, and `/authorize` let the
  client name any `resource` — so asking for a tenant's *bare origin* returned a token
  byte-identical to that site's session. One owner click on an attacker's link gave
  away `/admin`, the GitHub proxy and the Cloudflare token. Now: `resource` must be an
  `/api/mcp` endpoint, both families carry `typ`, and every consumer checks it.
  (security-model.md **I5**.)
- **☑ OAuth `state` was not bound to a browser.** Anyone could call `/authorize`, read
  the `state` from the 302, and lure a victim through GitHub carrying it — binding the
  *victim's* identity to the *attacker's* client. Now an HttpOnly `lanza_oauth_bind`
  cookie must match. The onboarding and CF flows always did this; the MCP AS did not.
- **☑ The single-site MCP flow minted a token with no consent screen at all.**
  Registration is open (DCR needs no credentials, CIMD needs no registration), so the
  client could never be inferred. Both flows now show who is asking *and* where the
  token will be sent, before any code exists.
- **☑ Squattable origins were accepted as audiences.** `allowedOriginsForRepo` blessed
  the `-2/-3/-4` create-fallbacks — names in a *global* namespace that no tenant holds.
  Register `<victim-base>-2.pages.dev` in your own Cloudflare account and you could
  hold a 7-day session for someone else's repo. The ladder is now create-only.
- **☑ Build RCE via `data/schema.json`.** `gen-content-config.mjs` interpolated
  collection names, folders and field names into generated code with zero escaping, and
  that file is written by *theme import* — the one input the CMS treats as untrusted.
  Proven with `execSync` in a field name. Now validated and emitted through `lit()`.

**High**

- **☑ I2 violated on the MCP path** — a broker *refusal* (401/403) fell through to the
  standing `GITHUB_TOKEN` PAT, so revoking the App did not revoke anything. Now
  three-state, matching the gh proxy.
- **☑ `..%2f` skipped the `/admin` auth gate.** `new URL().pathname` leaves `%2f`
  encoded, so `/admin/api/auth/..%2fcf/...` satisfied the `startsWith` exemption and
  reached the Cloudflare-token proxy with no session check. The exemption is now an
  exact three-path set, and encoded separators are refused outright.
- **☑ `javascript:` injection through template slots and menu URLs** → script on the
  `/admin` origin, where the session cookie rides same-origin fetches. The engine is
  now URL-context-aware.
- **☑ I3 forgotten in the broker's GitHub client** — `/api/token` put a request-supplied
  `repo` straight into `api.github.com` paths, so `x/../../victim/secret` resolved into
  another tenant's repo with the App JWT attached. Names now checked against GitHub's
  grammar.
- **☑ Theme import used a deny-list**, leaving `package.json`, `astro.config.mjs` and
  `lanza.config.json` (which decides who owns `/admin`) writable by a theme author.

**Medium / hardening** — no CSP or `frame-ancestors` anywhere (both repos now have
them); auth codes and refresh tokens now bound to `client_id`; refresh TTL 90d → 30d;
DCR records now expire; CIMD fetch bounded (timeout, no redirects, 64 KB); registry
version strings validated as semver before being written into a tenant's
`package.json`; a fan-out write run must confirm the floor it expects; the fan-out no
longer force-bumps non-semver pins; MCP collections are confined to `content/` so
`data/schema.json` stops being a security boundary; both proxies now strip and
override `Cache-Control`/`ACAO` instead of relaying GitHub's; the dev Vite proxy
re-checks the resolved URL like prod does; loopback `redirect_uri` matching is
port-agnostic but no longer host-agnostic; media upload
extension-allowlisted; the forced iframe sandbox no longer grants `allow-same-origin`
to same-origin frames; `.npmrc` disables lifecycle scripts; the adversarial test corpus
no longer ships in the tarball; bot title strips control characters (a stray CR broke
the *whole site build*), adds `ALLOWED_USER_IDS`, and no longer retry-loops on a failed
reply.

**Verified clean, so nobody re-checks:** no credential in either repo's working tree or
git history — every `ghp_`/`BEGIN`/`client_secret` hit is a placeholder, a variable
name, or a PEM-stripping regex, each opened and read. The baked RS256 key is confirmed
a *public* key. No deleted `.env`/`.pem` in any commit on any ref. The
`docs/keys-and-secrets.md` rotation item stands on its original grounds (pasted in
chat), not because anything reached git.

### ☐ Owed from the sweep

- ☐ **Rotate the bot's `GITHUB_TOKEN`.** It is the only long-lived standing repo-write
  credential in the system (`Contents: read+write` on `dsottimano/lanza`, targeting
  **`main`**), it had no rotation entry, and it was missing from the credential
  inventory entirely — §1 of that doc claimed no GitHub credential outlives a request.
  Both now corrected. Consider pointing `GITHUB_BRANCH` at `staging`.
- ☐ **`.npmrc` into `dsottimano/lanza-template`** — see the deploy box.
- ☐ **Decide the template engine's future — this is the important one, and it is the
  one open item that is a real product decision rather than a patch.** Five rounds of
  review found bugs in `frontend/lib/template-render.ts`, every one the same shape: the
  engine's idea of where a value lands disagreeing with a real HTML tokenizer. The
  WHATWG tokenizer has ~80 states; this file has 7. That is a spec to implement, not a
  bug list, and there is no reason to think round 6 is empty. Two options, and the
  second is the one to commit to:
  1. **☑ SHIPPED — a build-time output assertion.** `frontend/lib/assert-rendered-safe.ts`
     parses the rendered HTML with parse5 and fails the build when a VALUE produced
     something a browser would act on. Renders twice (real data, then every value
     replaced by an inert token) and reports only the difference, so author markup is
     never flagged — a false positive would fail a tenant's deploy. Node-only; the admin
     bundle is asserted parse5-free. Proven by reverting a real engine guard: the engine
     emitted live `javascript:` and the build failed. **This is now the control to rely
     on** — it does not require the engine to be correct.
     Red-teamed as its own component, because the posture now leans on it, and it had
     two real holes: an injected `<script src="https://evil…">` passed (https is a fine
     scheme — the finding is that the ELEMENT appeared because of a value), and a
     getter that threw on its second read silently switched the check off. Both fixed;
     10 dangerous shapes now fire, 11 author-markup shapes stay silent.
     Extended to the OTHER `set:html` sink: post/page bodies now assert on the
     sanitizer's output (`assertSanitizedSafe`), so a DOMPurify config regression or an
     mXSS gadget fails the build rather than shipping. Bodies use a SCHEME-based URL
     rule, not the template one — a relative `src="x"` is ordinary in prose, and reusing
     the stricter rule cost a false positive on exactly what a sanitized
     `<img src=x onerror=…>` correctly becomes.
  2. **Make the position explicit instead of inferred** — `{{url u}}`, `{{attr title}}`,
     `{{text body}}`, `{{raw body}}`, with a bare `{{x}}` defaulting to the MOST
     restrictive policy. This deletes the bug class outright: there is no tokenizer left
     to be wrong. The two shipped templates need migrating, and the HTML→template
     conversion agent must emit annotations — but that agent is already the thing
     generating these templates, so it is a prompt change, not a product change.
- ☐ **Restore lockfile integrity.** Removing the lockfile fixed a real `npm ci` bug but
  threw away integrity hashes, so every tenant build resolves transitives fresh from the
  registry. `ignore-scripts` closes the execution path; it does not restore integrity.
  The real fix is for the writers to *regenerate* the lock rather than delete it.
- ◐ **`npm publish --provenance` from CI.** `.github/workflows/publish.yml` is written
  and does the right things (full suite + typecheck, tag↔version match, `--provenance`,
  `--ignore-scripts=false`, then `npm audit signatures`). **Two things before it works:**
  add an `NPM_TOKEN` repo secret, and decide whether you want publishing to move off
  your laptop at all — if you keep publishing by hand, delete the workflow rather than
  leave it as decoration, and add `npm audit signatures` to the checklist instead.
- ☐ **Fan-out cannot reach past its first 10 repos** — `listAllInstalledRepos` takes a
  limit and no cursor, so every run rescans the same first 10 while the response says
  "run again to continue". The only real enforcement mechanism is capped and says
  otherwise.
- ☐ **`auth/callback.ts` still signs `aud` for any origin the login flow names.** Closed
  at the consumer, not the signer.
- ☐ Verify GitHub actually refuses `.github/workflows/*` writes to an App token lacking
  the `workflows` permission — §5 now leans on it.

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
- ◐ **Fan-out safety.** A write run must now confirm the floor
  (`{"apply":true,"expectCritical":"0.1.6"}`) or it 409s — that closes both the stale
  shell-history fire and a hostile `critical` dist-tag. Still owed: an audit trail (a
  run leaves no record on the broker side), a rate limit on the bearer, and the cursor
  above.
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
