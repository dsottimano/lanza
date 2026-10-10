# ChatGPT and the live CMS

Status: the first WebMCP editor implementation is in source. A real ChatGPT
desktop/browser/account connection and production deployment have not been verified.
Remote ChatGPT OAuth remains a separate implementation phase.

## Live page tools

The CMS registers tools in the top-level document when the browser supplies
`document.modelContext.registerTool` and `unregisterTool`. Other browsers retain
the ordinary CMS. No token is copied to JavaScript, no inference API key is added,
and nothing outside the tenant acquires a credential.

The tools use the same local editor and GitHub cookie proxy as human editing:

| Tool | Behavior |
| --- | --- |
| `get_cms_context` | Current screen, repository/account/role, locale and unsaved status. Available throughout the CMS. |
| `get_editor_context` | Open entry identity, base SHA, local revision, selected text and declared text field paths. `fieldPath` selects a value; other fields' values are not returned. |
| `focus_editor_field` | Focus a declared text field in the open editor and its preview. Returns whether focus succeeded. |
| `propose_editor_change` | Show one text replacement for human confirmation. Require the exact current revision, then pause autosave and apply only to the local editor. Save remains explicit. |

The first write scope is string/text fields and existing string list items in
entry editors. Template slot declarations come from the selected template's
`fields.json`. Numeric list paths use the same field-path helper as the forms.
Structural/list changes, images, rich body edits, raw template HTML, publishing
and settings writes are not offered by these browser tools. Other CMS screens
currently expose context only.

Loading, recovery, active saves and save conflicts block editor tools. Viewers
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

1. Update the ChatGPT desktop app. Confirm Site tools are available for the
   account/workspace and supported model, then open `/admin` in its built-in browser.
2. Sign into the tenant normally with GitHub. Inspect Available site tools in the
   browser address bar. `get_cms_context` should identify the real tenant and screen.
3. Open an existing designed page. Ask the assistant to read a declared heading
   with `get_editor_context`, focus it, and propose a specific replacement using
   the returned revision.
4. Decline first and verify the field and stored Git content stay unchanged.
   Accept a second proposal and verify the preview changes while Git stays unchanged
   beyond the normal autosave interval. Review the before/after confirmation.
5. Save explicitly, reload, and verify the selected value renders and unrelated
   fields/body remain intact. Do not Publish as part of this connection proof.
6. Verify that typing after context was read rejects the old proposal. Navigate
   away and ensure only the current screen's tools remain. Repeat as an editor and
   check owner-only publishing/settings privileges are not introduced.

Automation covers registration lifecycle, prototype/undeclared path refusal,
revision/permission changes during review, real-template rendering, explicit save,
body preservation and reload. This is not proof of the desktop client's live API.
Voice tool access is also unverified.

## Other connection paths

Remote MCP at `/api/mcp` still uses the owner's GitHub bearer token, acquired via
Settings → Connect an agent. It operates on persisted Git state and cannot see
the live editor's unsaved text or selection. Current ChatGPT custom MCP setup
documents OAuth/noauth/mixed authentication, not a fixed bearer-token input.
Do not claim its existing manual bearer setup is verified in ChatGPT web.

The next remote integration needs an authorization server owned by the tenant,
with protected-resource/OAuth discovery, S256 PKCE, one-time codes, exact callbacks,
resource/audience checks and narrow scopes. Its credentials, keys, grants and
revocation state must remain in that tenant's Cloudflare account. Reintroducing a
broker credential store or a broker signing key would violate security invariant I3.

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
