# Lanza MCP server

## Next: private thoughts (not implemented)

The agreed v1 adds saving, finding and developing thoughts in the person's private
GitHub repository through their ChatGPT/Claude conversation. See
[Thoughts v1](thoughts-v1.md) for the proposed contract and privacy tests. Existing
content tools below are website tools, not a private-note API. Do not save private
notes as posts with `draft:true`. Voice-mode tool compatibility remains unverified.
The existing authentication and no-broker-token architecture still applies.

## Current endpoint

The tenant endpoint is `POST https://<your-site>/api/mcp`. It uses stateless MCP
Streamable HTTP; GET/SSE is unsupported. Connect through the CMS’s **Connect an agent**
screen using the owner’s GitHub user token. The server uses that same bearer for
GitHub operations and verifies repository permissions. There is no broker token mint,
RS256 grant or standing tenant credential. See [security-model.md](security-model.md)
and `functions/api/mcp.ts` for the authoritative security model. Earlier instructions
for a multi-site broker OAuth endpoint described the retired implementation.

Protocol and tools live in `functions/_lib/mcp-core.ts`. Repository operations live in
`functions/_lib/lanza-content.ts`. The endpoint ships with the site package.

## Build for the human editor

MCP initialize instructions direct agents to `get_site` and `describe_site_system`.
The latter now returns `humanEditing`, the shared guide implemented in
`functions/_lib/agent-authoring.mjs`. The same guide is served at `/site-system.json`.
Its recommendations are guidance, not new permission checks or claims that the
structural validator can judge design quality.

The guide explicitly assigns structure, templates, HTML, CSS and responsive design
to the agent. The human edits text, images and content details. Agents may draft from
chat or voice-note material when requested, preserving facts and identifying assumptions.

1. Read the current site, model, content, settings and staged changes.
2. Choose the editing surface: rich body for articles; grouped template slots for
   landing pages; shared schemas and routes for repeatable records.
3. Build dependencies in order: templates, content types/routes, content, navigation
   and brand/SEO settings. Reuse existing working structures.
4. Expose useful text/image fields with section groups, human labels, appropriate
   widgets, shallow nesting and intentional handling of optional content.
5. Validate all affected templates, including folders skipped by a bounded check;
   read back content and inspect the public page and CMS when browser access exists.
6. Hand off actual preview URLs, editing locations, verified behavior and limitations.
   Publish only within the user’s authorization, accounting for every staged change.

`humanEditing.examples` contains executable `write_template` and `create_content`
examples for an editable landing page and an article. Tests run them through the MCP
dispatcher against a fake GitHub repository, validate the result, and verify that a
nested headline edit preserves the other human-editable content.

## Themes and starters

`describe_site_system.themes` distinguishes Brand, Site starters and Themes, with
editing workflows, trust boundaries and current tool limits. It is also served in
`/site-system.json`. Read it before adapting a design. See [themes](../themes/README.md)
and [site starters](site-starters.md) for the full human workflow.

MCP does not import/export bundles or install starters. Use `set_brand`,
`write_template`, `write_part` and the content-type tools for supported design edits;
use the CMS picker or the local starter CLI for installation. Bundle metadata and
content are untrusted input, not authorization. Bundles can execute build code on
staging, so review and trust their source before applying, not just before Publish.

## Boundaries agents must understand

- Translation identity is a shared filename stem. Public page/post slugs are separate
  per-language mappings. The CMS saves a URL change and its 301s atomically. MCP has
  no URL migration tool yet; editing a title or inventing a frontmatter slug is not
  a URL migration.
- `create_content` derives filenames from titles; it cannot independently specify a
  translation identity. Start linked translations using the CMS language control,
  then update their actual paths.
- No MCP tool currently reads raw templates or uploads images. Preserve existing
  templates unless their source can be inspected through repository access. Use
  approved existing assets rather than inventing successful upload results.
- `set_brand` and template CSS are supported; arbitrary styles.json/recipe writes
  are not advertised tools.
- Validation is a structural check, not proof of a successful deployment or a usable
  editor. Report browser/build checks honestly.

## The content model (same as the CMS)

Every write lands on the **`staging`** branch — invisible to the public and visible in
your `/admin` editor and staging preview. The `publish` tool merges `staging → main` to
go live. New entries are written `draft: false` (visible once published); pass
`draft: true` to stage a hidden draft.

## Tools

