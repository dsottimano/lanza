# Lanza — session 6 (2026-07-04): template-first editor + live preview + editable slugs

**State now — COMMITTED + PUSHED to `origin/main` (`857a7ac`).** vue-tsc clean ·
admin build clean · `astro check` 0 errors · vitest 12/12.

**☑ Shipped this session (the content-experience reorg Dave asked for):**
- **Templated pages no longer waste space on a body editor.** A page whose `preset`
  template doesn't render the body hides the writing canvas. Templates declare it:
  `"body": true|false` in `fields.json` (default false). The engine gained
  `{{{ raw }}}` and `PageArticle.astro` passes the sanitized body as a reserved
  `body` slot, so `{{{ body }}}` works when a template opts in. Doc updated
  (`docs/authoring-templates.md`, "The main body").
- **New templated-page layout:** full-width **title + editable URL** → 2-col
  **template fields | live preview** → 1-col **vital info (SEO/metadata)** below.
- **Live preview (`admin/src/ui/PreviewPane.vue`)** — imports (not mirrors)
  `frontend/lib/template-render.ts`, renders the template with the reactive `slots`
  in a scriptless sandboxed iframe with the site's design tokens. Debounced
  body-only innerHTML swaps (keep scroll); template/CSS change = full rebuild.
  Preview stretches to the template-fields height. **Read-only (Phase 1)** — Dave
  chose to defer in-place editing (DOM↔slot source-mapping) to a later phase.
- **Honest publish state:** "Published" toggle → **Draft ⟷ Ready**; **"N to publish"**
  pill (staging-vs-production compare, `admin/src/ui/staging.ts`), refreshed on save.
- **Editable slug/URL for ALL content types** (`SlugField.vue` + shared
  `useEntryEditor.save`): editing the slug renames the file (write new, delete old),
  always slugified, then navigates to the new slug. `home` is locked (site root).
  Wired in EditorView (posts/pages) + RecordEditor (categories/tags/authors).
- **Arrays read as arrays** — `list` fields get a labelled, accent-edged outer
  container + item count (`FieldInput.vue`).
- Adversarial code review run on the diff; fixes applied (slug sanitisation,
  rename state-on-failure, RecordEditor pending refresh, preview first-paint edit).

**☐ Open threads (deferred, low-risk — flagged in review):**
- **Taxonomy-rename referential integrity** — renaming a category/tag/author slug
  does NOT rewrite posts that reference it via relations. Real footgun; needs a
  reference sweep on rename (or a guard/warning). **Highest of the three.**
- **Slug-collision UX** — renaming onto an existing slug fails safe with a raw
  GitHub 422; wants a pre-flight check + "slug already in use" message.
- **Preview brand accuracy** — preview uses `site.css` defaults, not the live Brand
  overrides from `appearance.json` (Base.astro injects those at build). Layout is
  exact; brand-customised colours can differ. Inject the appearance token block.
- **Phase 2 — in-place visual editing** — click a rendered region → edit → write
  back to its `{{slot}}`. Needs a DOM→template source-map layer (annotate
  text-position interpolations with `data-lz-path`; skip attribute/style/`{{{raw}}}`
  positions). Explicitly deferred by Dave this session.
- **Dave live QA** — new template-first layout, live preview repaint, slug rename +
  URL nav, Draft⟷Ready + pending pill.

---

# Lanza — session 5 (2026-07-04): template authoring SHIPPED + English-default DRY i18n

**Read first: memories `lanza-html-template-authoring.md` (product vision) +
`dave-dry-no-magic-strings.md` (engineering bar).**

