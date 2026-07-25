# Lanza — handoff (session 9, 2026-07-25)

**Read first:** `docs/security-model.md` (authoritative on auth/authz — new this session)
· `docs/onboarding-workflow.md` (life-of-an-onboarding + the Cloudflare OAuth recipe)
· `docs/onboarding-broker-design.md` (why/decisions) · `docs/mcp-server.md`.

Status legend: ☑ done · ◐ in progress · ☐ todo

**Everything is committed and pushed.** `lanza` → `b4d4b58`, `lanza-broker` → `e44976a`.
Typecheck clean both repos; `npm test` 36/36 in `lanza`.

---

## ◐ BLOCKED RIGHT NOW — first live onboarding run

Driving the wizard end-to-end for the first time. Stuck at **step 3 (GitHub ↔ Cloudflare
authorize)**, which polls forever.

**Exact state when it stalled:**

| | |
|---|---|
| GitHub login used | `datadefine` (not `dsottimano`) |
| Repo created | `datadefine/test` ☑ |
| `lanza-cms` App installed on it | ☑ |
| Cloudflare Workers and Pages App installed | ☑ (installation `148982753`) |
| CF account used | `a1e22bc0c133063c7bd02358c1f2e7df` (auto-picked, unverified) |
| `POST /api/onboard/deploy` returns | `8000011: There is an internal issue with your Cloudflare Pages Git installation.` |

**Next actions, in order:**

1. **☐ Confirm the CF account.** The picker shipped this session (`e44976a`) — rerun the
   wizard and choose explicitly. If the error changes, the auto-picked account was the bug.
   Compare against the ID in your `dash.cloudflare.com/<id>/…` URL.
2. **☐ If still 8000011 on the right account** — Cloudflare's record of the GitHub
   installation is stale. Uninstall **Cloudflare Workers and Pages** from GitHub
   (Settings → Applications), then reconnect via **CF dashboard → Workers & Pages → Create
   → Pages → Connect to Git**, which recreates the link. Then retry.
3. **☐ Rename the repo before retrying.** The project name is derived from the repo, and
   `*.pages.dev` names are **globally unique across all Cloudflare accounts** — `test`
   is certainly taken. (`e44976a`'s parent now reports this clearly instead of reporting
   success and sending the user to a stranger's site.)
4. **☐ Then finish the chain:** deploy → health screen → log into `/admin` → save an edit →
   publish. **Note:** `/admin` on the new site gates on that repo's `adminLogin`, so log in
   as the account that owns it.

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

**Also shipped:** the MCP server itself (committed — the previous handoff's "NOT committed"
is stale), the Cloudflare account picker, and `8000011` diagnostics.

**Config Dave set this session:** `ALLOWED_TENANT_ORIGINS=https://lanzacms.com` on the
broker (required — lanzacms.com's repo is `lanza`, so the derived origin is
`lanza.pages.dev` and won't match), plus `HANDOFF_PUBLIC_KEY` / `OAUTH_CLIENT_ID` /
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

Full detail + rationale in `docs/security-model.md` §4. Listed here so they stay decisions.

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
  projects. Add `datadefine/test` + its project to this list if abandoned.
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
