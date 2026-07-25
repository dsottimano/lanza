# Lanza — handoff (session 10, 2026-07-25)

**Read first:** `docs/security-model.md` (authoritative on auth/authz) ·
`docs/keys-and-secrets.md` (every credential, who holds it, blast radius) ·
`docs/onboarding-workflow.md` (life-of-an-onboarding + Cloudflare API notes) ·
`docs/onboarding-broker-design.md` (why/decisions) · `docs/mcp-server.md`.

Status legend: ☑ done · ◐ in progress · ☐ todo

**Everything is committed and pushed.** Typecheck clean in both repos; `npm test` 36/36
in `lanza`. Nothing is blocked on code you can't see.

Broker typecheck note: `lanza-broker` has no `package.json`, so `npx tsc` there tries to
install and fails. Use the sibling's binary:
`cd lanza-broker && /home/dsottimano/source/websites/lanza/node_modules/.bin/tsc --noEmit -p tsconfig.json`

---

## Where things stand

**Onboarding works end to end.** A stranger (GitHub `datadefine` + Cloudflare
`data@definemg.com` — deliberately not the Lanza owner) went from nothing to a live site:
repo generated → deployed → `/admin` login → post written → saved to `staging` →
published to `main` → Cloudflare rebuilt → live. Confirmed twice, the second time
(`datadefine/bbbb`) on a clean account with no manual dashboard work at all.

Session 10 fixed nine things, all pushed. The reasoning now lives in the docs rather
than here — `onboarding-workflow.md` §3 for `8000011` (an account-level Cloudflare git
connection record that only Cloudflare itself can write), §1 for the two repo-generation
races, and `keys-and-secrets.md` for the credential model. `git log` in `lanza-broker`
has the per-fix detail.

**Testing note that will waste an hour if forgotten:** step 3 is only exercised on an
account with **no** connection record. Check
`/accounts/<id>/pages/connections` → must be `result: []` before a test run, or the
wizard sails past the thing you meant to test.

### Debugging setup worth reusing

Brave with CDP on `:9222` + a dependency-free client (`cdp.py` in the session
scratchpad: `targets` / `eval` / `goto` / `shot`, `CDP_TARGET=<url substring>`). That is
how Cloudflare's dashboard API was queried as the logged-in user and how the CMS
edit/publish was driven without copy-paste. Launch:
`brave-browser-stable --remote-debugging-port=9222 --user-data-dir=<fresh dir> <url>`
— an already-running Brave swallows the flag.

---

## ☐ Next up

1. **☐ Orphan repo on rejected install.** The tenant repo is created in the OAuth
   callback, *before* the user sees the `lanza-cms` App install screen. Clicking
   **Reject** leaves a repo on their account that nothing owns and the wizard never
   mentions. Either create the repo after consent, or detect the rejection at
   `/api/onboard/setup` and offer to delete it. (`onboarding-workflow.md` §1.)
2. **☐ Option B — get Cloudflare tokens out of the browser.** See its section below.
   This is what makes Site Health work at all, and it closes a known-accepted risk.
3. **☐ Support ticket to Cloudflare** for the already-installed trap: if the Workers and
   Pages App is already installed on a GitHub account, Cloudflare's *own* connect flow
   dead-ends at `github.com/settings/installations/<id>` and never writes the connection
   record. Reproduced with our code out of the picture. We can only hint at it; they
   have to fix it.
4. **☐ MCP** — blocked on a repo split, not on code. See below.

---

## ☐ MCP — blocked on a repo split, not on code

The MCP server ships in `@lanza/site` and is committed. **It cannot work in production**
because the OAuth *authorization server* half exists only in a stale second checkout.

- `/home/dsottimano/source/websites/lanza-broker` — canonical, has all the onboarding
  work, **no `api/oauth/*`**.
- `/home/dsottimano/source/websites/lanza/lanza-broker` — gitignored, many commits
  behind, **holds the only copy of the AS** plus an uncommitted CF scope trim.

The tenant advertises `connect.lanzacms.com` as its authorization server, so discovery
404s and every MCP connection dies at step 2.

1. **☐ Rebase the AS work onto the canonical checkout and commit from there.** Never
   commit from the nested copy. Files: `functions/.well-known/oauth-authorization-server.ts`,
   `functions/api/oauth/{authorize,github-callback,token,register}.ts`,
   `functions/_lib/oauth-{util,store}.ts` + tests.
2. **☐ Dave prereqs:** create + bind KV namespace **`OAUTH_KV`** on the broker Pages
   project (the AS 500s without it); register callback
   **`https://connect.lanzacms.com/api/oauth/github-callback`** on the `lanza-cms` App.
3. **☐ Live-verify** with a Claude custom connector against `https://lanzacms.com/api/mcp`:
   401 → discover → GitHub approve → `tools/list` → `create_content` → `publish`. Then
   ChatGPT (developer mode) and Codex.

**Gotchas:** `WWW-Authenticate` must be on the 401 (Claude ignores it on 200) ✓. PRM
`resource` must byte-match the connect URL ✓. CIMD is primary, DCR the KV-backed fallback.

---

## ☐ Option B — runtime CF proxy + per-tenant token store

Decided, not built. Wire tenant `functions/admin/api/cf/[[path]].ts` to source the
Cloudflare token **through the broker** (dual-mode: own `CLOUDFLARE_API_TOKEN` direct,
else broker), and decide the broker's persistent `{access, refresh, expires_at}` store
(KV? DO?).

