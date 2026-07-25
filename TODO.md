# Lanza — handoff (session 10, 2026-07-25)

**Read first:** `docs/security-model.md` (authoritative on auth/authz — new this session)
· `docs/onboarding-workflow.md` (life-of-an-onboarding + the Cloudflare OAuth recipe)
· `docs/onboarding-broker-design.md` (why/decisions) · `docs/mcp-server.md`.

Status legend: ☑ done · ◐ in progress · ☐ todo

**Everything is committed and pushed.** `lanza-broker` → `44aea09`+ (5 fixes this session).
Typecheck clean both repos; `npm test` 36/36 in `lanza`.

Broker typecheck note: there is no TypeScript installed in `lanza-broker` (no `package.json`).
`npx tsc` there tries to install and fails — use the sibling's binary:
`cd lanza-broker && /home/dsottimano/source/websites/lanza/node_modules/.bin/tsc --noEmit -p tsconfig.json`

---

## ☑ UNBLOCKED — first full onboarding ran end to end

`datadefine/aaaaaa` → `aaaaaa-79d94dc420e1.pages.dev`: repo generated, deployed, `/admin`
login as `datadefine`, post written, saved to `staging`, published to `main`, Cloudflare
rebuilt, post live. **The whole chain works.** Driven as a third-party tenant (GitHub
`datadefine` + Cloudflare `data@definemg.com`), which is the point — not as `dsottimano`.

### 8000011, root-caused and proven both directions

Cloudflare keeps an account-level **git connection record**, separate from the GitHub App
installation:

```
GET https://api.cloudflare.com/client/v4/accounts/<id>/pages/connections
```

- `result: []` → creating a git-sourced Pages project returns **8000011**
- one record present → the *identical* create returns `deploying` immediately

The record is only written when **Cloudflare initiates** the install. Its connect button
sends the user to
`github.com/apps/cloudflare-workers-and-pages/installations/new/permissions?state=…&target_id=…`,
and that **`state`** is what binds the installation back to the account. Our wizard sent
users to GitHub's bare install URL, which carries no state — so the record was never
written and *every* tenant would have hit 8000011. Fixed: step 3 now opens
`dash.cloudflare.com/<accountId>/pages/new/provider/github`.

**The remaining trap — Cloudflare's bug, not ours.** If the App is *already* installed on
GitHub, Cloudflare's own connect flow dead-ends at `github.com/settings/installations/<id>`
and still writes nothing. Reproduced inside Cloudflare's own UI with our code out of the
picture. The only escape is to uninstall **Cloudflare Workers and Pages** on GitHub and let
Cloudflare install it fresh. The wizard now surfaces this as a hint after ~6 polls, but it
cannot fix it — worth a support ticket.

---

## ☑ Shipped in session 10 (broker `44aea09`+)

- **Tenant identity race.** `/generate` returns before GitHub commits the template, so
  `setTenantConfig` wrote `lanza.config.json` to a near-empty repo and GitHub's "Initial
  commit" landed *on top*, reverting it. Every tenant booted with the template's
  `dsottimano/lanza` identity: locked out of its own `/admin`, CMS pointed at the template
  repo. Now waits for the placeholder and updates by SHA. Verified — on `aaaaaa` the
  identity commit is the child, and `/admin` admitted `datadefine` first try.
- **Start over.** The wizard's state is all HttpOnly cookies, so a reload resumed a dead
  run forever and nobody could create a *second* site. `POST /api/onboard/reset` +
  a topbar control.
- **Step 3 → Cloudflare deep link** (above). **Confirmed on a clean account**: with the
  Cloudflare App uninstalled and no connection record, `datadefine/bbbb` →
  `bbbb-2db67eab8649.pages.dev` ran through without dashboard detours. Note it is not
  re-testable on an account that already has a record — a rerun sails past the step.
- **Entry point asks instead of resuming.** A bare `connect.lanzacms.com` used to resume
  whatever the cookies held, so "Start your site" on lanzacms.com landed on a *previous*
  tenant's completion screen. Now: Continue / Start a new site / the Lanza sites on the
  account, each flagged when the git connection is missing (`GET /api/onboard/sites`).
- **Wizard shell was cached 4h.** A zone-level Browser Cache TTL on `lanzacms.com` overrode
  origin headers, so returning users ran stale wizard code — this hid two shipped fixes
  during testing. Dave set the zone to respect existing headers; `_headers` now marks the
  shell `no-cache` and fonts immutable. **Anyone testing must hard-reload once**: responses
  cached under the old 4h TTL stay fresh in the browser regardless.
