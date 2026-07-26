# Lanza — handoff (session 13, 2026-07-25)

**Read first:** `docs/security-model.md` (authoritative on auth/authz) ·
`docs/keys-and-secrets.md` (every credential, who holds it, blast radius) ·
`docs/lanza-site-extraction-plan.md` (the rental model — now SHIPPED, see below) ·
`docs/onboarding-workflow.md` · `docs/mcp-server.md`.

Status legend: ☑ done · ◐ in progress · ☐ todo

**Everything is committed and pushed.** Typecheck clean in both repos; `npm test`
39/39 + admin 47/47 in `lanza`, 31/31 in `lanza-broker`.

**But NOT published** — see "Next up" #0. Two tenant-facing changes sit in `main` and in
no tenant's `node_modules`. Publishing needs Dave's OTP; the agent cannot do it.

## What changed today — the rental model went live

Sites are no longer frozen photocopies. **All code ships as the npm package
`lanza-site`**; a tenant repo holds only content and pins one exact version.

| Thing | Where |
|---|---|
| Package | **`lanza-site`** on npm (unscoped — `@lanza` belongs to someone else) |
| Current | `latest: 0.1.6` · `critical: 0.1.5` — **the floor is one behind on purpose**, see "Next up" #0 |
| Template repo | `github.com/dsottimano/lanza-template` (public, is_template) |
| Broker points at it | `TEMPLATE_OWNER=dsottimano`, `TEMPLATE_REPO=lanza-template` |
| Proven tenant | `datadefine/claude_test` — onboarded through the wizard, thin, self-updating, MCP-verified |

**The update loop works end to end and has been driven against live sites:** publish
a version → the tenant's CMS (Settings → Software) shows it → one click writes
`package.json` and rebuilds. Reverting is offered too, since npm versions are
immutable. `npm dist-tag add lanza-site@X critical` marks everything below X unsafe:
tenants see a red warning, older versions become unselectable, and the broker's
fan-out force-moves them.

Publishing needs an OTP (`npm publish --otp=…`) — Dave does it; the agent cannot.

**Keep the `critical` floor at or above the newest version that changed the CMS UI.**
A floor below it rescues sites into a build whose admin lacks the screen they'd need
next — that trap was hit twice today.

## Commands you'll want

```sh
# Broker typecheck — lanza-broker has no package.json, so use the sibling's binary:
cd lanza-broker && /home/dsottimano/source/websites/lanza/node_modules/.bin/tsc --noEmit -p tsconfig.json

# Broker tests:
cd lanza-broker && node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs \
  --test functions/_lib/oauth-util.test.mjs functions/api/oauth/oauth-flow.test.mjs \
         functions/api/mcp-multisite.test.mjs functions/_lib/fanout.test.mjs

# Security fan-out — DRY RUN (safe, changes nothing):
curl -s -X POST https://connect.lanzacms.com/api/admin/fanout \
  -H "authorization: Bearer $(cat ~/.config/lanza/fanout-secret)" -d '{}'
# …add -d '{"apply":true}' to actually move sites.
```

`curl` output is rewritten by the RTK hook into a schema summary — use `rtk proxy curl …`
for the real body.

**Cloudflare Pages gotcha, hit three times today:** env vars and routes bind at
DEPLOYMENT time. A secret added after a build is invisible to it, and rolling back to
an older deployment reintroduces the problem even though the dashboard shows the value
set. A **405 with an empty body** on a Function route means the static handler is
answering — that route isn't in the deployed bundle.

---

## ☐ Next up

0. **◐ 0.1.6 PUBLISHED — the `critical` floor is still at 0.1.5.** `latest: 0.1.6`;
   tarball verified to carry `stagingUrlFor` (`mcp-core.ts`), `SCHEME_TOKENS`
   (`appearance.ts`) and a freshly built admin. Remaining step, once a real tenant's
   Software pane is confirmed to offer 0.1.6:

   ```sh
   npm dist-tag add lanza-site@0.1.6 critical
   ```

   **0.1.6 changes the CMS UI** (an Auto/Light/Dark control in the Brand card), so the
   floor must not be left below it. Verify the pane FIRST — moving the floor onto a
   version whose admin lacks a screen is the trap that bit twice on rental-model day.
   No tenant has 0.1.6 until it updates; `claude_test` was still answering `get_site`
   without `stagingUrl` on 0.1.5, which is what surfaced the whole gap.
