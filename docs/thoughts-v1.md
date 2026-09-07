# Thoughts v1: conversation to private GitHub notes

Status: agreed product direction, not implemented. Updated 2026-09-07.

## The first complete experience

1. The person talks with ChatGPT or Claude, ideally in voice mode.
2. They ask the assistant to keep a thought. The assistant organizes and saves it
   through the connected Lanza tools, preserving what was supplied and labeling
   its own interpretation separately.
3. In a later conversation, the assistant finds the earlier thought and helps
   develop it, referencing its ID and actual content.
4. The person can browse and edit the thought in the CMS and inspect its origins.
5. When asked, selected material becomes an article/page draft. Existing review and
   publishing controls handle the public work; the source note remains private.

ChatGPT/Claude voice and connector compatibility is not yet verified. Tool access
in a text conversation does not establish voice-mode support. Do not assume access
to a complete conversation transcript, raw audio or background execution.

## Storage decision

Use the person's private GitHub repository, not D1/R2 or browser storage for v1.
Proposed paths are `notes/<stable-id>.md`, outside `content/` and `public/`.
Git history keeps revisions; Markdown plus frontmatter keeps the record portable.
No separate notebook repository or new Cloudflare OAuth scope is required by this
decision. Private repo enforcement still needs implementation verification.

Do not add a `notes` collection to this public product site's `data/schema.json`.
Develop with synthetic fixtures or an explicitly selected disposable private tenant.

## Proposed note contract

Finalize the schema before implementing clients. Minimum information:

- Stable identifier and created/updated timestamps.
- Optional human-readable title; no title required at capture time.
- Kind: note, question, observation, quote or link.
- Original supplied text when available, with an origin declaration: human-supplied,
  quoted/imported, assistant-authored, or unknown. These are declarations, not proof.
- Assistant summary/organization in a separate field or section.
- Optional source URL, attribution, conversation reference and connected note IDs.
- Dated development entries recording contributor and origin. Do not replace the
  original with a polished rewrite and erase the distinction.

Use explicit actor information, not the Git commit author alone: an assistant and
the human may both write using the owner's credential. Never invent verbatim text,
model identity, timestamps of original speech or unavailable conversation IDs.

## Proposed tools, not current APIs

Keep the surface small: save a note, read a note, find notes, add a development and
connect notes. Exact tool names are not decided. Extend the existing tenant MCP
implementation; do not introduce a broker-wide memory service.

- Derive and confine paths to the notes namespace; reject traversal and public repos.
- Check the authenticated person's actual repository access on every operation.
- Make creation retry-safe and updates conflict-aware; avoid blind overwrites.
- Bound search and result size. Return IDs and source text, not unsupported semantic
  claims. Start with straightforward file retrieval before an indexing service.
- A publish request and a save-note request are distinct intents. Ordinary note
  operations must not create a public entry or trigger Publish.
- Return the saved identifier and actual outcome so the client does not claim a
  thought was saved after a failed write.

## Resolve before the first write implementation

The website currently publishes by merging staging into main; Discard can reset
staging to main. Notes saved only on staging could therefore be discarded with
website drafts. Main/staging drift also affects preview code and content.

Choose and test a note persistence strategy that survives both operations. A
dedicated notes branch inside the same private repo or namespace-aware changes to
the existing workflow are implementation candidates, not selected architecture.
Do not casually broaden proxy branch access or alter Discard while wiring a UI.
Private history can remain in the private repo; only the selected public artifact
belongs in generated website output.

Existing note permissions for editors versus owners also need an explicit decision
consistent with current auth. Current MCP is owner-only; do not silently broaden it.

## Privacy tests

- Public repository: note read/write fails without writing anything.
- Unauthorized person or revoked access: fails even if a note ID is known.
- Private test note: absent from production and preview HTML, feeds, sitemap,
  search indexes, `llms.txt`, `site-system.json`, public assets and npm contents.
- Website Publish/Discard: saved notes and revisions survive; no private text leaks.
- Publish derivative: only reviewed text and explicitly selected assets become public.
- Repeat save or stale revision: no duplicate capture or silent loss.
- Read in a new conversation: retrieves actual persisted content with origin labels.

## Deferred

D1/R2, embeddings, autonomous resurfacing, raw voice ingestion, private binary
attachments, research licensing and a graphical thought map. Crawler analytics is
a separate website feature. The core promise is “Never lose a good thought again”;
the interaction is “Talk it through. Keep what matters.”