**State now — COMMITTED on `main` (19 ahead of origin/main, UNPUSHED — Dave's call)
and PUSHED to `origin/staging` (`bcb6098`):**
- **Template authoring pieces 1–3 shipped** (engine, CMS Template surface, agent doc) —
  see the session-4 block below.
- **English-default, DRY, config-driven i18n shipped this session.** `data/site.json`
  flip (`defaultLocale en`, `locales [en, es]`) now restructures ALL routing + hreflang +
  the language switcher — no per-locale files, no magic strings:
  - `lib/fixed-pages.ts` — ONE registry (slug + per-locale `PageSeo`) for the marketing/
    blog pages, rendered by `components/FixedPage.astro`, generated for every locale by the
    existing `[...slug]`/`[locale]/[...slug]` route pair (fixed slugs win over CMS pages).
    **Extensible descriptor**: `seo` is `PageSeo` (canonical/ogImage/noindex already
    covered); canonical/redirects/JSON-LD/metadata get added as fields **as testing
    surfaces them** (Dave). This is the single per-page cross-cutting-concern object.
  - Retired the hardcoded "es-default + /en/ mirror" layer: `lib/locale.ts` (mirrorPath),
    all `pages/en/*`, duplicated root marketing routes, orphaned `Manifesto.astro` (now CMS
    content in `content/pages/{en,es}/home.md`). `Base.astro` switcher iterates `LOCALES`
    off per-page alternates; `homeUrl = localeUrl(locale,"")`.
  - **3 bugs caught + fixed by the migration:** (1) `/es/home/` duplicate; (2) **hreflang
    was silently empty site-wide** — `Base` never forwarded `alternates` to `Seo`; (3)
    `templateClass()` emitted `tpl-*` but site.css only has `.layout-*` → CMS home rendered
    at ~40% width (fixed: map landing→layout-landing, full-width→layout-wide).
- Verified each phase: `astro check` 0 errors, build 12 pages; en at root, es at `/es/`,
  switcher + hreflang correct both directions.
- **Site chrome now templated too — "parts".** The header/footer moved out of hardcoded
  `Base.astro` markup into `templates/parts/{header,footer}.html` (WordPress "template
  parts"), rendered by `frontend/lib/parts.ts` via the same engine, injected around the
  page `<slot>`. The menu is `{{#each menuHeader/menuFooter}}` (data still from Settings →
  Menu) and the language switcher is an in-template `{{#each locales}}` loop — so switching
  is a placeable, editable element (move the block between header/footer). No `fields.json`
  for parts (their data is computed system data). Doc: `docs/authoring-templates.md`
  "Site parts".
- **CMS: Parts editor** — Settings → "Header & footer" (`admin/src/ui/PartsView.vue` +
  `backend/parts.ts`) edits `templates/parts/{header,footer}.html` via loadText/saveText.
- **CMS: real routes + locale-equivalent language switch (vue-router) + tests.** The admin
  was a routerless SPA; `setLocale` dumped you to the list. Added `vue-router` (hash) —
  `admin/src/router.ts`; App.vue derives panes from the route, nav = `router.push`, dirty
  guard = one global `beforeEach`. Language switch swaps the `:locale` segment →
  translation (same slug). CollectionList rows/"new" are real `<router-link>`s. Tests:
  `admin/src/router.test.ts` + `ui/CollectionList.test.ts` (vitest + @vue/test-utils +
  happy-dom, 7/7); `npm test`. vue-tsc + admin build clean. **Dave does live SPA QA** (see
  [[dave-workflow-preferences]] — he's the live-QA teammate; hand him a click-through list,
  don't caveat about not driving the browser).
- **Fix: header nav (menu + switcher) now shows on landing pages** — was gated by
  `{{#if showNav}}`; the whole marketing site is `landing`, so it only appeared on /posts.
  Gate dropped in `templates/parts/header.html`.
- **All the above committed on `main` (now ~28 ahead of origin/main, UNPUSHED) and pushed to
  `origin/staging` (latest `1130c6d`).** origin/staging accrues CMS edits (Dave saved
  en/home.md, menu) — each staging sync is `git merge main` (keeps those). Deploy wiring
  sanity-checked safe (functions/ at root, self-contained; build = `npm run build` → dist).

**Staging push (`bcb6098`) unblocks the CMS:** the local admin (new code) reading
`origin/staging` now sees `content/pages/{en,es}/home.md` + `templates/manifesto/` +
`data/schema.json` (preset/slots fields). **Dave to verify live:** admin Pages lists Home
(en+es); the Template picker + slot fields + Advanced-HTML editor work; front-end home is
full-width; `/es/` + switcher work.

**Still open:** push `main` to `origin/main` when Dave's ready (deploy); future
fixed-page descriptor fields (canonical / redirects / JSON-LD / metadata) driven by
testing; the TODO is uncommitted — commit alongside the next chunk.

---

# Lanza — session 4 handoff (2026-07-04): HTML-template authoring is the NEW thrust

**Read first: memory `lanza-html-template-authoring.md`** — the core product vision.

**State of the repo right now:**
- **Extraction P1–P4 is DONE and MERGED to `main` LOCALLY** (main is 12 ahead of
  origin, **NOT pushed** — Dave pushes after his own test/deploy). Broker changes are
  committed in the separate `lanza-broker/` repo (not pushed). Deploy caveats +
  remaining publish/template steps: see the "session 3" block below + `docs/lanza-site-extraction-plan.md`.
- **UNCOMMITTED on `main`** = a **superseded prototype** (do not push as-is): converted
  the home into an **Astro-component preset** — `frontend/presets/manifesto.astro` +
  `manifesto.slots.json`, `content/pages/es/home.md` (preset:manifesto + slot data),
  and rewired `frontend/pages/index.astro` + `[...slug].astro` (filters slug "home").
  It PROVED the content model + render pipeline work AND that `/` can be a CMS page —
  but the `.astro` format is the developer surface, WRONG for "the human edits the HTML".

**THE DIRECTION (decided this session):**
- Product loop: user finds a web design → agent reproduces it as HTML/CSS → **agent
  converts HTML/CSS → a Lanza template with `{{placeholder}}` fields + post types,
  registered in the CMS** → human just fills the fields (and can hand-edit the HTML).
- **Template format = HTML/CSS + `{{placeholders}}`** (NOT Astro components). Templates
  live in the **tenant repo** (`templates/`), agent-authored + human-editable, survive
  package updates.
- **Engine DECIDED = a minimal custom, dependency-free engine** (`{{var}}`,
  `{{#each}}`, `{{#if}}`; per Dave's stdlib-first rule). Syntax (Handlebars-ish):
  `{{ headline }}`, `{{#each cards}}…{{ who }}…{{/each}}`, `{{#if x}}…{{/if}}`.

**NEXT ACTIONS 1–4 — ☑ DONE 2026-07-04 (uncommitted on `main`):** the HTML-template
engine + tenant-templates wiring render `/` end-to-end. See memory
`lanza-html-template-authoring.md` for the full "piece 1 shipped" detail.
1. ☑ Engine `frontend/lib/template-render.ts` — `render(template, data)`; `{{var}}`
   (escaped) / `{{a.b}}` / `{{#each}}` / `{{#if}}` (empty array falsy) / `@index` /
   `@number` (1-based, zero-padded w2). Template author-trusted, values escaped.
2. ☑ `templates/manifesto/template.html` (Manifesto HTML/CSS + `{{placeholders}}`,
   `<style>` inlined) + `templates/manifesto/fields.json` (`.slots.json`, key
   `slots`→`fields`). At the **tenant repo ROOT** `templates/`. Data = `slots` in
   `content/pages/es/home.md`.
3. ☑ `frontend/components/HtmlTemplate.astro` — LEADING-SLASH glob
   `/templates/*/template.html?raw` (→ Vite/Astro ROOT = cwd = tenant repo, portable
   to installed tenants), runs the engine, `<Fragment set:html>`. Mounted by
   `PageArticle.astro` on any page with `preset`. (index.astro/[...slug].astro already
   route "home" through PagePage → PageArticle.)
4. ☑ Retired the whole `.astro` preset system: deleted `Preset.astro`,
   `presets/manifesto.{astro,slots.json}`, and the already-unused
   `presets/about.{astro,slots.json}`. Verified: astro check 0 errors, build 12 pages,
   `dist/index.html` 0 leftover mustaches, `@number`→01–05, each-loop hrefs correct.

**Pieces 2 & 3 — ☑ DONE 2026-07-04 (uncommitted on `main`):**
- Piece 2 — **CMS UI** (admin build clean: vue-tsc 0 errors + vite build):
  - `admin/src/backend/github.ts` — added `listSubdirs(dir)` (dirs only, 404→[]),
    `loadText`/`saveText` (raw text, no frontmatter) + `LoadedText`.
  - `admin/src/backend/templates.ts` (NEW) — `listTemplates(client)` reads
    `templates/*/fields.json` → `[{name,label,description,fields}]` (dir name = the
    `preset`). `templateHtmlPath(name)`.
  - `admin/src/ui/TemplateEditor.vue` (NEW) — the Template surface: picker → dynamic
    `FieldForm` driven by the chosen template's `fields.json`, bound to the page's
    `slots`; an "Advanced" `<details>` edits the shared `template.html` (own commit).
  - `admin/src/ui/EditorView.vue` — mounts TemplateEditor in the details rail (gated on
    the collection having a `preset` field); `preset`+`slots` filtered out of the
    generic field panel (they were falling to text boxes). `schema.ts` Widget union
    gained `preset`/`slots`.
  - Reads from the `staging` branch → the picker is EMPTY until `templates/manifesto/`
    is committed + pushed to GitHub staging (CMS reads GitHub, not local — expected).
- Piece 3 — **agent authoring guide**: `docs/authoring-templates.md` — the convention
  for converting web HTML/CSS → `template.html` + `fields.json` (+ where post types
  live). Authoritative engine-syntax reference + a minimal end-to-end example.
  Optional follow-up: link it from CLAUDE.md / llms.txt / the `/agents` page for agent
  discoverability.

**Still TODO:**
- Dave's live QA in the CMS: open a page in the admin, confirm the Template picker
  lists manifesto (after committing `templates/` to staging), the slot fields render +
  save, and the Advanced HTML editor loads/saves.
- Dave's live visual QA that `/` looks pixel-identical to the old `.astro` render (the
  `<style>` is now global, not Astro-scoped — same selectors, but eyeball it).

---

# Lanza — `@lanza/site` extraction is the active workstream (2026-07-04, session 3)

**DECIDED this session — the "rental" model + update control.** The photocopy problem
(`/generate` clones the whole repo → tenants never get our fixes) is solved by splitting
**content (thin tenant repo) from code (`@lanza/site` versioned npm package)**. Thread #2
(per-tenant identity) folds into it — identity is per-tenant content. Update posture:
**pinned + notify-only, never auto-apply** (reversed the old floating-`stable` auto-update).
De-risked the load-bearing seam: content `base` resolves against Astro `root`, not srcDir
(validated in astro@7.0.3 source). **Full decision-complete plan + phased build order:
`docs/lanza-site-extraction-plan.md`.**

**PROGRESS (branch `feat/lanza-site-extraction-p1`, not merged):**
- ☑ **P0 spike** — package/tenant split builds (proven).
- ☑ **P1** — content/ + data/ moved to repo root; ~25 refs repointed (3 commits).
- ☑ **P2** — `@lanza/site` package boundary: `lanza` CLI + config factory, public/ merge,
  packaging (files/engines/prepack/.npmignore/.nvmrc). Validated the clean way: `npm pack`
  → real tarball install into a fresh content-only tenant → `npm run build` → 12 pages,
  no symlinks. Adds ZERO new deps.
- ☑ **P3** — per-tenant identity un-hardcoded. `lanza.config.json` {owner,name}, SERVER-owned
  (SPA sends repo-relative paths, proxy prepends via `upstreamPath`; prebuilt SPA can't
  address another repo). Broker (separate repo) `putFile`s lanza.config.json + tenant-owner.ts
  at creation. Verified: gh-proxy 9/9, vue-tsc, astro check, full build, broker tsc.

**LEFT for a real stranger to self-serve (all beyond the painful core, now done):**
- ☐ **P4** — thin template repo + publish `@lanza/site`; **wire functions/ to deploy from
  the tenant repo root** (Pages compiles functions/ from root, not node_modules — copy in
  `lanza build`, or thin re-exports). + docs (README/CLAUDE.md still say frontend/content).
- ☐ **P5** — update UX (stable pointer + safe-revert flag + CMS "update available" banner).
- ☐ **Broker** — App-install-on-new-repo (design §4 step 3) so the broker can mint that
  repo's token; the current generate-via-App path needs the OAuth-creation redesign.
- ☐ Housekeeping (from session 2): rotate screenshotted secrets, delete feat/phase1-login,
  drop test post.

Everything below (session 2) is still current context.

---

# Lanza — onboarding architecture handoff (2026-07-04, session 2)

**The whole multi-tenant onboarding architecture is BUILT, PROVEN, and LIVE.** The
dogfood (`lanzacms.com`) now runs with **zero standing secrets** — login, save, and
publish all go through the broker. Full detail in the memory file
`lanza-cms-github-app.md`; design in `docs/onboarding-broker-design.md`.

### ☑ Shipped this session (all live)
- **Broker login** (`lanza-broker` repo → `lanza-broker.pages.dev`): one shared
  GitHub-App callback → RS256 handoff → broker-signed session, delivered by POST form
  (not URL). Tenant verifies with a committed public key. `lanzacms.com` cut over.
- **Repo creation**: OAuth `public_repo` (App `Ov23liyHlbHNLEBENmgH`) → `/generate`
  from the `dsottimano/lanza` template (public + template repo). No Administration.
- **Self-configuring tenant**: `functions/_lib/tenant-config.ts` (BROKER_ORIGIN +
  HANDOFF_PUBLIC_KEY, committed) + `tenant-owner.ts` (ADMIN_LOGIN, broker-written).
- **Edit-token**: broker `POST /api/token` mints repo-scoped installation tokens
  (Contents:write) verified by the session; tenant `gh-proxy` uses them instead of a
  PAT. Prod `GITHUB_TOKEN` removed and save+publish confirmed live.

### ☐ THREAD #2 — per-tenant identity (the ONLY thing left for real customers)
Every CMS instance currently edits `dsottimano/lanza` because the repo is HARDCODED.
Make it per-tenant:
1. **Repo identity in config.** `functions/_lib/gh-proxy.ts` (`OWNER`/`NAME`) and
   `admin/src/backend/config.ts` (`REPO`) are hardcoded to `dsottimano/lanza`. Move
   `owner`/`name` into a single committed file both read (branches stay staging/main);
   have the broker write it at creation like it does `tenant-owner.ts` (add a
   `setTenantRepo`-style call in `functions/api/onboard/oauth/callback.ts`). Watch: the
   admin SPA config is bundled at build, so each tenant's admin build must pick up its
   own repo.
2. **Install the App on the new repo during onboarding** (design §4 step 3, not built —
   dogfood was installed by hand). Add an App-install redirect after repo creation so
   the broker can mint that repo's token.

### Housekeeping / notes
- `feat/phase1-login` is merged to main — safe to delete.
- Test post `frontend/content/posts/es/test.md` is real content now on main — delete
  it via the CMS if unwanted (it'll show on lanzacms.com).
- **Secrets rotation still owed** (Dave deferred): broker `OAUTH_CLIENT_SECRET`/App
  client secret and the tenant `GITHUB_TOKEN` (now unused on prod) were pasted/screenshotted
  — rotate. Broker private keys are already Secret type.
- Verify scripts: `scratchpad/mint-test.ts`, `write-test.ts` (sign a session with the
  handoff key, hit the broker) — pattern for testing broker endpoints without a browser.

---

# Lanza — session handoff (2026-07-04)

## ☑ Admin Freehold reskin — SHIPPED (merged to main)
The CMS (`admin/`) now wears the default theme's identity: Ink `#201d1b` / Paper
`#f3f1ea` monochrome, one launch accent `#e4431b`, Jost + JetBrains Mono
(self-hosted at `admin/public/fonts/`, no CDN), sharp 2px corners, flat hairline
surfaces. The Apple liquid-glass system is fully gone — including a ~79-utility
`bg-white/*` glass sweep across 20 views + the first-run onboarding wizard.
`vue-tsc --noEmit` + `vite build` pass. Landed via branch
`feat/freehold-reskin-and-onboarding-design`.
- ☐ **Dave:** live visual QA — `cd admin && npm run dev`.
- ☐ **Deferred:** true admin dark mode — the admin mixes CSS vars with hardcoded
  `text-zinc-*`/`bg-white` across ~36 files, so a dark `@media` block would break
  contrast; needs a separate `dark:`-variant / var-ification sweep.

## ◐ Onboarding broker (Model B) — DESIGN DONE + APPROVED, NOT YET CODED
Canonical spec: **`docs/onboarding-broker-design.md`**; operator steps:
**`docs/onboarding-runbook.md`**. Managed onboarding, owners keep their own
GitHub + Cloudflare accounts. Decisions (all verified against live GitHub/CF docs):
- **Login:** one shared `lanza-cms` GitHub App → callback on the broker → an
  **asymmetric RS256 handoff** to the tenant (GitHub Apps cap at 10 callbacks, so
  per-tenant callbacks are impossible; tenants verify with a public key → can't
  forge for each other).
- **Sessions:** broker-signed, public-key verified → **zero per-tenant secrets**.
- **`ADMIN_LOGIN`** = owner login committed into the repo (public, not a secret);
  the tenant's own `ADMIN_LOGIN` check is the security gate → no origin allowlist.
- **Hosting:** **guided dashboard "connect repo" on Pages**. The Deploy-to-Cloudflare
  button is **DEFERRED** — it's Workers-only, so it would force a whole Pages→Workers
  migration to save ~one click.
- **`@lanza/site`** thin content-repo extraction is **in v1 scope** (Dave).

**BLOCKED on Dave (see runbook):** register the `lanza-cms` GitHub App + generate the
handoff keypair. Then Phase-1 code can be written/tested on a `*.pages.dev` preview.

### Build order (spec is decision-complete; each phase verifies on a preview)
☐ **P1** auth keystone (broker login + handoff + broker-signed session) ·
☐ **P2** repo creation (OAuth `public_repo`) · ☐ **P3** guided hosting (wizard copy
+ docs) · ☐ **P4** `@lanza/site` extraction · ☐ **P5** wizard UI on lanzacms.com.

---

# Lanza — Default theme redesign

Redesign the **default site theme** — the base look every un-branded Lanza site
ships with, and the face of the product/marketing site. Since the `data-theme`
preset concept was retired, "the theme" now means:

- `frontend/styles/site.css` — the `:root` token block (colors, fonts, radius,
  spacing) + the un-gated header/nav/footer chrome + prose/card/block rules.
- `frontend/components/Manifesto.astro` — the bilingual ES/EN manifesto home
  (hero, architecture diagram, CTAs). Pure CSS/type, no images/JS.
- `frontend/layouts/Base.astro` — header/footer shell, font `<link>`s.
- Shared primitives: `frontend/components/{PostCard,JournalIndex}.astro`,
  `frontend/pages/404.astro` (use `--gold`/`--rule`/`--text-secondary` aliases).

The CMS **Brand** editor overrides these tokens per-site (inline `<html style>`),
so whatever we set in `:root` is the *default*, not a hard-code — see
`frontend/lib/appearance.ts` / `admin/src/backend/brand.ts`.

**Status legend:** ☐ todo · ◐ in progress · ☑ done

---

## Brand inputs (the source of truth)

- Assets: `/home/dsottimano/source/lanza-brand/` (svg wordmark + `l↗` monogram,
  favicons, social). Wordmark = lowercase geometric sans + bold NE arrow.
- Brand colors: **Ink `#201D1B`**, **Paper `#F3F1EA`** (monochrome).
- Typeface: URW Gothic / Futura-like geometric sans (Jost is the free stand-in).
- Current base is still **Freehold** (deed-green + parchment + Fraunces/Space
  Grotesk) — decide how much of that survives vs. moving to the Ink/Paper wordmark
  identity.

---

## Direction — DECIDED: wordmark identity (Dave, 2026-07-03)

Move the default OFF Freehold's deed/parchment/green and onto the **literal
wordmark identity**: monochrome **Ink `#201D1B`** on **Paper `#F3F1EA`**, set in
**Jost** (Futura-like geometric sans). This is essentially today's "Lanza brand"
Brand preset promoted to the base `:root`. Consequence to design around: the
Manifesto + cards currently lean on `--deed-green` / `--brass` / brass-bright —
a monochrome scheme has to **rework or retire those** (the green architecture
diagram, the brass seals/kickers), not just recolor tokens.

## Scope expanded → three-audience product site (Dave, 2026-07-03)

Not just a token reskin. The site must sell Lanza to **normies, developers, AND
AI agents** at once. First-principles spine (see below): **"the life of an edit"**
— `you say what you want → agent commits → Pages builds → edge serves → Google &
agents find it`. Same mechanism, narrated at three altitudes. Ownership / no
lock-in is the through-line (normie "you keep every file" · dev "fork it,
self-host" · agent "open format, open repo").

The 10x: every site builder for 20 yrs optimized **the editor**. The agent deletes
the editor — so we build a **repo an agent can drive** and get out of the way. And
the marketing site is *itself* agent-operable (`llms.txt` + a "for agents" layer),
proving the loop on contact.

### Decisions (Dave, 2026-07-03)
- **Surface map:** four routes (all bilingual es/en) — see phases.
- **Accent:** ONE restrained accent on the Ink/Paper monochrome (links, buttons,
  the `l↗` arrow, key marks). Not pure-mono. Brand editor can still swap it.
- **Theme:** light **and** dark from the start (Paper-on-Ink invert).
- **Wordmark:** wire the real SVG wordmark + `l↗` monogram from `lanza-brand`
  into the header; `l↗` is the parallax motion motif (up-and-out to the open web).
- **Parallax:** scroll-scrubbed pipeline (IntersectionObserver/scroll, stays
  static/cacheable — no WebGL, no heavy assets).
- Base = the existing **"Lanza brand" preset** promoted to `:root`
  (Ink `#201d1b` / Paper `#f3f1ea` / Jost / sharp / motion on).

### Surface map
| Route | Lead | Job |
|---|---|---|
| `/` (+`/en/`) | all three | Hero + ownership spine + parallax teaser + cost/time + CTA |
| `/how-it-works` | dev/agent | Full scroll-scrubbed pipeline |
| `/start` | normie | 3 steps · real domain cost · time commitment · "you just ask" |
| `/agents` + `llms.txt` | agent | The repo contract, machine-legible |

## Build phases (verify `astro check` + checkpoint between each)

- ☑ **P1 — Foundation** (done 2026-07-03; astro check + build clean): rewrote `:root` in `site.css` → Ink/Paper +
  Jost + one accent + sharp rhythm + **light/dark**; rework `--deed-green`/`--brass`
  extras so PostCard/JournalIndex/404 still read; `Base.astro` → load **Jost**
  (drop Fraunces/Space Grotesk from always-on), wire the SVG wordmark header +
  copy the asset into `frontend/public`; update `LANZA_DEFAULTS` in
  `admin/src/backend/brand.ts` so "reset to defaults" = the wordmark look.
- ☑ **P2 — Home** rebuild (`Manifesto.astro`, done 2026-07-03): "life of an edit"
  spine + three audience doors + ownership/cost-time + close; monochrome + launch
  accent; deed/leasehold metaphor retired; es/en; astro check + build clean.
- ☑ **P3 — `/how-it-works`** (done 2026-07-03): `HowItWorks.astro` + es/en pages.
  Sticky trajectory diagram + scrolling stage panels; IntersectionObserver lights
  the active node + fills the line; degrades to a readable stacked list (no-JS /
  reduced-motion / <820px). Honest named stack. astro check + build clean.
- ☑ **P4 — `/start`** (done 2026-07-03): `Start.astro` + es/en pages. What-you-need
  · the four steps · plain-numbers cost ledger ($0 + ~$12/yr domain) · no-lock-in
  reassurance · CTA → lanzacms.com. astro check + build clean.
- ☑ **P5 — `/agents`** (done 2026-07-03): `Agents.astro` + es/en pages. Read layer
  (/llms.txt · window.lanza · JSON-LD) + edit layer (read schema.ts → write .md/.html
  → commit). Points to the existing `/llms.txt` (unchanged). astro check + build clean.
- ☑ Loaded the **frontend-design** skill; direction "Trajectory" (lanza = throw,
  the ↗ as scroll-drawn launch arc).
- ☑ Verify: `astro check` 0 errors/0 warnings (78 files); build 11 pages clean;
  all six new routes render, cross-links resolve, wordmark header on deep pages.
  STILL TODO (Dave): eyeball live — light/dark, the scroll-scrub on /how-it-works,
  mobile; and confirm with a real brand override applied.

---

## ✅ Redesign shipped 2026-07-03 — four-surface, three-audience product site
Home (spine + 3 doors) · /how-it-works (scroll-scrub parallax) · /start (normie
onboarding + costs) · /agents (agent contract). Wordmark identity: Ink/Paper +
Jost + JetBrains Mono + one launch accent (#e4431b), light+dark. All es/en.
Remaining polish is visual QA + any copy tuning after Dave reviews live.

---

_Prior Architecture B (multi-tenant) roadmap removed from this file 2026-07-03 —
recover from git history or `admin/src/help/09-onboarding-and-hosting.md`._
