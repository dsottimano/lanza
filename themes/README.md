# Lanza themes

Prebuilt themes you can apply from the CMS: **/admin → Themes → upload a
`.tar.gz`**. Applying one commits the bundle to the repo in a single commit
(Git Data API) and triggers one Cloudflare Pages rebuild — the site updates in a
minute or two. Files at the bundle's paths are overwritten; everything else is
left alone. Revert with `git revert` if you don't like it.

## Bundle format

A gzipped tarball with this layout:

```
theme.json            ← manifest (metadata shown in the preview)
files/<repo-path>     ← every file the theme ships, at its real repo path
  files/frontend/styles/site.css
  files/frontend/data/appearance.json
  …
```

The applier strips the `files/` prefix and commits each entry verbatim, so a
path like `files/frontend/styles/site.css` lands at `frontend/styles/site.css`.
Binary assets (images, fonts) are fine — content is committed base64.

### `theme.json`

```json
{
  "name": "ocean",                    // machine id (required)
  "title": "Ocean",                   // display name (required)
  "version": "1.0.0",
  "author": "Lanza",
  "description": "One-line summary shown in the preview.",
  "rebuildNote": "Anything the editor should know before applying."
}
```

`name` and `title` are required; the rest are optional display fields.

## Packaging a theme

From a staging directory containing `theme.json` and `files/`:

```bash
tar czf my-theme.tar.gz -C <staging-dir> theme.json files
```

Pack `theme.json` and `files/` at the **archive root** (don't wrap them in an
extra top-level folder).

## Included themes

- **`lanza-theme-ocean.tar.gz`** — a skin (cool blues, teal accent). Demo theme
  that proves the upload → commit → rebuild flow. Changes only
  `frontend/data/appearance.json` and `frontend/styles/site.css`.
