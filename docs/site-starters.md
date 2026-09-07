# Site starters

Settings → Brand & themes → Site starters offers complete, additive starting points.
Portfolio provides project collections, case studies, galleries and an introduction
page. Real estate provides property listings, prices, availability, property facts,
galleries and an agency introduction. Each supports Editorial, Gallery and Nocturne
styles. The picker renders the actual introduction template before installation.

Choose an enabled language and whether to include example entries, then **Review
installation**. The review lists the files and public paths. **Install to staging**
commits the complete plan against the reviewed repository head. Concurrent edits
cause a conflict; prepare a new review. Installation does not publish.

An existing homepage is preserved: the introduction goes at `/portfolio/` or
`/real-estate/`, with the selected language prefix where appropriate. Otherwise the
starter creates that language's homepage. Existing collection names, template files,
page paths, style IDs and conflicting redirects cause installation to refuse.
Navigation links are appended in the selected language; device inheritance survives.

Open Projects or Properties in the CMS to replace examples. Edit the introduction
through Pages. Upload your images, describe them, and supply email/contact-page
links. Example content and introductory copy are English even when another language
is selected. Included examples are marked Ready so they appear in staging; replace
or mark them Draft before publishing. Clear the visible starter notes when ready.
Agents own template structure and collection/list configuration; humans edit entry
text, images and facts using the existing writing surface.

The selected style is scoped to the starter templates, preserving the site's global
brand and header/footer. It is not a whole-site rebrand. The three variants are also
added to `data/styles.json`. To change an installed starter's scoped style, an agent
can update its template token overrides; the picker does not reinstall over edits.
Theme export/import now includes `templates/` and `data/styles.json`; content and
uploaded media remain separate export options.

No form processor, booking system, payment integration, MLS/IDX feed, map service or
property search/filter UI is installed. These are explicit extensions, not implied
by the starter's appearance. Custom collection slugs still use filename identity;
the existing localized URL-move/301 UI applies to Pages and Posts.

## Local and agent use

The catalog is `recipes/catalog.mjs`; `functions/_lib/site-starters.mjs` is the pure
planner used by both the CMS and CLI. Add a starter by declaring its templates,
fields, route, sample content and looks in the catalog, then run the planner tests
and build a throwaway tenant. New files must never replace existing work.

From a checkout (Node 22 with TypeScript stripping support):

```sh
node scripts/apply-starter.mjs portfolio --into /path/to/site --dry-run
node scripts/apply-starter.mjs portfolio --into /path/to/site --look gallery
node scripts/apply-starter.mjs real-estate --into /path/to/site --locale es --no-samples
```

The CLI applies locally, not to GitHub. It validates the complete plan before writes;
filesystem writes are not a transaction, so review the diff before committing.
Build and run `check:site` in the target checkout before handing it over. The MCP
server does not yet offer a starter-install tool; agents with only MCP access should
use the existing template/content-type tools or direct the owner to the CMS picker.

For whole-theme replacement, bundle format, trust and export options, see
[the theme guide](../themes/README.md). MCP exposes these distinctions in
`describe_site_system.themes`; this guidance does not add installation permissions.
