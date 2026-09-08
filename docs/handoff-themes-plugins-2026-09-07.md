# Themes and first-party plugins

Implemented locally; no Git push, npm release or deployment was performed.
`origin/main` and `origin/staging` were fetched and inspected before edits; both
matched the clean checkout at `f24f7fd`. The checked-in hooks path was enabled.

## CMS locations

- Settings → Brand & themes → Site starters: Portfolio, Real estate, Writer and
  Events, each with Editorial, Gallery, Nocturne, Folio and Cobalt looks. Distinct
  layouts; actual introduction/listing/detail previews; desktop/mobile controls;
  cancelable installation review. Installs remain additive and conflict-aware.
- Settings → Brand & themes → Brand: Cancel restores the last loaded/applied
  brand. Apply to staging saves; controls lock during the save.
- Settings → Brand & themes → Plugins: optional reading progress and image zoom,
  disabled by default. Owner-only controls preserve the loaded SHA and unrelated
  settings. Cancel writes nothing; application and publication remain separate.

The two new starters use Pages for introductions, Essays and Events for entries.
With an existing homepage, their introductions are `/writer/` and `/gatherings/`;
their listings are `/essays/` and `/events/`. Without a homepage, the introduction
owns the locale root. Locale prefixes follow the site's configured default.
Fields come from each installed preset's `fields.json`; entries store editable
values. No new public routes or example content were installed in this product repo.

Existing installed designs are not automatically migrated or overwritten. Sample
copy is English even for a different selected language. The plugin catalog contains
two built-in browser features. The clarified product direction is plugins built by
an agent for the human; third-party installation and a marketplace are excluded,
not future work. A dedicated agent authoring workflow and switching layouts on
installed templates remain open. See `site-plugins.md` and `site-starters.md`.

## Verification

- Full Node and CMS regression suites passed, including all starter/look plans,
  EN/ES edit-to-render checks, homepage preservation, distinct overview/list URLs,
  Cancel/Apply, plugin role/concurrency checks and image-zoom body/gallery coverage.
- CMS typecheck/build, `npm run check:site` and `node bin/lanza.mjs build` passed.
  Site validation: zero errors and warnings. Astro check: zero errors/warnings,
  62 existing hints.
- Wrangler 3.114.17 Functions compilation passed for the repo and a separate
  tenant installed from the packed package.
- Chromium: 24 CMS template/width combinations; plugin settings at 390px;
  no overflow or JavaScript errors and no remote writes. Image zoom keyboard
  opening, Escape, focus restoration and reading progress were exercised.
- Packed tenant: all four starters installed together, 17 template directories
  validated, 36 pages built. Fourteen desktop/mobile public-route checks passed;
  an edited essay title rendered, and both plugins worked in the built site.

The public builds still report empty Posts/Categories/Tags/Authors collections.
An initial CMS build reported font URLs unresolved at build time; both font files
exist in `public/admin/fonts/`, and the final build did not repeat that warning.
No live installation/publishing flow or deployed site was tested. Local browser
artifacts and logs use `/tmp/lanza-themes-*`; the packed tenant is
`/tmp/lanza-themes-tenant-24qrJA`.