1. **☑ Pre-package tenants retired.** `define-media-group`, `delete` and `delete22` are
   gone; `datadefine` now holds exactly one Lanza site, `claude_test` — thin,
   self-updating, onboarded through the wizard, and the MCP test target. No fat forks
   remain, so the fan-out's `unmanaged` case has nothing to report. **Their Cloudflare
   Pages projects still need deleting** if that wasn't done alongside.
2. **☑ Option B — CLOSED, deliberately not built** (2026-07-25). Lanza will not hold
   per-tenant Cloudflare tokens: a broker token store would put `page.write` on the
   whole fleet in one namespace. The store-nothing alternative was **verified
   impossible** — CF OAuth has 371 scopes, none for API-token management, and
   `GET /user/tokens` on an OAuth token → `403 code 9109`. Instead, CMS Cloudflare
   features are **opt-in**: the tenant creates their own API token. Site Health still
   503s until they do, and the card now says that's optional, not broken. Scopes
   trimmed to four; `offline_access` and the unreachable refresh path deleted.
3. **☐ Orphan repo on rejected install.** The tenant repo is created in the OAuth
   callback, *before* the `lanza-cms` App install screen. **Reject** leaves a repo
   nothing owns. Create it after consent, or detect the rejection at
   `/api/onboard/setup` and offer to delete. (`onboarding-workflow.md` §1.)
4. **☐ Support ticket to Cloudflare** for the already-installed trap: if the Workers
   and Pages App is already on a GitHub account, Cloudflare's own connect flow
   dead-ends and never writes the connection record. Reproduced without our code.
5. **☐ ChatGPT (developer mode) and Codex as MCP clients.** Only Claude Code has been
   tried, and it works.
6. **☐ Nothing in the product tells a tenant their MCP endpoint exists.** Grepped:
   `admin/src/` has **zero** mentions of `api/mcp`, MCP or connectors, and so do
   `frontend/` and `content/` — including `/agents`. The only mentions anywhere are
   `docs/mcp-server.md` and `docs/security-model.md`, repo files a customer never sees.
   Dave built it and still had to ask how to connect. Fix is a **Settings → Agents**
   pane, same shape as Settings → Software: the site's own `/api/mcp` URL, the
   multi-site URL, a copy button, and the sign-in-as-the-right-GitHub-account warning
   (`mcp-server.md:177` — GitHub silently reuses a live session, so re-authenticating
   does *not* switch accounts).

---

## ☑ Shipped today (don't re-litigate)

- **☑ Option B closed + Cloudflare features made opt-in** (`6d0ca98`, broker `bf3fb5c`).
  Detail in "Next up" #2. CF OAuth scopes trimmed to four in code **and on the CF client
  (Dave did the dashboard side)**; `offline_access` and the unreachable `refreshCfToken()`
  deleted — a ~16h access token in a 3600s cookie meant the refresh branch could never fire.
- **☑ Brand `scheme: "auto" | "light" | "dark"`** (`c315646`). lanzacms.com was never dark;
  `site.css`'s `prefers-color-scheme` flip had no opt-out, and `site.css` ships in the
  package so it couldn't just be gated. Pinning a mode emits all 14 differing tokens
  inline (inline beats a media query — no `data-theme` revival). Tenants without the key
  are byte-identical, verified by executing `resolveBrand`, not by inspection.
  lanzacms.com set to `"light"` (body text 14.83:1).
- **☑ `get_site` now returns `liveUrl` + `stagingUrl`.** Found by driving the MCP from a
  real client: the staging URL existed nowhere in the protocol, so the agent inferred
  Cloudflare's branch-alias convention and curl'd it. The whole model is
  write-to-staging-then-publish, so an agent that can't name the staging URL can't offer a
  review step. Derived from the request origin; **null on a custom domain**, where the
  alias lives on pages.dev under a project name the tenant can't learn (`PAGES_PROJECT` is
  now opt-in). A wrong URL is worse than an absent one.