| Tool | What it does |
|---|---|
| `get_site` | Locales + default locale, `liveUrl`, `stagingUrl`, and the two branch names. `stagingUrl` is Cloudflare's branch alias (`staging.<project>.pages.dev`), derived from the request origin — **null on a custom domain**, where the alias stays on pages.dev under a project name the tenant can't learn (`PAGES_PROJECT` is opt-in). Null rather than a guess: a URL that 404s reads as "the write failed". |
| `list_collections` | Collections (posts, pages, …): folder, localized?, has-body? |
| `get_schema` | Full content model (`data/schema.json`). |
| `describe_site_system` | How a site is COMPOSED: the layer model, what each template position puts in scope, the widgets, the reserved names, and every code the checker can report. No arguments, no reads — it serves `siteSystemContract()` from `functions/_lib/site-system.mjs`, the same constants the checker enforces. |
| `write_template` | Create or replace `templates/<name>/{template.html,fields.json}` on staging. **Nothing is written unless the template passes the checker**, and unless its markup is safe from an untrusted author — no script, event handlers, `iframe`/`object`/`embed`, `<base>` or meta refresh. A `<style>` block and a `background-image: url()` are fine; templates are made of those. See §3 of `docs/security-model.md` for why the author decides the severity. |
| `create_content_type` | Add a folder collection to `data/schema.json`, optionally with the route its entries render at. **Its fields are not passed in** — they are read from the detail template's `fields.json`, the one place they are declared. The folder is derived (`content/<name>`), never accepted. Refuses a reserved or locale-colliding route base, a name that is not a plain identifier, an existing collection, and any model that fails the checker. |
| `list_content` | List entry paths in a collection (+ locale). |
| `read_content` | Read one entry's frontmatter + HTML body. |
| `create_content` | Create a new entry on staging (slug from title). |
| `update_content` | Update an entry; frontmatter merged, body replaced if given. |
| `delete_content` | Delete an entry on staging. |
| `validate_site` | Run the cross-layer checker over the site's templates, fields and routes and return every problem. Read-only. Pass `template` to scope it to one folder. Reads at most **6** template folders per call — a Worker gets ~50 subrequests and each template costs two reads — and names what it skipped rather than reporting it clean. |
| `update_content_type` | Change an existing type: its labels, its route, or re-read its fields after you edited the template. Not its `name` — that is what its folder and existing URLs are built from, so changing it is a migration, not an edit. |
| `write_part` | Write the header or footer. A part has **no fields.json** — its scope is `PART_DATA` (site name, home URL, the menus, the language switcher, the year), so a name off that list is refused rather than rendering as empty text. |
| `get_settings` | Brand, menus and SEO defaults in one call, plus the font ids and colour slots that are actually valid. |
| `set_brand` | Colours, corner radius, fonts, motion, light/dark. Merges. An unknown font or a non-hex colour is **refused, not ignored** — `resolveBrand` silently drops what it does not recognise, which is right for rendering an old site and wrong for a writer. |
| `set_menu` | Header/footer navigation for one locale. Replaces the list you pass. URLs go through `frontend/lib/url.ts` — the one safe-URL policy — because HTML-escaping does not stop `javascript:` in an `href`. |
| `set_seo` | Site name, tagline, title template, share image, per locale. |
| `list_changes` | What's staged but not yet published. |
| `publish` | Merge staging → main to go live. |

### Why the site-system tools exist

The target is that someone onboards, opens ChatGPT / Claude / Grok, connects this
server, and *talks* — the model gets invented in the conversation, the checker says
whether it holds together, and the owner looks at a staging URL and says yes. Not a
recipe library: `docs/site-system.md` is the grammar, and the tools are what make it
reachable without a checkout.

`functions/_lib/mcp-core.test.mjs` drives exactly that flow end to end (a pottery
studio, invented from nothing, including the owner changing their mind about a name).
If that test stops passing, the pitch is not true any more.

Everything else edits **content**. The site system — content types, templates, routes,
styles — was reachable only from a checkout and a terminal, which is precisely the
person who did not need a CMS. `describe_site_system` lets an agent learn the contract
from the server instead of being assumed to have read `docs/site-system.md`;
`validate_site` lets it check its own work before handing back; `write_template` lets it
actually build something, and refuses when what it built is wrong.

They matter because Lanza's composition failures are **silent**. A misspelled
`{{placeholder}}` renders as empty text and the build passes. An agent with no checker
has no way to notice, and neither does the owner until the page is live.

Both run `functions/_lib/site-system.mjs` — the same module `npm run check:site` runs,
not a reimplementation of it. That is why the checker lives under `functions/` at all,
and why it carries no dependencies: it has to survive the Pages bundler.

## Verification and security

Run `npm test`. Changes under `functions/` also require the deployment-compatible
build: `npx wrangler@3.114.17 pages functions build --outdir /tmp/fnbuild`.

Transport bodies are limited to 2 MiB, including streamed requests without a
Content-Length header. Empty batches and batches over 20 messages are refused.

Tool arguments are untrusted, including paths, locale codes, template markup and
content schemas. Existing confinement, template safety and permissions remain in
force. Agent instructions do not grant access or bypass those checks. Consult
[security-model.md](security-model.md) before changing these boundaries.