- **`pages/projects` rejects pagination.** `?page=`/`?per_page=` → 400 code 8000024, unlike
  `/accounts` which needs them. Cost an empty sites list until found.
- **Identity strip.** The wizard now names the GitHub login/repo and the Cloudflare user +
  account, so nobody discovers the wrong account after the site exists.
- **Health screen verifies git.** It ticked "Git integration" unconditionally;
  `star-real-estate` proved a project created without a connection still *displays* a
  linked repo, builds once, then never rebuilds. Now checks `pages/connections` at `live`
  and says edits won't rebuild when empty (three-state: `null` stays silent).

### Debugging setup worth reusing

Brave with CDP on `:9222` + a dependency-free client at
`scratchpad/cdp.py` (`targets` / `eval` / `goto` / `shot`, `CDP_TARGET=<url substring>`).
That is how the dashboard API was queried as the logged-in user and how the CMS
edit/publish was driven. Launch: `brave-browser-stable --remote-debugging-port=9222
--user-data-dir=<scratch> <url>` (a fresh dir; an already-running Brave swallows the flag).

---

## ☑ Shipped this session

**Full security review** (4 parallel reviewers across both repos) → 5 fixes, all pushed.
Findings and rationale live in `docs/security-model.md`; the four invariants there each
exist because something got past.

- **`/admin` accepted any GitHub account.** The middleware checked signature + audience +
  expiry and admitted. The broker signs a token for anyone who authenticates, so that
  authorized nobody — any GitHub user reached `/admin/api/cf/*` and its account-scoped
  Cloudflare token. Now checks `adminLogin` via shared `session.ts:isAllowedLogin`.