- **☑ MCP verified end-to-end through the multi-site router.** `connect.lanzacms.com/api/mcp`
  drove `list_sites` → `get_site` → collections against `datadefine/claude_test`. The
  session-12 failure mode (green transport, dead content tools) is not present.
  Config: the dead single-site `dmg` entry is removed; `lanza` moved to **user scope**, so
  it works from any directory instead of only inside this repo.
- **☑ Wizard identity strip + width** (broker `1f899e0`). The two accounts ran together as
  one line of grey text; each is now a labelled chip, and the values link to the GitHub
  account, the repo, and the Cloudflare account dashboard. Four hardcoded max-widths
  became `--shell-width` / `--card-width`.
- **☑ `@lanza/site` P4/P5 — the whole rental model.** The extraction plan had been
  code-complete since 2026-07-04 and simply never published; TODO called it
  "deferred post-v1", which was wrong. Publishing it is what surfaced everything below.
- **☑ MCP single-site client leg** (was "never verified by a client"). Claude Code
  completed OAuth against a tenant and drove the tools. **It immediately found that
  every content tool was dead** — `getCollections` parsed `data/schema.json` as
  `{collections:[…]}` but the CMS writes a bare array, so collections resolved to `[]`,
  which 404'd every collection name and 403'd every entry path. 36/36 was green
  because the fixture invented the wrapped shape and no test ever called
  `list_collections`. Fixed, fixture corrected (`fab5aac`).
- **☑ Five bugs that only appear outside this repo**, all found by installing the
  published package into a fresh tenant: `public/` not created (**every** new tenant's
  first build died); a missing `astro.config.mjs` built ZERO pages and exited 0
  (a silent empty deploy over a live site); lanzacms.com's marketing pages
  (`/how-it-works`, `/start`, `/agents`) served on customer domains; Lanza's blog
  description as the tenant's meta description; and a **hardcoded Spanish 404** left
  over from La Perle — also live on lanzacms.com itself. Marketing pages are now gated
  behind `productSite: true` in `data/site.json`, which only this repo sets.
- **☑ Settings → Software** (`dd4444e`, `8785161`, `4522550`): running version in the
  sidebar footer, update/revert, revert guard, unsafe versions unselectable, and an
  in-place explanation when the broker force-updated the site.
- **☑ Security fan-out** (broker `a0af2a4` → `ade0563`): operator-only, dry-run by
  default, bumps only below-floor sites and only up to the floor. Took three fixes
  after first contact — the last was that judging by the production branch alone hid
  an unsafe drafts branch, and once production was rescued the fan-out could no longer
  see what it had missed.
- **☑ Onboarding no longer shows ~12s of blank screen** (`4557e55`): the OAuth
  callback streams a progress page and redirects at the end.

**The lesson worth carrying:** every one of these was invisible from inside this repo
and appeared within minutes of real use. Session 12 marked MCP "deployed and verified"
on transport checks alone while all ten content tools were unreachable. Prefer one
real run over another green suite.

---

## ☐ Known-open security items (reviewed, deliberately not fixed)

Full detail in `docs/security-model.md` §5.

- ☐ **Sessions can't be revoked.** Stateless 7-day RS256 bearer, no `jti`. Also covers
  MCP grants: a multi-site `sites` claim can't be revoked before its 1h expiry.
- ☐ **The handoff token *is* the session token.**
- ◐ **A CF access token still passes through the browser** (`lanza_cf`), now for at most
  its 3600s cookie life and **with no refresh token** — `offline_access` is gone. The
  wizard needs `page.write` in the browser flow to create the Pages project, so the
  cookie can't be removed outright. Accepted as-is; Option B is closed (see above).
