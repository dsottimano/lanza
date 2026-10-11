# Agent text provenance

Lanza records declared agent involvement, not proof of authorship or an AI detector.
The HTML contract is `<span data-lanza-origin="agent">text</span>`. This uses the
standard HTML custom-data mechanism; `agent` is Lanza's vocabulary, not a W3C AI
certification. The emerging AI Content Disclosure community proposal is not yet
part of the HTML standard. No model name or human identity is guessed.

MCP create/update/translation writes and accepted live body proposals (including
request replacements and Research proposals) mark added words. Existing text keeps
its recorded origin. Unmarked text means unknown, never certified human. Formatting
alone does not make prose agent-authored. A human accepting or saving agent text
does not remove the marker. Normal typing in an agent span inserts unmarked text;
copying an existing marked passage retains its marker. Code blocks carry a block
attribute because the editor does not support inline marks in code. Very large
ambiguous diffs are refused; smaller edits are required instead of guessing.

The writing canvas and review dialog highlight agent spans with a dotted underline
and pale background. Markers survive editor serialization and public sanitization.
Public styling is tenant-controlled; the attribute itself is intentionally neutral.

Plain fields cannot contain HTML. System frontmatter `lanzaProvenance` stores
`{version:1, fields:{"slots.heading":{origin:"agent",text:"Written value"}}}`.
Changed fields supplied through agent tools are recorded; untouched field records
are retained. Templates wrap attributed text positions only, never attributes,
comments, scripts, SVG or URLs. Human changes to a recorded field retain attribution
on unchanged text, with new words unmarked. The snapshot records what the agent
supplied; no private prompts, responses, credentials or model identifiers are stored.
The field list is visible in the editor. Schema generation preserves this reserved
system metadata; it is not a user-editable content field.

Repository/CLI agents must use the same markers and metadata. There is no reliable
way to discover an unmarked agent write made directly to Git, or a paste from an
external chat, so those paths depend on explicit annotation. Never blanket-label
historic content or infer authorship from the Git author. Backfills must name the
known content and leave uncertain sections alone. Templates' literal prose needs
explicit markers; generated HTML structure and CSS are not agent-authored prose.

References: https://html.spec.whatwg.org/multipage/dom.html#custom-data-attribute
and https://w3c-cg.github.io/ai-content-disclosure/ .