Two things depend on it: **every onboarded tenant's Site Health panel returns 503
permanently** (the broker sets only `NODE_VERSION` on new Pages projects), and it is the
fix for Cloudflare tokens living in a browser cookie (below). Separate from the wizard,
which rides cookies by design.

---

## ☐ Known-open security items (reviewed, deliberately not fixed)

Full detail + rationale in `docs/security-model.md` §5. Listed so they stay decisions.

- ☐ **Sessions can't be revoked.** Stateless 7-day RS256 bearer, no `jti`. Logout clears
  the cookie only; removing a login from `ADMIN_LOGIN` doesn't invalidate live sessions.
  Only kill switch is rotating `HANDOFF_PRIVATE_KEY`, which signs out every tenant.
- ☐ **The handoff token *is* the session token** — one artifact for transport and session.
- ☐ **CF tokens live in a browser cookie** (`lanza_cf`, unauthenticated base64 JSON,
  `HttpOnly; Secure`, `Path=/`). Fixed by Option B above.
- ☐ **CF OAuth scopes: three still unused.** `cf/login.ts` requests
  `workers-kv-storage.write`, `d1.write`, `workers-r2.write`, which no code path calls.
  **Trim the code, not the CF client** — trimming the client first breaks the connect
  step with a generic error. (`user-details.read` *is* now used, by `describeIdentity`.)
  Also `cf/login.ts` honours an unauthenticated `?scope=` override.
- ☐ **Proxy relays upstream headers verbatim** — inherits GitHub's `Cache-Control` and
  `ACAO: *` rather than enforcing CLAUDE.md Rule 2. Latent: live if the session cookie
  ever moves to `SameSite=None`.
- ☐ **No `Origin` validation on the MCP transport** (spec asks for it; low impact,
  Bearer auth).
- ☐ **Wizard polls with no cap or backoff** — every 3s, several CF API calls per tick, no
  attempt limit. A user who walks away generates ~1,200 authenticated calls/hour.
- ☐ **`ensureDeployment` ignores `res.ok`** — a failed deployment trigger still reports
  `state:"deploying"`, so the build poll spins forever with no terminal error.

---

## ☐ Cleanup owed

- ☐ **Test wreckage under `datadefine`:** repos `test`, `star-real-estate`, `blah-blah`
  (all three carry the WRONG identity in `main` — they predate the race fix), `aaaaaa`
  and `bbbb`, plus their Pages projects. `star-real-estate`'s project is the zombie:
  linked repo, no connection behind it.
- ☐ Delete `dsottimano/lanza-deploytest-11556` + the two `lanza-deploytest-*` Pages
  projects.
- ☐ **Rotate secrets pasted or screenshotted in earlier sessions:** the exploratory CF
  API token, the broker `OAUTH_CLIENT_SECRET` / App client secret, and the old tenant
  `GITHUB_TOKEN` (now unused on prod). Broker private keys are already Secret type.
  Procedure + blast radius: `docs/keys-and-secrets.md` §7.
- ☐ Drop test post `content/posts/es/test.md` via the CMS if unwanted (it publishes).
- ☐ Sweep the word "dogfood" out of the repo (~16 places: `bin/lanza.mjs`,
  `functions/_lib/tenant-config.ts`, `docs/lanza-site-extraction-plan.md`,
  `admin/src/help/09-onboarding-and-hosting.md`, others). Say "the site we run on Lanza".

---

## ☐ Backlog / deferred (genuinely open, not blocking)

- ☐ **Wizard: GitHub-account gate before step 1** — non-technical users may not have a
  GitHub account, and "Connect GitHub" with none is a dead end. Ask first → No opens
  `github.com/signup` in a new tab; Yes proceeds. Frame GitHub as "the free account that
  stores your site's content." `lanza-broker/index.html` step "github".
- ☐ **Wizard: gamified progress — plane + skydiver** — replace "Step N of 5" with an SVG
  scene in the page's hand-drawn blue-arrow aesthetic: a plane climbing across steps
  1–4, skydiver jumping on step 5 (deploy→land-in-/admin). Honor `prefers-reduced-motion`.
- ☐ **MCP media/image upload tool** (deferred from v1 — content tools only).
- ☐ **MCP self-host story** — without a broker there's no OAuth AS; document or provide
  an authless/bearer mode.
- ☐ **`@lanza/site` extraction P4/P5** — deferred post-v1 (v1 ships a fat template repo,
  design §11.4). P4: thin content-only tenant repo + publish `@lanza/site`. P5: stable
  pointer + safe-revert + "update available" banner. Recover from
  `docs/lanza-site-extraction-plan.md` + git history.
- ☐ **Variables page in Settings** — site-wide `{{ placeholders }}` for templates and the
  header/footer builder (the clean fix for wanting a computed year instead of a raw
  `<script>`, which the engine emits verbatim and the preview sandbox blocks).
- ☐ **Taxonomy-rename referential integrity** — renaming a category/tag/author slug
  doesn't rewrite posts referencing it. Needs a reference sweep or a guard.
- ☐ **Slug-collision UX** — renaming onto an existing slug fails with a raw GitHub 422;
  wants a pre-flight check.
- ☐ **Preview brand accuracy** — CMS live-preview uses `site.css` defaults, not the live
  Brand overrides from `appearance.json`.
- ☐ **CMS in-place visual editing (Phase 2)** — click a rendered region → edit → write
  back to its `{{slot}}`; needs a DOM→template source-map (`data-lz-path`).
- ☐ **Admin dark mode** — mixes CSS vars with hardcoded `text-zinc-*`/`bg-white` across
  ~36 files; needs a var-ification sweep first.
