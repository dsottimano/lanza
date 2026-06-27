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
- [x] **Phase 3 — Structured fields + other collections.** Typed schema module
      (`cms/src/schema.ts`) replaces `config.yml`. Schema-driven, recursive field
      renderer (`cms/src/fields/`). Posts/pages get a Ghost-style **settings
      drawer** (pubDate / featuredImage / categories / tags / author / full SEO,
      plus page blocks). Form-only editors for categories/tags/authors. JSON
      editors for `seo.json` / `menu.json` / `redirects.json`. Collection rail in
      the sidebar. **Build + typecheck pass; needs live commit round-trip check**
      (esp. relation pickers, page blocks, and the 3 settings files).
- [x] **Phase 4 — Media.** Image upload → commit to `public/images/uploads` →
      store the `/images/uploads/…` public path. Covers every `image` field
      (featured/avatar/OG/block/gallery/logo) via `fields/ImageInput.vue` and the
      editor's **Figure card** (`nodeviews/FigureView.vue`); both share
      `backend/media.ts` (`uploadImage`). Paste-a-URL kept as a fallback for
      external images. **Build passes; needs live upload verify.**
      **Deviation from the original plan:** each image is its own commit (simple
      Contents API `uploadBinary`), *not* an atomic post+image commit via the Git
      Data API — far less code; only cost is a possible orphaned image if a draft
      is abandoned. Upgrade to atomic later if desired.
- [ ] **Phase 5 — Render switch + cutover.** Flip the 2 Astro detail templates
      (`src/pages/posts/[...slug].astro`, `src/pages/[...slug].astro`) to
      `set:html` from `entry.body`; **sanitize on render** (rehype-sanitize /
      DOMPurify — see Security posture); add public-site CSS/JS for the cards; point
      the build at `public/admin/`; delete `sveltia-cms.js` + `config.yml`; update
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

## Security posture

Threat model: solo, technical author; the *only* writers are (a) the
authenticated author via Studio and (b) the Telegram bot, which commits whatever
an allowlisted user sends (raw HTML included) as a **draft** (hidden until a human
publishes).

- **Fixed — iframe/img src validation** (`cms/src/editor/url.ts`). A crafted draft
  with `<div data-embed data-src="javascript:…">` would, when opened in Studio,
  run an iframe in the admin origin and steal the GitHub token from localStorage.
  Embed/Figure now allow only `http(s)` (+ local paths for images) at both the
  in-editor preview and the committed `renderHTML`. Verified against
  `javascript:`/`data:`/`vbscript:` inputs.
- **By design — author HTML on the author's own public site.** A CMS exists to let
  the owner put HTML on their site; the author is trusted on their own property.
  Editor output is also safe-by-construction: TipTap `setContent` parses to its
  schema, dropping `<script>`/`onerror`/unknown tags on load.
- **Accepted — GitHub PAT in localStorage.** Standard for a no-backend git CMS
  (Sveltia/Decap do the same); the token is repo-scoped Contents only. Mitigated by
  the two points above (no XSS sink left to read it). The alternative (OAuth +
  Worker + httpOnly cookie) is explicitly out of scope for v1.
- **TODO (Phase 5) — sanitize on the public render.** When the bot commits raw
  HTML in a draft and an editor publishes it *without* opening it in Studio (which
  would sanitize it), that HTML reaches the public site. Human-review + draft-gated,
  but add `rehype-sanitize` / DOMPurify at the `set:html` switch for defense-in-depth.

## Key files

- `cms/src/schema.ts` — the content model (collections + fields). **Single source
  of truth; replaces `config.yml`.** Folder collections (posts/pages/taxonomies/
  authors) + the `files` collection (settings JSON). Edit here to add fields.
- `cms/src/editor/` — TipTap editor, card nodes (`extensions/`), node-views
  (`nodeviews/`), slash menu.
- `cms/src/fields/` — schema-driven form: `FieldForm.vue` (root, provides client),
  `FieldInput.vue` (recursive, one field), `ListInput.vue` (array/blocks/scalar
  lists), `RelationInput.vue` (slug picker), `ImageInput.vue` (upload + URL),
  `context.ts` (client inject key).
- `cms/src/backend/` — `github.ts` (generic Contents API: `listDir`/`loadEntry`/
  `saveEntry` for markdown, `loadJson`/`saveJson` for settings, `deleteFile`),
  `frontmatter.ts` (js-yaml), `markdown.ts` (md→html via marked), `media.ts`
  (`uploadImage` → commit under `MEDIA.dir`), `auth.ts`, `config.ts` (repo +
  `MEDIA` coords).
- `cms/src/ui/` — `LoginView`, `Sidebar` (collection rail), `CollectionList`
  (generic list), `EditorView` (rich body + settings drawer, posts/pages),
  `RecordEditor` (form-only, taxonomies/authors), `SettingsView` (JSON files).
  `App.vue` is the shell/router.

## Pinned versions (no `^`)

Vue 3.5.39 · Vite 8.1.0 · TypeScript 6.0.3 · TipTap 3.27.1 · js-yaml 5.2.0 ·
marked 18.0.5 · Tailwind CSS 4.3.1 (+ @tailwindcss/vite). Lockfile committed.

## Styling

The chrome/UI is **Tailwind v4** (CSS-first: `@tailwindcss/vite` plugin +
`@import "tailwindcss"` in `src/styles.css`, design tokens in an `@theme` block —
serif headings, sans chrome, zinc palette, emerald=saved / rose=error). No
`tailwind.config.js` (v4 auto-detects sources). The **writing canvas**
(`src/editor/`) keeps its own scoped CSS — it predates Tailwind and was already
dialled in; note Tailwind's preflight strips list markers / inline-code styling,
so those are re-asserted in `Editor.vue`'s prose block.
