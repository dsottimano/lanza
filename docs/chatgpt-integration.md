# ChatGPT and the live CMS

Status: the first WebMCP editor implementation is in source. A real ChatGPT
desktop/browser/account connection and production deployment have not been verified.
An optional tenant-owned remote OAuth Worker and plugin template are also in
source; their deployment, resource provisioning and real client registration
remain unverified. See [tenant OAuth setup](../integrations/tenant-oauth/README.md).

## Live page tools

The CMS registers tools in the top-level document when the browser supplies
`document.modelContext.registerTool` and `unregisterTool`. Other browsers retain
the ordinary CMS. No token is copied to JavaScript, no inference API key is added,
and nothing outside the tenant acquires a credential.

The tools use the same local editor and GitHub cookie proxy as human editing:

| Tool | Behavior |
| --- | --- |
| `get_cms_context` | Current screen, repository/account/role, locale and unsaved status. Available throughout the CMS. |
| `get_editor_context` | Open entry identity, base SHA, local revision, selected text and declared text field paths. `fieldPath` selects a value; `includeBody:true` includes the live rich body HTML and current text selection. Other fields' values are not returned. |
| `focus_editor_field` | Focus a declared text field in the open editor and its preview. Returns whether focus succeeded. |
| `propose_editor_change` | Show one text replacement for human confirmation. Require the exact current revision, then pause autosave and apply only to the local editor. Save remains explicit. |
| `propose_editor_body_change` | Propose supported HTML for the whole visible body or current text selection. Require the exact revision (including selection), parse against the live TipTap schema without changing the document, then show readable inert before/after previews and exact HTML for explicit acceptance. Acceptance pauses autosave and remains local; normal Undo and explicit Save remain available. |

The first write scope is string/text fields and existing string list items in
entry editors. Template slot declarations come from the selected template's
`fields.json`. Numeric list paths use the same field-path helper as the forms.
The rich body tool is bounded to 100,000 HTML characters and retains the current
editor schema. It rejects unsupported/active markup before opening review, so a
refused proposal cannot damage or invalidate the existing article. Selection
replacements preserve other paragraphs; body replacements show the whole article.
Image uploading, structural/list metadata changes, raw template HTML, publishing
and settings writes are not offered by these browser tools. Other CMS screens
currently expose context only.

Loading, recovery, unsupported current body formatting, active saves and save conflicts block editor tools. Viewers
may inspect but cannot propose. After confirmation, the tool rechecks readiness,
permission and revision before applying. Navigation unregisters the tools and
invalidates retained execution handles. GitHub still enforces all stored writes;
browser role checks are not an authorization boundary.

Accepted proposals appear in the existing form/preview and remain dirty, with
autosave paused. The owner can edit or abandon them using the ordinary editor.
Save retains the original loaded base SHA; a concurrent remote change produces
the existing conflict instead of overwriting it. Saving to staging and publishing
remain separate. No browser tool saves or publishes on its own.

## Real account proof

Use an explicitly selected synthetic/disposable entry in a private test tenant;
do not test private thought content in this public product repository.

1. Use the ChatGPT desktop app’s built-in browser with ChatGPT Work or Codex,
   using GPT-5.6 Sol or GPT-6 Sol. Confirm Site tools are available for the
   account/workspace (Enterprise needs admin policy; Edu is unsupported), then
   open `/admin` there. An ordinary browser tab and Codex TUI session do not share this live
   document or its unsaved values; installing a remote MCP server cannot add that
   browser host. No live host was available in the implementation session.
2. Sign into the tenant normally with GitHub. Inspect Available site tools in the
   browser address bar. `get_cms_context` should identify the real tenant and screen.
3. Open a post. Ask the assistant to read `get_editor_context` with
   `includeBody:true`, then propose supported HTML using `propose_editor_body_change`
   and the exact returned revision. Test the whole body and a selected phrase.
   Also test a designed page heading with `propose_editor_change`.
4. Decline first and verify the field and stored Git content stay unchanged.
   Accept a second proposal and verify the article changes while Git stays unchanged
   beyond the normal autosave interval. Inspect readable before/after and exact HTML.
   Normal Undo should restore the article without writing Git.
5. Save explicitly, reload, and verify the selected value renders and unrelated
   fields/body remain intact. Do not Publish as part of this connection proof.
6. Verify that typing after context was read rejects the old proposal. Navigate
   away and ensure only the current screen's tools remain. Repeat as an editor and
   check owner-only publishing/settings privileges are not introduced.

Automation covers registration lifecycle, prototype/undeclared path refusal,
revision/permission changes during review, real-template rendering, explicit save,
body preservation and reload. This is not proof of the desktop client's live API.
Voice tool access is also unverified. A successful package/build does not prove a live account connection.

## Saved selection requests

The CMS can save a selected passage and an instruction on the private repository's
separate request branch. This is an asynchronous handoff: ask the connected
assistant to retrieve the saved request. Submission does not send an autonomous
notification, start ChatGPT or expose unsaved editor state beyond the captured
passage/context. MCP responses are stored proposals, not article edits or
publication. The human reviews a replacement against current text; stale anchors
need fresh context. See [Agent requests](agent-requests.md) for storage, privacy,
version checks and the tool workflow.

## Other connection paths

Remote MCP at `/api/mcp` still uses the owner's GitHub bearer token, acquired via
Settings → Connect an agent. It operates on persisted Git state and cannot see
the live editor's unsaved text or selection. Current ChatGPT custom MCP setup
documents OAuth/noauth/mixed authentication, not a fixed bearer-token input.
Do not claim its existing manual bearer setup is verified in ChatGPT web.

The optional remote Worker wraps the existing MCP handler with Cloudflare's OAuth
provider: protected-resource/OAuth discovery, S256 PKCE, exact callbacks, encrypted
grants, resource/audience checks and separately enforced read/content/design/publish
scopes. Its GitHub device flow runs after client consent and verifies the owner.
ChatGPT receives an opaque OAuth bearer while the upstream credential stays in the
customer's KV. KV consistency/concurrent-use limits are documented in its setup.
Reintroducing a broker credential store or signing key would violate invariant I3.

Sign in with ChatGPT (SIWC) is a separate path for identity and eligible inference.
The open-source plan-usage flow requires a local `127.0.0.1` callback and protected
local/self-hosted credential storage. Paid/remotely hosted applications are directed
to the access interest form. A customer-owned Cloudflare deployment is not established
as the documented self-hosted-VM exception. Hosted MCP tools are unsupported on that
inference route; a client runtime can execute function/custom tools instead. Do not
offer hosted CMS subscription-funded inference without confirmed eligibility.

Official references:

- [Site tools / WebMCP](https://learn.chatgpt.com/docs/webmcp): supported desktop/browser/model/workspace surfaces and API subset.
- [Custom MCP setup](https://developers.openai.com/api/docs/guides/custom-mcp-server): remote connection and authentication choices.
- [MCP authentication](https://developers.openai.com/plugins/build/auth): OAuth discovery, PKCE, client metadata and callbacks.
- [SIWC overview](https://developers.openai.com/siwc/quickstart), [open-source plan usage](https://developers.openai.com/siwc/token-sharing-open-source), [sign-in contract](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) and [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
