# Optional tenant-owned OAuth connection

This is reviewable source and a local plugin template. It has passed tests in
Cloudflare's workerd runtime with mocked GitHub responses. It is **not deployed,
registered in ChatGPT, or published to the plugin directory**. The default
configuration names reserved example domains and no live route.

The standard Pages installation still needs no credential store or configuration.
Opting into this separate Worker adds an OAuth authorization server and an MCP
endpoint in the customer's own Cloudflare account. Neither the onboarding broker
nor a Lanza-operated service receives credentials or issues trusted tenant tokens.

## What the owner sees

1. Add `https://<tenant-oauth-host>/mcp` as an OAuth MCP connection.
2. Review the client name/domain, callback hostname and requested permissions on
   the tenant's consent page. Read access is required. Content edits, design changes,
   publication and 30-day offline access are independent permissions.
3. Approve the existing Lanza Agents device authorization on GitHub, installing
   the App on this repository if necessary. The Worker verifies the repository's
   owner role before completing the client callback.
4. ChatGPT receives an opaque OAuth token. The separate upstream GitHub token
   stays in encrypted tenant KV and reaches only the internal GitHub client.

The flow uses `@cloudflare/workers-oauth-provider` 1.2.3 for OAuth 2.1 discovery,
S256 PKCE, exact callback validation, CIMD (preferred) and DCR (fallback), RFC 9207
issuer identification, resource-bound tokens, encrypted grants, rotating refresh
tokens and revocation. Consent is browser-bound and expires after ten minutes.
Each device poll rotates its encrypted, cookie-bound upstream transaction; device
codes and GitHub tokens never appear in HTML or browser JavaScript.

Scopes are enforced before executing any element of a batch. Every known tool is
classified explicitly; unknown/new tools are refused. Existing GitHub owner and
repository/path checks run again on MCP requests, with the existing 60-second
identity cache. Read scope includes the content model, templates/settings surfaced
by existing tools and pending changes; it is not a collection-level permission.
Offline access lasts at most 30 days and access tokens last one hour. Without
offline consent no refresh token is issued. GitHub revocation remains effective
within the existing cache window.

Remote tools operate on **persisted staging content**, and authorized remote writes
commit immediately to staging. They do not use live-editor proposal confirmation,
see unsaved edits, or provide a transaction across multiple tool calls. Existing
remote content updates do not require a caller-supplied loaded SHA. Use the live
WebMCP path for revision-safe review of an open editor; avoid simultaneous remote
and human changes to the same entry. Publication retains the existing exact
reviewed-head and non-force checks.

## Prepare one test tenant

Use an explicitly selected private test repository with synthetic content first.
For Pananomica, establish its actual repository, production origin and customer
Cloudflare account before configuring this Worker. Do not assume this product
repository's `lanza.config.json` identifies Pananomica.

Copy this directory into `integrations/tenant-oauth` **inside the tenant repo**.
The imports intentionally resolve that repo's `lanza.config.json`, `functions/`
and `frontend/lib/`; use matching Lanza source from the reviewed branch. Run
`lanza build` normally to materialize those directories for a package-based tenant.
This optional integration is not yet included in the published npm release.

In that directory:

```sh
npm ci --ignore-scripts
npm run types
npm run typecheck
npm test
npm run build
```

`build` is **Wrangler dry-run only**. It bundles the Worker without creating
resources or publishing. The end-to-end fixtures derive repository URLs from the
tenant config but mock all upstream responses and refuse unplanned network calls.
They do not contact or edit real GitHub content.

When deployment is authorized, configure `wrangler.jsonc` in the tenant repo:

- Set a unique Worker name and explicitly select the **customer account**.
- Provision a fresh KV namespace in that account and use its ID for `OAUTH_KV`.
- Set `OAUTH_ORIGIN` to the canonical HTTPS origin the customer owns. Set
  `SITE_ORIGIN` to its production site origin. Neither may contain a path, query,
  fragment, credentials or trailing slash. The Worker refuses aliases.
