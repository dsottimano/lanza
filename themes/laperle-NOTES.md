# La Perle theme — porting notes & the excluded lead Worker

`lanza-theme-laperle.tar.gz` is the click-apply bundle (CMS → Themes). It was
ported from the original overlay installer `themes/laperle-theme.tar.gz`
(a different-generation Lanza starter). This file records the judgment calls and
the one piece that a theme bundle **cannot** carry.

## Excluded: the lead-capture Worker (`extras/lead/`)

The original bundle ships an optional Cloudflare Worker (`extras/lead/`) that
emails quiz leads via Resend. A Lanza theme is a single git commit of static
files — it can't provision a Worker, secrets, or a route, and the theme applier
rejects `functions/` and `bot/` paths anyway. So the Worker is **not** in the
bundle.

The quiz still works without it: matching runs entirely client-side and the
"find your place" flow simply doesn't POST a lead. To enable lead capture, deploy
the Worker by hand from the original bundle:

1. Extract `themes/laperle-theme.tar.gz`; the Worker is `laperle-theme/extras/lead/`.
2. `cd` in, set the Resend secret (`wrangler secret put RESEND_API_KEY`), deploy.
3. Set `PUBLIC_LEAD_ENDPOINT` in the Pages build env to the Worker's URL and
   rebuild — the quiz reads it at build time (see `frontend/pages/encuentra.astro`).

Keep it fail-closed and off the account's shared Workers budget (project Rule 1).

## Port judgment calls (source overlay → this repo)

- **Locale model.** The original is bilingual UI-only: one Spanish content set,
  English served by physical `/en/*` pages. This repo's i18n is content-locale
  (subfolders + `[locale]` routes). Reconciled by shipping `site.json` as a
  **single `es` locale**, which makes the repo's `[locale]/*` routes emit nothing
  (no collision with the theme's `/en/*` pages) and renders ES at the root. English
  is the theme's own layer (`frontend/lib/locale.ts` `mirrorPath` + `/en/*` pages +
  `menu.en.json`/`seo.en.json`). `en` is intentionally **not** in `site.json`, so
  the English menu/SEO aren't CMS-editable — a known, documented limitation of this
  UI-only-bilingual template.
- **Layout is prop-based.** `Base.astro` takes `locale` as a prop (not
  `Astro.currentLocale`), so it needs no `en` entry in Astro's i18n config and stays
  a drop-in for the platform's shared page components (PostPage/PagePage/…), which
  keep working (post detail, standalone pages, taxonomy) rendered with La Perle chrome.
- **Data in repo shapes.** `menu.json`→`menu.es.json`/`menu.en.json` (locations ×
  device shape), `seo.json`→`seo.es.json`/`seo.en.json`, `appearance.json`→
  `{ "theme": "laperle" }`. The design activates purely through that data file
  (`<html data-theme="laperle">`) + the `[data-theme="laperle"]` block in
  `site.css` — **no CMS change**. By design the Appearance theme *select* in
  `admin/src/schema.ts` is left exactly as the repo ships it, so "laperle" is not
  offered as a re-selectable dropdown option; the theme is additive to the CMS
  only in the content-type sense below.
- **Schema — additive content types only.** Added `listings`, `regions`, `agents`
  as **flat** (non-localized) folder collections in `admin/src/schema.ts` and
  matching zod defs in `frontend/content.config.ts`, in this repo's own schema
  conventions, alongside the untouched core collections. No editor, settings, or
  other CMS behavior/config was carried over from the source starter's `lanza/`
  directory. `pubDate` on listings drives ordering.
- **Content layout.** Localized demo content lives under `content/posts/es/` and
  `content/pages/es/`; `listings`/`regions`/`agents` are flat. Post links resolve
  the stem via `splitId(id).slug` (posts are localized ⇒ `id = "es/<stem>"`).
- **astro.config.mjs — not shipped.** This repo's config already reads locales from
  `site.json`; with a single `es` locale it does the right thing. Shipping the
  overlay's `src/`-layout config would break `srcDir: ./frontend`.
- **Applies to a fresh/near-empty site.** It overwrites the home, layout and
  `site.css` and switches the site to Spanish; pre-existing English content stops
  rendering (excluded once `en` is no longer an enabled locale).

## Re-packing

`node scripts/pack-theme.mjs <src-dir> themes/lanza-theme-laperle.tar.gz`, where
`<src-dir>` holds `theme.json` + `files/**` (repo-relative paths). Node builtins
only; output is a ustar `.tar.gz` matching the reader in
`admin/src/backend/theme.ts`.
