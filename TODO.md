# Lanza — handoff (session 8, 2026-07-05): the onboarding wizard is BUILT

**Read first:** `docs/onboarding-workflow.md` (the explicit life-of-an-onboarding, per-step
status + the hard-won Cloudflare OAuth recipe) and `docs/onboarding-broker-design.md`
(the why/decisions). This file is just the todo/next-steps skim.

Status legend: ☑ done · ◐ in progress · ☐ todo

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