- Add the customer's exact custom domain route, or enable `workers_dev` and set
  `OAUTH_ORIGIN` to that Worker's exact assigned HTTPS origin. The source leaves
  `workers_dev` disabled and includes no routes to prevent an accidental endpoint.
- Keep `global_fetch_strictly_public` for safe CIMD fetches. No signing secret,
  GitHub App private key, client secret or central broker service is needed.
- Use the nonexpiring Lanza Agents App. An overridden app that issues a rotating
  upstream refresh token is refused; that needs coordinated refresh implementation.
- Configure customer-owned edge rate limits for public authorization/registration
  and token routes before general rollout. DCR is unauthenticated by definition;
  registrations expire after one day. Inspect logs without recording credentials,
  form bodies, tokens or cookie values.

Deploy only after reviewing the configured account, repo and route. Then check
`/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource/mcp`, an unauthenticated `/mcp` challenge,
owner sign-in, read-only calls, scope refusal and revocation on the private tenant.
Test a synthetic staging write only within authorization; do not Publish as part
of the connection proof. The initial adapter accepts absent or same-origin `Origin`
headers; actual client transport behavior must be checked before broader support.

The provider uses KV, whose deletion is eventually consistent, rather than atomic
Durable Object token state. Its documented consent/upstream helpers can accept
concurrent use by the **same bound browser**; another browser is refused. This
does not claim globally atomic code consumption or instant cross-region revocation.
GitHub's single-use device exchange, PKCE and provider replay/grant revocation remain
the other controls. Review that tradeoff before a public rollout.

## Private ChatGPT connection and plugin

For a private proof, use ChatGPT Plugins → Add custom MCP server with the deployed
`/mcp` URL and OAuth, then Create as a plugin. The server advertises issuer support
and CIMD, including compatibility with ChatGPT's published client metadata and
registered callback. Follow the exact callback the client presents; never add
wildcards or guessed callback addresses. Current source tests use a fixture with
the official ChatGPT client/callback shape, not a live registration.

`plugin/` contains a portable Agent Plugins manifest, an MCP connection declaration
preferring CIMD, and the `edit-site` workflow. Replace `plugin/mcp.json`'s example URL
with the **same canonical deployed `/mcp` URL**. Install through a local/repo
marketplace for private testing; alternatively, map the created `plugin_asdk_app…`
connection using OpenAI's plugin creator. No registration ID is invented here.

A universal public plugin still needs a real HTTPS endpoint, verified publisher
domains, submission metadata/privacy terms, a dedicated test tenant/reviewer flow,
and OpenAI review. There is no central multi-tenant connection/router in this work.
Keep credentials tenant-owned if later adding tenant selection; do not point the
product-wide plugin at a customer's repository by default.

This OAuth connects ChatGPT **to the tenant's tools**. It does not embed inference
in the CMS or exchange the user's ChatGPT subscription for an API key. Commercial
hosted SIWC inference eligibility/approval is separate; see
[the CMS integration notes](../../docs/chatgpt-integration.md).

Official references:

- [Cloudflare OAuth provider](https://github.com/cloudflare/workers-oauth-provider),
  [consent](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/consent-page.md),
  [upstream sign-in and KV concurrency](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/upstream-sign-in.md).
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth),
  [private connection setup](https://developers.openai.com/api/docs/guides/custom-mcp-server),
  [plugin packaging](https://developers.openai.com/plugins/build/plugins),
  [public submission](https://developers.openai.com/plugins/deploy/submission).
# Delegated site administration

Optional: set `LANZA_SITE_ADMINS` on this Worker to the same comma-separated GitHub
logins configured on the tenant's Pages project, then redeploy both. The setting is
read from each runtime independently. Listed users must retain GitHub write access;
read-only and removed users are refused. Removing a name and redeploying also blocks
that user's existing OAuth connection. No shared credential or delegation-write tool
is introduced. `list_plugins` is read-scoped; generic `run_plugin` is deliberately
unsupported in OAuth until plugin actions have explicit scope mappings.