- **Proxy allowlist traversal.** `\` and `%2e%2e` both escaped `repos/<owner>/<name>/`
  (verified: wrote to an arbitrary repo; deleted the branch Astro builds from). Fixed by
  folding separators/encoding before the check **and** re-validating the resolved URL.
- **Proxy failed open.** A broker *denial* was treated as a broker *outage*, handing a
  rejected caller the standing `GITHUB_TOKEN`. Now three-state.
- **Broker `/api/token` ignored `aud`.** Ownership alone meant a session minted for any
  origin could mint Contents:write on **every** repo its login owns. Now bound to the repo
  via `_lib/tenant-origin.ts` (derives the expected origin; no new state).
- **MCP tools could write anywhere in the repo.** `locale` and `path` were unvalidated;
  `encodeURIComponent` doesn't escape dots. Reachable: `.github/workflows/*` (CI code
  execution via stage-then-publish) and `lanza.config.json` (owns `/admin`). Now confined
  by `assertSafePath` + `assertEntryPath` + locale validation. `create_content` no longer
  silently overwrites.

### Onboarding fixes (from driving the live run)

- **Cloudflare account is now chosen, not guessed** (`_lib/cf-accounts.ts`,
  `api/onboard/accounts.ts`). It was `accounts[0]` — whichever Cloudflare listed first —
  so anyone in more than one account (agency staff, contractors, anyone added to a
  client's account) got their site built in the wrong place. It was also resolved
  *independently* by the deploy POST and the polling GET with nothing persisted between
  them, so a listing-order change stranded the wizard on an account the project was never
  created in. The choice now lives in the `lanza_cf` cookie, survives token refresh, is
  re-validated on use, and paginates the account list. A single-account user never sees
  the picker.
- **Pages project name is derived, not the repo name** (`_lib/tenant-origin.ts`).
  `*.pages.dev` is one global namespace across **every** Cloudflare account, so `test`,
  `blog`, `bakery` collided with strangers on the first try — and the collision read as
  *success*, deploying nothing and pointing the user at a third party's `/admin`.

  ```
  <repo-slug>-<sha256(owner/repo)[0..12]>
  datadefine/test  ->  test-0304ea543eaf.pages.dev
  someone/test     ->  test-f3d658bc73b5.pages.dev
  ```

  **Derived rather than random on purpose:** `/api/token` must recompute a tenant's origin
  to check a session's `aud` (I4). A random name would break that and force a persistent
  repo→origin store. Fallback ladder `[base, base-2, base-3, base-4]` because only
  Cloudflare knows what is truly free; `allowedOriginsForRepo` accepts every candidate so
  the audience check stays correct whichever one wins. Verified: deterministic, no
  cross-owner collision, worst case 57 chars (limit 58). **Full rationale:
  `docs/security-model.md` §2 — read it before touching project naming.**
- **`awaiting_git_authorize` now reports why.** It discarded Cloudflare's error body, so a
  forever-spinning wizard gave no clue which account/repo/project was being rejected.

**Also shipped:** the MCP server itself (committed — the previous handoff's "NOT committed"
is stale).

**Config Dave set this session:** `ALLOWED_TENANT_ORIGINS=https://lanzacms.com` on the
broker (required — lanzacms.com's repo is `lanza`, so the derived origin is
`lanza-76cae1b6cc54.pages.dev` and won't match), plus `HANDOFF_PUBLIC_KEY` / `OAUTH_CLIENT_ID` /
`OAUTH_CLIENT_SECRET` verified present.

---

## ☐ MCP — blocked on a repo split, not on code

The MCP server ships in `@lanza/site` and is committed. **It cannot work in production yet**
because the OAuth *authorization server* half lives only in a stale second checkout.

- `/home/dsottimano/source/websites/lanza-broker` — canonical, has the onboarding work,
  **no `api/oauth/*`**.
- `/home/dsottimano/source/websites/lanza/lanza-broker` — gitignored, 4+ commits behind,
  doesn't even contain the canonical HEAD object, **holds the only copy of the AS** plus an
  uncommitted CF scope trim.

The tenant advertises `connect.lanzacms.com` as its authorization server, so discovery
404s and every MCP connection dies at step 2.

1. **☐ Rebase the AS work onto the canonical checkout and commit from there.** Never commit
   from the nested copy. Files to move: `functions/.well-known/oauth-authorization-server.ts`,
   `functions/api/oauth/{authorize,github-callback,token,register}.ts`,
   `functions/_lib/oauth-{util,store}.ts` + their tests.
2. **☐ Dave prereqs:** create + bind KV namespace **`OAUTH_KV`** on the broker Pages project
   (the AS 500s without it); register callback
   **`https://connect.lanzacms.com/api/oauth/github-callback`** on the `lanza-cms` App.
3. **☐ Live-verify** with a Claude custom connector against `https://lanzacms.com/api/mcp`:
   401 → discover → GitHub approve → `tools/list` → `create_content` → `publish`. Then
   ChatGPT (developer mode) and Codex.

**Gotchas:** `WWW-Authenticate` must be on the 401 (Claude ignores it on 200) ✓. PRM
`resource` must byte-match the connect URL ✓. CIMD is primary, DCR the KV-backed fallback.

---

## ☐ Known-open security items (reviewed, deliberately not fixed)

Full detail + rationale in `docs/security-model.md` §5. Listed here so they stay decisions.

- ☐ **Sessions can't be revoked.** Stateless 7-day RS256 bearer, no `jti`. Logout clears the
  cookie only; removing a login from `ADMIN_LOGIN` doesn't invalidate live sessions. Only
  kill switch is rotating `HANDOFF_PRIVATE_KEY`, which signs out every tenant at once.
- ☐ **The handoff token *is* the session token** — one artifact for transport and session.
- ☐ **CF OAuth scopes: code still requests 8, docs say 4.** `cf/login.ts:28-37` still asks for
  `user-details.read`, `workers-kv-storage.write`, `d1.write`, `workers-r2.write` — none are
  called anywhere. **Trim the code, not the CF client** (trimming the client first breaks the
  connect step with a generic CF error). Also `cf/login.ts:59` honours an unauthenticated
  `?scope=` override.
- ☐ **CF tokens live in a browser cookie** (`lanza_cf`, unauthenticated base64 JSON,
  `HttpOnly; Secure`, `Path=/`) — contradicts `onboarding-workflow.md`'s "token never
  exposed to the browser" invariant.
- ☐ **Proxy relays upstream headers verbatim** — inherits GitHub's `Cache-Control` and
  `ACAO: *` rather than enforcing CLAUDE.md Rule 2. Latent: becomes live if the session
  cookie ever moves to `SameSite=None`.
- ☐ **No `Origin` validation on the MCP transport** (spec asks for it; low impact, Bearer auth).
- ☐ **Wizard polls with no cap or backoff** — `setInterval` every 3s, several CF API calls per
  tick, no attempt limit. A user who walks away generates ~1,200 authenticated calls/hour.
- ☐ **`ensureDeployment` ignores `res.ok`** — a failed deployment trigger still reports
  `state:"deploying"`, so the build poll spins forever with no terminal error.

---

## ☐ Option B — runtime CF proxy + per-tenant token store

Decided, not built. Wire tenant `functions/admin/api/cf/[[path]].ts` to source the CF token
**through the broker** (dual-mode: own `CLOUDFLARE_API_TOKEN` direct, else broker), and
decide the broker's persistent `{access, refresh, expires_at}` store (KV? DO?). This is what
wires the CF token into the *running* CMS for KV/D1/R2 provisioning — separate from the
wizard, which rides cookies. Until then every onboarded tenant's Site Health panel returns
503 permanently (the broker sets only `NODE_VERSION` on new Pages projects).

---

## ☐ Cleanup owed

- ☐ Delete test repo `dsottimano/lanza-deploytest-11556` + the two `lanza-deploytest-*` Pages
  projects.
- ☐ Delete the session-9/10 tenant wreckage under `datadefine`: repos `test`,
  `star-real-estate`, `blah-blah` (all three carry the WRONG identity in `main` — they
  predate the race fix) and `aaaaaa`, plus their Pages projects. `star-real-estate`'s
  project is the zombie: linked repo, no connection behind it.
- ☐ **Burn/rotate secrets pasted or screenshotted in earlier sessions:** the exploratory CF
  API token, the broker `OAUTH_CLIENT_SECRET` / App client secret, and the old tenant
  `GITHUB_TOKEN` (now unused on prod). Broker private keys are already Secret type.
- ☐ Drop test post `content/posts/es/test.md` via the CMS if unwanted (it publishes).
- ☐ Sweep the word "dogfood" out of the repo (~16 places: `bin/lanza.mjs`,
  `functions/_lib/tenant-config.ts`, `docs/lanza-site-extraction-plan.md`,
  `admin/src/help/09-onboarding-and-hosting.md`, others). Say "the site we run on Lanza".

---

## ☐ Backlog / deferred (genuinely open, not blocking)

- ☐ **Wizard: GitHub-account gate before step 1** — non-technical users may not have a GitHub
  account, and "Connect GitHub" with none is a dead end. Ask first → No opens
  `github.com/signup` in a new tab; Yes proceeds. Frame GitHub as "the free account that
  stores your site's content." `lanza-broker/index.html` step "github".
- ☐ **Wizard: gamified progress — plane + skydiver** — replace "Step N of 5" with an SVG scene
  in the page's hand-drawn blue-arrow aesthetic: a plane climbing across steps 1–4, skydiver
  jumping on step 5 (deploy→land-in-/admin). Honor `prefers-reduced-motion`.
- ☐ **MCP media/image upload tool** (deferred from v1 — content tools only).
- ☐ **MCP self-host story** — without a broker there's no OAuth AS; document or provide an
  authless/bearer mode.
- ☐ **`@lanza/site` extraction P4/P5** — deferred post-v1 (v1 ships a fat template repo,
  design §11.4). P4: thin content-only tenant repo + publish `@lanza/site`. P5: stable
  pointer + safe-revert + "update available" banner. Recover from
  `docs/lanza-site-extraction-plan.md` + git history.
- ☐ **Variables page in Settings** — site-wide `{{ placeholders }}` for templates and the
  header/footer builder (the clean fix for wanting a computed year instead of a raw
  `<script>`, which the engine emits verbatim and the preview sandbox blocks).
- ☐ **Taxonomy-rename referential integrity** — renaming a category/tag/author slug doesn't
  rewrite posts referencing it. Needs a reference sweep or a guard.
- ☐ **Slug-collision UX** — renaming onto an existing slug fails with a raw GitHub 422; wants
  a pre-flight check.
- ☐ **Preview brand accuracy** — CMS live-preview uses `site.css` defaults, not the live Brand
  overrides from `appearance.json`.
- ☐ **CMS in-place visual editing (Phase 2)** — click a rendered region → edit → write back to
  its `{{slot}}`; needs a DOM→template source-map (`data-lz-path`).
- ☐ **Admin dark mode** — mixes CSS vars with hardcoded `text-zinc-*`/`bg-white` across ~36
  files; needs a var-ification sweep first.
