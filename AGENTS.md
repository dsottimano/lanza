# Repository instructions

Read `CLAUDE.md` and `docs/site-system.md` before changing this project. Preserve
existing local work. Read `docs/review-surface.md` before changing CMS previews.

## Mandatory schema contract

- `data/schema.json` is the content model. `admin/src/schema.ts` loads it; it is
  not a separate schema to edit. Generated content config and collection routes
  must never be hand-edited.
- Every public content page, including this product's marketing pages, must be
  editable through a declared CMS collection. Use `content/pages/<locale>/<id>.md`
  for one-off pages. Use `collection.route` for custom content types.
- Designed pages use `preset` plus `slots`. Declare the editable fields once in
  `templates/<preset>/fields.json`; store words, images and links in the entry.
  Keep presentation in the template. Never put page copy in Astro or TypeScript
  constants, invent fixed marketing routes, or hide a CMS entry behind a route.
- Do not add the retired top-level page `blocks` field or use the legacy block
  renderer for new work. Reuse section markup and field declarations inside a
  page preset; the result still has one `fields.json` and one set of entry slots.
  Saved snippets are rich-text insertion shortcuts, not page layouts.
- Keep translation filenames linked, respect `data/site.json` URL mappings, and
  preserve draft visibility. A draft or moved page must not reveal fallback copy.
- System routes (404, taxonomy archives, discovery endpoints, style preview, and
  the generic empty-site/blog fallback) are infrastructure, not a way to add
  public editorial pages. Change their scope only with a documented reason.
- Before handoff run `npm run check:site`, relevant regression tests, and
  `node bin/lanza.mjs build`. An error is a blocker, not optional advice. Report
  remaining warnings and unverified browser/deployment work honestly.
- For each new page, verify its CMS entry, declared fields, public route and
  locale; change an editable value and confirm the renderer uses it. Include its
  CMS location in the handoff. Do not claim deployment from a successful build.