- ☑ **CF OAuth scopes trimmed** to `account-settings.read`, `user-details.read`,
  `page.read`, `page.write` — four, each with a caller. **Done on both sides**: the code
  (`bf3fb5c`) and the Cloudflare OAuth client (Dave, dashboard). Keep `user-details.read`
  — `describeIdentity` (`_lib/cf-accounts.ts`) needs it for the wizard's identity strip.
  Do NOT reuse the nested checkout's trim; re-derive from canonical.
- ☐ **Proxy relays upstream headers verbatim** (inherits GitHub's `Cache-Control` /
  `ACAO: *`). Latent unless the session cookie moves to `SameSite=None`.
- ☐ **No `Origin` validation on the MCP transport** (broker router included).
- ☐ **Wizard polls with no cap or backoff** — ~1,200 authenticated CF calls/hour if a
  user walks away.
- ☐ **`ensureDeployment` ignores `res.ok`** — a failed trigger still reports
  `state:"deploying"`, so the poll spins forever.
- ☐ **Fan-out reach.** `listAllInstalledRepos` returns every repo the App can write to,
  across all accounts — including strangers' (`byrobychoi/wifi-g5` showed up in the
  first real run). It is fan-out-only by design; keep it that way, and keep the dry run.
- ☐ **Unsafe-version blocking is UI-only.** The owner can still pin a bad version by
  editing `package.json` on GitHub. The fan-out is the real enforcement.

---

## ☐ Cleanup owed

- ◐ **Test repos under `datadefine`:** the repos are **deleted** (`delete`, `delete22`,
  `define-media-group`) — only `claude_test` remains, and it's wanted. Still owed: their
  **Pages projects**, and `dsottimano/dave-test`.
- ☐ Delete `dsottimano/lanza-deploytest-11556` + the two `lanza-deploytest-*` Pages
  projects.
- ☐ **Delete the nested `lanza/lanza-broker` checkout.** Canonical is the **sibling**
  `../lanza-broker`. The nested copy is stale at `f8838d1` with uncommitted junk.
- ☐ **Rotate secrets pasted or screenshotted in earlier sessions:** the exploratory CF
  API token, the broker `OAUTH_CLIENT_SECRET` / App client secret, the old tenant
  `GITHUB_TOKEN`. Procedure: `docs/keys-and-secrets.md` §7. (`FANOUT_SECRET` was
  generated straight into `~/.config/lanza/fanout-secret` and never pasted into a chat.)
- ☐ Sweep the word "dogfood" out of the repo (~16 places).
- ☐ `docs/lanza-site-extraction-plan.md` still says "P4 deploy actions left to Dave" —
  they're done. Mark P4/P5 shipped.

---

## ☐ Backlog / deferred

- ☐ **Fan-out has no scheduler.** It's a manual `curl`. Pages has no cron; a Worker
  with a cron trigger could call it if that's ever wanted.
- ☐ **No release notes.** The Software pane lists versions and dates but can't say
  what changed. A `CHANGELOG` or a field the pane fetches would fix it.
- ☐ **MCP: wrong-GitHub-account failure is invisible on the single-site endpoint** —
  a bare 403; the client just loops. Multi-site solves it by construction.
- ☐ **Wizard: GitHub-account gate before step 1** — "Connect GitHub" with no account
  is a dead end.
- ☐ **Wizard: gamified progress — plane + skydiver** (honor `prefers-reduced-motion`).
- ☐ **MCP media/image upload tool.**
- ☐ **MCP self-host story** — no broker means no OAuth AS. Single-site can work with
  `GITHUB_TOKEN`; the multi-site router is broker-only by definition.
- ☐ **Variables page in Settings** — site-wide `{{ placeholders }}`.
- ☐ **Taxonomy-rename referential integrity** — renaming a slug doesn't rewrite posts.
- ☐ **Slug-collision UX** — raw GitHub 422 today.
- ☐ **Preview brand accuracy** — CMS preview uses `site.css` defaults, not `appearance.json`.
- ☐ **CMS in-place visual editing (Phase 2)** — needs a DOM→template source map.
- ☐ **Admin dark mode** — needs a var-ification sweep across ~36 files.
