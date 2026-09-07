# Lanza: never lose a good thought again

Lanza is a system for capturing, developing, owning, and eventually publishing human thought. Publishing is an optional outcome, not the organizing principle of the workspace.

Use the labor AI saves to create more human thinking, not more AI content.

Updated 2026-09-07 after the user's clarifications. The agreed v1 is conversation
through ChatGPT/Claude and notes in a private GitHub repository. D1/R2 and a
CMS-native capture interface are not prerequisites. See [Thoughts v1](thoughts-v1.md).

## Product principles

- Capture first, write later. A thought does not need a title, a category, a public URL, or a publishing date to deserve saving.
- Keep ideas alive. Connect observations, questions, sources, and arguments across time; let people return to unfinished thinking without treating it as overdue work.
- Develop rather than replace. AI can organize, question, summarize, identify contradictions, and suggest connections. The person supplies judgment and decides what their work says.
- Preserve the process. Keep original captures, subsequent revisions, sources, timestamps, and the distinction between human contributions and AI assistance.
- Publish deliberately. A public work is a selected expression of the thinking behind it. Publishing that work must not expose its private notes, sources, attachments, or history.
- Own the work. Use portable files and explicit export, retain history, and keep the person's domain and audience relationship under their control.
- Build a body of thought. A decade of use should yield an intelligible network of ideas, not merely a chronological feed.
- Consent is specific. Research or training use is a possible future feature, disabled by default and separate from publishing, connecting an agent, or ordinary product use.

## Workspace

The primary capture interface is the person's conversation with ChatGPT or Claude,
ideally using voice. Their connected assistant organizes and saves thoughts through
Lanza's tools. Lanza supplies durable memory and ownership, not another chat or
recording interface. Actual voice-mode tool support must be verified for each client.

The CMS should center on Thoughts and Writing, with connections as they become useful.
Website content, appearance and publishing remain available. It lets the person review,
find, edit and curate saved work, without requiring them to leave a conversation to
fill in a capture form.

V1 accepts text, quotes, URLs, observations and questions supplied by the connected
assistant. Save original words only when available; do not call an assistant's summary
a verbatim transcript. Raw voice recordings are not assumed to be available from the
client. Private images and audio are subsequent work. Source attribution stays separate
from the person's interpretation. Saving a thought does not publish it.

A thought has a stable identity and can grow through dated contributions. Original captures remain available. The person can link thoughts, identify a question they share, and mark one as worth revisiting. Development is reversible and non-linear; no pipeline requires every thought to become an article.

Writing assembles selected material into a draft. Each inclusion is deliberate. Private references remain in the notebook; published citations are separately reviewed. Existing article and designed-page editors remain useful here.

## Storage and privacy boundary

Unpublished is not the same as private. A draft in a public GitHub repository is publicly readable regardless of whether Astro renders it. A file omitted from a page build can still leak through the repository, build artifacts, search indexes, feeds, MCP tools, exports, logs, or attachments.

V1 uses portable Markdown notes in a dedicated `notes/` directory in the person's
private Lanza GitHub repository. A separate notebook repository is not required.
The privacy boundary is private repository access plus explicit exclusion from
public build output. Do not register notes as ordinary website collections or put
private attachments in public uploads. Git supplies revision history and ordinary
repository backup/export; no D1/R2 provisioning is needed for this v1.

Verify repository privacy before private-note operations and define rechecking behavior.
A public repository must fail closed. Repository collaborators and authorized clients
can read its notes; this is not secrecy from collaborators or end-to-end encryption.
The open-source product repo `dsottimano/lanza` stays public: never test real private
thoughts here. A private source repository can publish a public website.

Publishing deliberately promotes chosen material to public content and assets. Notes
may remain in the private source repository, including its history, but must never
enter public pages, previews, feeds, search, discovery endpoints or packaged assets.
Decide how notes interact with staging and Discard before implementation so a website
reset cannot erase saved thinking. Branch mechanics are open, not a user storage choice.

## Provenance contract

Each capture needs an identifier, creation timestamp, kind, original content or attachment reference, optional source, and an explicit origin declaration. Contributions record their parent, timestamp, actor, operation, and output. Model identity and source thought identifiers accompany AI assistance when known. Unknown origins remain unknown.

Self-declared human input is not cryptographic proof of human authorship. Pasted text and imported content cannot automatically be certified as human-created. Git history provides revision history, not proof that a human conceived a passage.

AI suggestions remain separate until accepted. Accepting a suggestion records the acceptance without rewriting the origin. Private material is sent to a model only under a clear, user-controlled scope. Retrieval and resurfacing must not expand that scope silently.

## Delivery sequence

1. Prove the real assistant/voice/tool connection on a private test tenant, then implement note saving, retrieval and development with Git history and a CMS review surface. Text, quotes and links first.
2. Add explicit connections and bounded search so a later conversation can retrieve and develop earlier thinking. Preserve uncertainty and incomplete ideas.
3. Add evidence-backed suggestions and actual resurfacing mechanisms. AI assistance starts in the user's chosen client; do not build a second assistant or claim automatic memory from file storage alone.
4. Connect selected thoughts to writing and implement deliberate promotion into the existing staging/publishing workflow. Test that no underlying private data crosses that boundary.
5. Add an explorable map of the person's work and, only after a separate product and consent design, optional licensing of specifically selected material.

## Public promise

Lead with “Never lose a good thought again.” Explain capture, development, ownership, and optional publication. Distinguish working features from the roadmap. Do not advertise automatic long-term memory, voice capture, verified human provenance, or licensing as shipped before they work.

Cloudflare is the land. GitHub is the house and its history. Lanza helps the person think, organize the house, and choose which doors to open to the world.

## Acceptance criteria

- A capture survives reload and can be exported with its source and timestamps.
- A private capture and its assets never appear in public pages, previews, feeds, indexes or unauthenticated discovery. Authorized note tools can retrieve them.
- Discarding website changes does not discard saved notes.
- A revision never destroys the original capture; AI output never silently becomes human-attributed input.
- The person can find and develop an old thought without publishing it.
- Publishing a derived article leaves the notebook private.
- Disconnecting an agent or leaving Lanza does not take away the person's files or domain.
- Public copy describes the actual release honestly.
