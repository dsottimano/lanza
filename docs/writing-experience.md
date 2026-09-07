# Writing experience, September 2026

The first implementation slice follows the September 6 product discussion: people
write and refine content, agents handle structure and design. Posts retain their
writing canvas; landing pages retain fields beside a preview. All options remain
available, with a quieter workspace and remembered panel choices.

## Implemented

- Post focus mode hides navigation and options without unmounting the document.
  Options, SEO and details panel preferences persist in local storage.
- Rich entry editors autosave after two idle seconds, only after a successful load
  and with a title. There is one in-flight save; edits during that request remain
  dirty and get their own later snapshot. Nested model changes participate in dirty
  tracking, including list operations and image replacement/removal.
- Failed writes pause autosave until an explicit retry. GitHub's base SHA is retained
  on conflicts. A first save updates the URL while preserving the editor instance.
  Existing URL changes still require Save.
- Tab-local recovery uses sessionStorage, scoped to repository/login/entry. Restoring
  requires a choice and retains the original SHA, preventing recovery from silently
  replacing a newer stored entry. It pauses autosave until explicitly saved. Storage
  failures never claim a recovery copy exists.
- Review reverts remain local until Save. `pauseAutosave` is called before changing
  the editor, preserving the contract in `review-surface.md`.
- Shared inputs have sufficient width, unique label targets, expanding text areas,
  keyboard-accessible image uploads and relation choices, and date controls that
  accept YAML Date values. Opening empty object/list fields no longer changes data.
- The editor supports tables and preserves multi-paragraph callouts/testimonials.
  Strict initial content checking blocks saving unsupported markup. Large entries
  returned without base64 content fail loading rather than opening as empty files.
- Writing and publishing help now distinguishes autosave, Ready, publishing and
  deployment completion.

## Still separate work

This does not implement an agent proposal store or claim that the shared staging
branch isolates proposals. A concurrent change is refused, not automatically merged
or presented as a new accept/reject proposal. The original SHA stays attached to a
recovered document; a stale recovery may therefore still require manual reconciliation.

The combined content/review home, unified review/publish flow, direct inline editing in the landing-page preview, and moving site-construction controls out of the everyday workspace
remain the next product slices. Unsupported markup is guarded on load; this is not
a general lossless HTML editor or a complete audit of all pasted formatting.

## Landing-page workspace follow-up

The tall title card and template controls are replaced by compact page identity
and a split workspace. Content, Page details and Changes share one inspector; the
preview uses the available viewport height. Content opens on the first section,
with a section selector and previous/next controls. Preview text clicks select its
section and focus the corresponding input, including nested list/object fields.
List structure controls and template HTML are absent from this content mode;
existing text, image and link values remain editable. Headline fields wrap.
Preview animations are disabled only in the editor to keep text visible and steady.
Images remain editable through their section fields; attribute-only slots do not
yet have preview markers.

Validation: 329 admin tests, typecheck/build, and a browser walkthrough of the built
admin against mocked GitHub responses using the real manifesto template and content.
Verified preview-to-field focus, section selection, autosave, a 797px preview at a
1000px desktop viewport, and no horizontal overflow at desktop/mobile widths.

## Identity controls and language URLs

Page names and URL fields share labelled controls with pencil buttons that focus
the editable value, including localized homepage roots such as `/es/`. The active
locale labels the URL field, and each language choice displays its resolved path
using the shared route helper. Starting a missing homepage translation keeps the
`home` filename while allowing an independent public slug.

### Public URLs and redirects

Pages and posts have an editable public slug per language, including the homepage.
An empty homepage slug is the language root (`/` or `/es/`). The locale prefix stays
visible. Existing URL changes require an owner, matching the existing permission for
site settings and redirects. A new entry with its default URL can still be created by
an editor.

Changing an existing URL pauses autosave until explicit Save. The entry, its URL in
`data/site.json` and its 301 rules in `data/redirects.json` land in one commit on staging.
Publish makes them live. Earlier permanent redirects are retargeted to avoid chains;
returning to a former URL removes its outbound redirect to avoid loops. Both trailing
slash forms of an old non-root address redirect. Reserved routes, occupied slugs and
redirect conflicts are refused before writing. A concurrent branch move or stale
content SHA rejects the transaction, retaining the local writing.

The optional `site.urls` dictionary maps `collection/locale/filename-stem` to a public
slug, e.g. `"pages/es/home": "inicio"`. Filenames remain translation identities and
must not be renamed to change a page/post URL. Public routes, CMS links, post listings,
canonicals and translation alternates resolve this mapping. Hard-coded links continue
working through the 301; they are not automatically rewritten. Taxonomy records and
custom content types retain their existing filename-based editing behavior.


### Rich-body workspace refinement

The shared rich-body editor (posts, plain pages and body-using templates) opens with
only title and body in a continuous document. Format reveals the existing toolbar.
Details holds the localized URL and language links, summary/image, search appearance,
and publishing/organization panels. Details starts closed; its visibility and section
choices persist under writing preferences v2. On small screens it opens as a closable
side panel. The writing view omits the HTML inspector, the system-managed updated date,
and the agent-owned layout selector. Existing stored values are preserved.

Verified the built CMS in Chrome at desktop and mobile widths: formatting toggles,
details opens/closes, body typing autosaves once, no browser errors or page overflow.
Admin typecheck/build and all 343 admin tests pass.

### Expanded details and search editing

Details has Expand and Restore controls. Expand uses the workspace width; the rich
editor stays mounted but hidden, preserving its document and undo history. Closing
Details restores writing. The same controls work on mobile.

Search appearance renders title, description and social image directly with clearer
labels and spacing. Canonical/indexing/structured-data controls remain in an Advanced
search settings disclosure. Inline object presentation preserves the existing nested
`seo.*` field paths and merges edits with hidden properties. No schema migration.
Verified desktop/mobile expand, restore, close, SEO autosave and body preservation in
Chrome; 344 admin tests and the admin build pass.
