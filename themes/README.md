# Themes and site starters

Open **Settings → Brand & themes** in `/admin`. Choose the surface that matches
what you want to change:

| Surface | Purpose | What it changes |
|---|---|---|
| Brand | Colours, fonts, corners and motion | Shared brand settings |
| Site starters | Portfolio, Real estate, Writer or Events with editable pages and collections | Adds templates, a collection, introduction, navigation and style options |
| Plugins | Optional first-party reading progress and image zoom | Saves enable/disable choices to staging |
| Themes | Import/export a `.tar.gz` design bundle | Creates or overwrites the files listed in the bundle |

## Site starters

Choose Portfolio, Real estate, Writer or Events, then Editorial, Gallery, Nocturne,
Folio or Cobalt. Compare introduction, listing and detail pages at desktop or mobile
widths. Choose an
enabled language and whether to include examples. **Review installation** shows
files and public paths; **Install to staging** applies that reviewed snapshot in
one commit. If the repository changes, prepare a new review.

An existing homepage is preserved. Existing conflicting collections, templates,
URLs and redirects cause installation to refuse. Copy is English, including when
another language is selected. Replace or translate example copy, images and contact
links before publishing; included examples are Ready, not hidden drafts.

The style applies to the starter's templates. It does not rebrand the whole site.
Forms, bookings, payments, MLS/IDX feeds, maps and property search are not installed.
See [the starter guide](../docs/site-starters.md) for editing and local CLI usage.

## Import, review and publish

In **Themes**, choose a bundle, inspect its metadata and affected files, then apply
it to staging. Existing files at those paths are overwritten; other files remain.
A theme can contain executable build code: only apply bundles whose author and
source you trust. Path confinement does not sandbox theme code.

Check the staging build, public preview and CMS fields. Review **all** pending
changes before Publish merges staging to the live branch. Applying a bundle does
not itself publish, and a commit is not proof that deployment succeeded.

Theme history can prepare a revert commit on staging. Review conflicts first:
reverting can overwrite later edits to the same files. Preview and Publish the
revert when appropriate.

## Export and file set

Export packages the working branch's design. Content and uploaded media are
separate opt-in additions, so the base theme is not a complete site backup.

Design includes `frontend/{pages,components,layouts,lib,styles,presets}/`,
`templates/`, `frontend/content.config.ts`, `admin/src/schema.ts`,
`data/schema.json`, `data/appearance.json`, `data/styles.json`, `data/site.json`,
and top-level `data/seo.<locale>.json` and `data/menu.<locale>.json` files.
Optional additions are `content/` and `public/images/uploads/`.

Import rejects paths outside this file set, traversal and ambiguous paths.
It cannot directly replace `package.json`, `astro.config.mjs`, `lanza.config.json`,
`functions/`, `.github/`, or redirect configuration. Design code can still execute
during a build. Site defaults and schemas in a bundle can change existing content's
behaviour; inspect them carefully when moving a theme between sites.

## Bundle format

A gzipped tar archive with these entries at the archive root:

```text
theme.json
files/frontend/styles/site.css
files/templates/example/template.html
files/templates/example/fields.json
files/data/styles.json
```

`files/` is stripped before committing; binary assets are supported. Use regular
files with unique paths. The importer limits compressed uploads to 20 MiB,
uncompressed archives to 64 MiB and regular-file entries to 5,000.

```json
{
  "name": "ocean",
  "title": "Ocean",
  "version": "1.0.0",
  "author": "Lanza",
  "description": "Cool blues and a teal accent.",
  "rebuildNote": "Review the staging build before publishing."
}
```

`name` and `title` must be non-empty strings. Other displayed fields are optional
strings. Package a staging directory with:

```sh
tar --format=ustar -czf my-theme.tar.gz -C <staging-dir> theme.json files
```

The included Ocean bundle is a skin changing `data/appearance.json` and
`frontend/styles/site.css`. Bundled archives are examples, not automatically
regenerated snapshots of the current site.

## Agents and MCP

Call `get_site` and `describe_site_system`; the contract's `themes` section explains
these surfaces and their boundaries. MCP can change brand settings, templates,
parts and content types through its advertised tools. It has no theme-bundle
import/export or starter-install tool. Use the CMS picker, or the local starter CLI
with repository access. Never claim an installation or publication that did not run.

## Reversible design and plugin choices

Brand controls preview edits locally. Cancel restores the last loaded or applied
brand, including fonts, colors, corners, motion and scheme. Apply to staging saves
the choice; publication is still separate. Starter installation review also has a
Cancel action that writes nothing. This does not add layout switching for installed
starter templates.

See [Site plugins](../docs/site-plugins.md) for the first-party catalog and its limits.
