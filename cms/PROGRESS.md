# Studio CMS — build progress & handoff

A self-owned, Ghost-style CMS replacing Sveltia. Vue 3 + Vite + TS + TipTap,
builds to `public/studio/` (dev) → `public/admin/` (cutover). Commits HTML-bodied
markdown files to this repo via the GitHub API. Full plan + rationale:
`~/.claude/plans/proud-toasting-moore.md`.

## Phase status

- [x] **Phase 0 — Scaffold.** `cms/` app, pinned deps, builds to `public/studio/`.
- [x] **Phase 1 — Editor (the writing feel).** Full-screen serif canvas, bubble
      toolbar, `/` slash menu, cards (callout / image-with-caption / embed),
      HTML round-trip. **Gate passed** ("looks amazing").
- [x] **Phase 2 — GitHub backend.** Token sign-in, list/load/edit/**commit** posts
      via Contents API, frontmatter preserved, markdown→HTML on load.
      **Verified live**: edit committed to origin as `f5cce18`.
- [ ] **Phase 3 — Structured fields + other collections.** ← NEXT
      Ghost-style settings drawer (pubDate / featuredImage / categories / tags /
      author / full SEO) + editors for pages (incl. blocks), categories, tags,
      authors, and the settings files (`seo.json`, `menu.json`, `redirects.json`).
      Use a typed schema module in `cms/src/` (replaces `config.yml`).
- [ ] **Phase 4 — Media.** Image upload → commit to `public/images/uploads`
      (Git Data API for atomic post+image commit) → insert `/images/uploads/…` URL.
      Replaces the Phase-1 "paste a URL" placeholder in the Figure card.
- [ ] **Phase 5 — Render switch + cutover.** Flip the 2 Astro detail templates
      (`src/pages/posts/[...slug].astro`, `src/pages/[...slug].astro`) to
      `set:html` from `entry.body`; add public-site CSS/JS for the cards; point the
      build at `public/admin/`; delete `sveltia-cms.js` + `config.yml`; update
      `CLAUDE.md` + `README` ("markdown" → "HTML").

## How to run

- Dev server (Astro, serves both site and Studio): `npm run dev` from repo root.
  Studio is at **http://localhost:4323/studio/index.html** (the bare `/studio/`
  404s in dev — Astro doesn't serve directory indexes from `public/`; fine on Pages).
- Rebuild Studio after editing `cms/`: `cd cms && npm run build` (→ `public/studio/`).
- Typecheck: `cd cms && npm run typecheck`.

## Gotchas (learned the hard way)

- **Seeing real Astro dev crashes:** `astro dev` here is daemonized (RTK + Astro
  wrapper) and swallows child errors as "exited before becoming ready". To see the
  actual error, run it in-process:
  `node --input-type=module -e "import('astro').then(a=>a.dev({root:process.cwd()})).catch(e=>{console.error(e);process.exit(1)})"`
- **Private repo:** the GitHub fine-grained PAT must explicitly select
  `dsottimano/emdash-starter` with **Contents: Read & write**. A token that can't
  see the repo returns **404** (not 403). Login (`GET /user`) succeeds regardless,
  so a 404 on listing = token scope, not a bug.
- **Blank dates crash content build:** Sveltia writes `updatedDate: ''`, which
  violated the posts schema. Hardened in `src/content.config.ts` with `z.preprocess`
  (blank → undefined). Keep that guard.
- **Body format:** posts are `.md` with **HTML bodies** now. Astro still renders
  them via the markdown pipeline (raw HTML passes through) until the Phase 5
  `set:html` switch.

## Key files

- `cms/src/editor/` — TipTap editor, card nodes (`extensions/`), node-views
  (`nodeviews/`), slash menu.
- `cms/src/backend/` — `github.ts` (Contents API client), `frontmatter.ts`
  (js-yaml), `markdown.ts` (md→html via marked), `auth.ts`, `config.ts` (repo coords).
- `cms/src/ui/` — `LoginView`, `PostList`, `EditorView`. `App.vue` switches views.

## Pinned versions (no `^`)

Vue 3.5.39 · Vite 8.1.0 · TypeScript 6.0.3 · TipTap 3.27.1 · js-yaml 5.2.0 ·
marked 18.0.5. Lockfile committed.
