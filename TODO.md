# Lanza — handoff (session 8, 2026-07-05): the onboarding wizard is BUILT

**Read first:** `docs/onboarding-workflow.md` (the explicit life-of-an-onboarding, per-step
status + the hard-won Cloudflare OAuth recipe) and `docs/onboarding-broker-design.md`
(the why/decisions). This file is just the todo/next-steps skim.

Status legend: ☑ done · ◐ in progress · ☐ todo

---

## ◐ MCP SERVER — zero-friction OAuth (built 2026-07-11, NOT committed)

**Read first:** `docs/mcp-server.md` (architecture, flow, setup, security). Goal: ChatGPT /
Codex / Claude connect to a live Lanza site's `/api/mcp` and edit content — paste the site
URL, approve once in the browser via GitHub, no keys/PATs.

**Design (locked, research-backed):** the MCP endpoint is an **OAuth 2.1 resource server**
(ChatGPT accepts OAuth only — no header/key auth, so it's the universal path). The **broker
= authorization server**, GitHub (`lanza-cms` App) = identity. Access token is a
broker-signed RS256 JWT `{login, aud: mcp-url}` — the SAME format tenants already verify
(`functions/_lib/session.ts`) and `/api/token` already accepts to mint the repo-scoped write
token. So both reuse existing crypto/mint unchanged.

**Built + verified locally (typecheck clean; main tests 20/20, broker 10/10; live wrangler
smoke both sides):**
- **Broker AS** (`lanza-broker`): `functions/.well-known/oauth-authorization-server.ts`
  (RFC 8414) · `functions/api/oauth/{authorize,github-callback,token,register}.ts` ·
  `functions/_lib/oauth-util.ts` (PKCE S256, tokens, CORS, RFC 8707 resource) ·
  `functions/_lib/oauth-store.ts` (KV: auth codes, refresh, DCR clients, CIMD resolve) ·
  tests `_lib/oauth-util.test.mjs` + `api/oauth/oauth-flow.test.mjs` · `_lib/ts-resolve.mjs`
  (test loader) · new `.gitignore`.
- **Tenant RS** (main repo): `functions/api/mcp.ts` (reworked → OAuth token validate
  [sig+aud+owner] + broker-minted GitHub token; `MCP_TOKEN`/standing PAT removed) ·
  `functions/.well-known/oauth-protected-resource.ts` (RFC 9728) · v1 content layer already
  in place: `functions/_lib/{mcp-core,lanza-content,frontmatter}.ts` + `mcp-core.test.mjs` +
  `ts-resolve.mjs`. `functions/_lib/gh-proxy.ts` exports `BRANCH`/`WORKING_BRANCH`.
  `package.json` adds `js-yaml`/`@types/js-yaml` + a `test` script.

### ☐ NEXT SESSION — MCP Phase 3 (go live)

1. **☐ Commit both repos** (separate commits — main + `lanza-broker`). Currently all
   uncommitted. NOTE the working trees also carry the **earlier scope-trim** (broker
   `functions/api/auth/cf/login.ts` trimmed 8→4 CF scopes; main `docs/onboarding-*.md`
   reconciled) — that's a *separate* pre-existing change Dave deprioritized; commit or
   set aside deliberately, don't lump it in.
2. **☐ Dave prereqs (only Dave can do):**
   - Create KV namespace on broker: `wrangler kv namespace create OAUTH_KV`, then bind it
     as **`OAUTH_KV`** on the broker Pages project (dashboard). The AS stores auth codes /
     refresh tokens / DCR clients there — it 500s/391s without it.
   - Register callback **`https://connect.lanzacms.com/api/oauth/github-callback`** on the
     `lanza-cms` GitHub App (add to its callback URL list — separate from the existing
     `/api/auth/callback`).
3. **☐ Deploy** broker + tenant.
4. **☐ Live-verify the real handshake** — connect **Claude custom connector** (easiest) to
   `https://lanzacms.com/api/mcp` → it 401s → discovers → GitHub approve → `tools/list` →
   `create_content` → `publish`. This exercises the one thing untestable locally: the real
   GitHub round-trip + broker `/api/token` mint. Then repeat for ChatGPT (developer mode)
   and Codex (`config.toml` + `codex mcp login`).

**Gotchas to carry:** `WWW-Authenticate` MUST be on the 401 (Claude ignores it on 200) ✓done.
PRM `resource` must match the connect URL byte-for-byte (audience binding) ✓. CIMD is
primary (no client store), DCR is the fallback path (KV-backed) — both implemented. If a
client can't register, check the AS metadata advertises `code_challenge_methods_supported:
["S256"]` + `client_id_metadata_document_supported: true` + `token_endpoint_auth_methods_
supported: ["none"]`.

### ☐ MCP follow-ups (post-go-live)
- ☐ Media/image upload tool (deferred from v1 — content tools only so far).
- ☐ Confirm CIMD vs DCR behavior per client during live test; drop whichever is unused.
- ☐ Self-host story: without a broker, `/api/mcp` falls back to a `GITHUB_TOKEN` secret but
  has no OAuth AS — document or provide an authless/bearer mode for pure self-hosters.

---

## ☑ Shipped this session

The **Phase-5 onboarding wizard** on **connect.lanzacms.com** (broker repo `lanza-broker`,
pushed `f8838d1`) + supporting doc/marketing work on `main` (pushed `f6f87a4`).

- **Wizard UI** — `lanza-broker/index.html`: 6 animated steps (name→instant preview →
  Connect GitHub → Connect Cloudflare → the one GitHub↔CF authorize click → headless
  create+deploy → **health screen** → /admin). Freehold skin, self-hosted Jost/JetBrains
  Mono, `prefers-reduced-motion` throughout, persistent **"Developer? Skip the wizard"**
  self-host panel.
- **Real endpoints** (lifted out of the throwaway smoke-test proof) — `api/onboard/status.ts`
  + `api/onboard/deploy.ts` (idempotent create-git-Pages-project + trigger-deploy; doubles
  as the git-authorize detector via `8000010/8000011`; refreshes the CF token; polls build
  status). Both OAuth callbacks repurposed to set HttpOnly cookies + redirect back into the
  wizard. `tsc` clean. State rides broker cookies — broker stays stateless.
- **`BROKER_ORIGIN`** → `https://connect.lanzacms.com` (`functions/_lib/tenant-config.ts`).
- **CMS help doc** `09-onboarding-and-hosting.md` — wizard flow flipped Planned→Live, new
  Health-screen + dev-self-host sections. (Health screen exists two ways: the wizard finale
  **and** the standing **Settings → Site Health** page — `admin/src/ui/SiteHealthView.vue`.)
- **Marketing site** — `/start`, `home.md` (en+es), `/how-it-works` rewritten to the real
  wizard flow; CTAs fixed → connect.lanzacms.com. `astro check` clean.
- **Git hygiene** — both repos pushed; 5 merged branches pruned (local + 2 remotes); staging
  hard-FF'd byte-equal to main. Only `main` + `staging` remain.

---

## ☐ NEXT SESSION — to actually go live (priority order)

1. **☑ Dave's go-live prereqs — ALL VERIFIED LIVE 2026-07-05:**
   - ☑ CF OAuth client has `https://connect.lanzacms.com/api/auth/cf/callback` — CF issues a
     login_challenge (not a redirect_uri rejection) for the broker's authorize.
   - ☑ `lanza-cms` GitHub App Callback URL list includes
     `https://connect.lanzacms.com/api/auth/callback` (Dave confirmed in the App settings).
   - ☑ Broker fronts connect.lanzacms.com: current wizard (`f8838d1`) served byte-equal,
     `cf/login`→302 authorize (CF id/secret set), `onboard/status`→200, `auth/callback` alive.
   - ☐ **NEW (from item 2 build):** set the `lanza-cms` App **Setup URL** to
     `https://connect.lanzacms.com/api/onboard/setup` (github.com/settings/apps/lanza-cms →
     Post installation). It's the *only* hook GitHub gives to return the user to the wizard
     after they install the App — memory says it's still the old `lanzacms.com/...` domain.

2. **◐ Install the `lanza-cms` App on the new repo during onboarding — BUILT 2026-07-05,
   pending deploy + live verify** (design §4 step 3). The onboard OAuth callback now creates
   the repo, then 302s to a pre-selected install screen
   (`github.com/apps/lanza-cms/installations/new/permissions?suggested_target_id=<user>&repository_ids[]=<repo>`);
   GitHub returns to `/api/onboard/setup`, which verifies the App now covers the repo
   (retry ×3 for read-replica lag) and resumes the wizard at Cloudflare. Files: broker
   `_lib/oauth.ts` (getUser +id), `_lib/gh-app.ts` (generate +id),
   `api/onboard/oauth/callback.ts` (install redirect), `api/onboard/setup.ts` (rewritten
   Setup-URL landing), `index.html` (install_incomplete/not_configured copy). `tsc` clean.
   **Not committed/pushed yet.** Needs the Setup-URL prereq above + a live install round-trip
   to confirm (can't be exercised headlessly — that's item 3).

3. **☐ Live end-to-end verification** — no real OAuth round-trip has been run yet. Drive the
   whole chain in a browser once (1)+(2) are in: land on wizard → create repo → connect CF →
   authorize → watch it deploy → health screen → log into /admin → **save an edit** → publish.

4. **☐ Option B — runtime CF proxy + per-tenant token store** (decided, not built). Wire the
   tenant `functions/admin/api/cf/[[path]].ts` proxy to source the CF token **through the
   broker** (dual-mode: own `CLOUDFLARE_API_TOKEN` used directly, else broker — invariant #1),
   and decide the broker's persistent `{access, refresh, expires_at}` store (KV? DO?). This is
   what wires the CF token into the *running* CMS for KV/D1/R2 provisioning. (The wizard itself
   uses cookies; this is the separate runtime concern.)

---

## ☐ Cleanup owed (from this + prior sessions)

- ☐ Delete test repo `dsottimano/lanza-deploytest-11556` + the two `lanza-deploytest-*` Pages
  projects (leftover from proving the deploy chain).
- ☐ **Burn/rotate secrets pasted or screenshotted earlier:** the exploratory CF API token, the
  broker `OAUTH_CLIENT_SECRET` / App client secret, and the old tenant `GITHUB_TOKEN` (now
  unused on prod). Broker private keys are already Secret type.
- ☐ Drop test post `content/posts/es/test.md` via the CMS if unwanted (it publishes).

---

## ☐ Backlog / deferred (genuinely open, not blocking)

- ☐ **Wizard: GitHub-account gate before step 1** (Dave, live-test 2026-07-05) — non-technical
  users may not have a GitHub account, and "Connect GitHub" with none is a dead end. Before the
  Connect button, ask "Do you have a GitHub account?" → No opens `github.com/signup` (new tab)
  with "create one, then come back and click Connect GitHub"; Yes proceeds. Frame GitHub as
  "the free account that stores your site's content." `lanza-broker/index.html` step "github".
- ☐ **Wizard: gamified progress — plane + skydiver** (Dave, live-test 2026-07-05) — replace the
  "Step N of 5" text (top-right) with an SVG scene matching the page's hand-drawn blue-arrow
  aesthetic: a plane climbing along the ascending path across steps 1–4, and on **step 5 a
  skydiver jumps out** (the go-live/deploy metaphor — step 5 is deploy→land-in-/admin). Inline
  SVG + CSS, honor `prefers-reduced-motion` (wizard already does).
- ☐ **`@lanza/site` extraction P4/P5** — deferred to post-v1 (v1 ships a fat template repo,
  design §11.4). P4: thin content-only tenant repo + publish `@lanza/site` + wire `functions/`
  to deploy from the tenant root; docs still say frontend/content. P5: update UX (stable
  pointer + safe-revert + "update available" banner). Branch `feat/lanza-site-extraction-p1`
  was pruned — recover from `docs/lanza-site-extraction-plan.md` + git history.
- ☐ **Variables page in Settings** (Dave, 2026-07-05) — define site-wide `{{ placeholders }}`
  usable in templates + the header/footer builder (the clean fix for wanting a computed
  year/date instead of a raw `<script>`, which the engine emits verbatim + the preview
  sandbox blocks). Feeds `partData` / `template-render`.
- ☐ **Taxonomy-rename referential integrity** — renaming a category/tag/author slug does NOT
  rewrite posts referencing it. Real footgun; needs a reference sweep on rename (or a guard).
- ☐ **Slug-collision UX** — renaming onto an existing slug fails with a raw GitHub 422; wants a
  pre-flight "slug already in use" check.
- ☐ **Preview brand accuracy** — the CMS live-preview uses `site.css` defaults, not the live
  Brand overrides from `appearance.json`; inject the appearance token block for exact colours.
- ☐ **CMS in-place visual editing (Phase 2)** — click a rendered region → edit → write back to
  its `{{slot}}`; needs a DOM→template source-map (`data-lz-path`). Deferred by Dave.
- ☐ **Admin dark mode** — mixes CSS vars with hardcoded `text-zinc-*`/`bg-white` across ~36
  files; needs a `dark:`-variant / var-ification sweep before a dark `@media` block is safe.
