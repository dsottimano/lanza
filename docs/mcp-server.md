# Lanza MCP server

Lets an external agent (ChatGPT / Claude / Codex) connect to a **live** Lanza site and
edit its content — create/update/delete pages and posts, then publish. It ships inside
`@lanza/site`, so **every tenant that installs the CMS gets an MCP endpoint on their own
domain automatically**, the same way `functions/admin/api/gh` gives every tenant a GitHub
proxy.

- **Endpoint:** `POST https://<your-site>/api/mcp`
- **Transport:** MCP Streamable HTTP, **stateless** — each POST is a self-contained
  JSON-RPC exchange. No Durable Object, no session store. `GET` (server→client SSE) is
  unsupported.
- **Auth:** OAuth 2.1. Zero-friction — the user pastes the site URL into the
  connector, approves once in the browser via GitHub, done. No API keys, no PATs.
- **Protocol revision:** the server advertises `2025-06-18`
  (`mcp-core.ts:SUPPORTED_PROTOCOL`), which is why JSON-RPC batching is still
  accepted. Don't cite `2025-11-25` here without changing the code — that revision
  removed batching.

> **⚠️ Not deployable yet.** The authorization-server half listed below lives only
> in a *second, stale* broker checkout (`lanza/lanza-broker`, gitignored) and is
> not in the canonical `lanza-broker` repo. Until it is rebased and committed
> there, `/.well-known/oauth-authorization-server` 404s on `connect.lanzacms.com`
> and **every MCP connection dies at discovery step 2.** The prereqs below are
> also still outstanding.

## Architecture

Two roles, reusing what already exists:

- **Resource server** = the tenant's `/api/mcp` (this repo). Validates access tokens,
  runs the tools. Files: `functions/api/mcp.ts` (transport + auth), `functions/_lib/
  mcp-core.ts` (protocol + tools), `functions/_lib/lanza-content.ts` (GitHub ops),
  `functions/.well-known/oauth-protected-resource.ts` (RFC 9728 discovery).
- **Authorization server** = the **broker** (`connect.lanzacms.com`, `lanza-broker`
  repo). GitHub (the `lanza-cms` App) is the identity. Files: `functions/.well-known/
  oauth-authorization-server.ts` (RFC 8414), `functions/api/oauth/{authorize,
  github-callback,token,register}.ts`, `functions/_lib/oauth-{util,store}.ts`. Reuses
  `handoff.ts` (RS256 signing) and `gh-app.ts` + `/api/token` (repo-scoped write token).

### The flow

1. Agent hits `/api/mcp` unauthenticated → **401 + `WWW-Authenticate: Bearer
   resource_metadata="…/.well-known/oauth-protected-resource"`**.
2. That doc names the broker as `authorization_server`. Agent reads the broker's
   `/.well-known/oauth-authorization-server`, registers (**CIMD** preferred, **DCR**
   fallback), starts authorization-code + **PKCE (S256)**.
3. Broker `/api/oauth/authorize` bounces the user to GitHub (scopeless identity) →
   approve in browser.
4. Broker `/api/oauth/github-callback` reads the login, issues a one-time code → back to
   the agent.
5. Agent calls broker `/api/oauth/token` (PKCE verify) → short-lived **RS256 access
   token** (`{login, aud: your-mcp-url}`) + rotating refresh token.
6. Agent calls `/api/mcp` with the token. The function verifies it with the **baked-in
   public key** (`HANDOFF_PUBLIC_KEY`, same as the CMS session), checks the audience is
   this site and `login == site owner`, then mints a repo-scoped GitHub token via the
   broker's `/api/token` to do the writes. **The agent never sees a GitHub token; no PAT.**

## The content model (same as the CMS)

Every write lands on the **`staging`** branch — invisible to the public and visible in
your `/admin` editor and staging preview. The `publish` tool merges `staging → main` to
go live. New entries are written `draft: false` (visible once published); pass
`draft: true` to stage a hidden draft.

## Tools

| Tool | What it does |
|---|---|
| `get_site` | Locales + default locale. |
| `list_collections` | Collections (posts, pages, …): folder, localized?, has-body? |
| `get_schema` | Full content model (`data/schema.json`). |
| `list_content` | List entry paths in a collection (+ locale). |
| `read_content` | Read one entry's frontmatter + HTML body. |
| `create_content` | Create a new entry on staging (slug from title). |
| `update_content` | Update an entry; frontmatter merged, body replaced if given. |
| `delete_content` | Delete an entry on staging. |
| `list_changes` | What's staged but not yet published. |
| `publish` | Merge staging → main to go live. |

## Setup

### Broker prereqs (once, `lanza-broker`)

1. **Create a KV namespace** and bind it as `OAUTH_KV` (auth codes, refresh tokens,
   DCR clients):
   ```sh
   wrangler kv namespace create OAUTH_KV
   # then add the binding (name OAUTH_KV) to the broker Pages project — dashboard,
   # or a [[kv_namespaces]] entry if the broker adopts wrangler config.
   ```
2. **Register the OAuth callback** `https://connect.lanzacms.com/api/oauth/github-callback`
   as a callback URL on the `lanza-cms` GitHub App (alongside the existing
   `/api/auth/callback`).
3. Existing broker secrets already cover the rest: `GH_APP_ID`, `GH_APP_PRIVATE_KEY`,
   `GH_APP_CLIENT_ID`, `GH_APP_CLIENT_SECRET`, `HANDOFF_PRIVATE_KEY`.

### Tenant

Nothing per-site. `HANDOFF_PUBLIC_KEY` and `BROKER_ORIGIN` are baked into `@lanza/site`
(`functions/_lib/tenant-config.ts`); repo identity comes from `lanza.config.json`. A
`GITHUB_TOKEN` secret is an optional self-host fallback for when the broker is
unavailable.

## Connecting an agent

- **Claude** (Settings → Connectors → Add custom connector): paste
  `https://<your-site>/api/mcp`. It discovers OAuth automatically and opens the GitHub
  approval.
- **ChatGPT** (Settings → Connectors, developer mode for a custom URL): same URL; OAuth
  is the only supported auth and is handled automatically.
- **Codex** (`~/.codex/config.toml`):
  ```toml
  [mcp_servers.my-site]
  url = "https://<your-site>/api/mcp"
  # auth = "oauth" is the default
  ```
  then `codex mcp login my-site` (browser OAuth; no key pasted).

## Tests

```sh
# Tenant (this repo): protocol + content flow (fake GitHub, no token)
npm test

# Broker (lanza-broker): OAuth utils + full authorization-code/PKCE/refresh flow
node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs \
  --test functions/_lib/oauth-util.test.mjs functions/api/oauth/oauth-flow.test.mjs
```

## Security notes

- **Audience binding (RFC 8707):** access tokens carry `aud = your MCP URL`; a token
  minted for another Lanza site is rejected. The `resource` in the protected-resource
  metadata must match the connect URL exactly.
- **Owner-only:** the resource server requires the token's `login` to equal the site's
  `adminLogin`, and the broker's `/api/token` independently re-checks `owner == login`
  before minting a write token — so a token is only ever usable to write the user's own
  repo. Since 2026-07-25 `/api/token` **also** binds the token's `aud` to the repo
  being requested; ownership alone let a session minted for one site mint write
  tokens for *every* repo its login owns (broker design §3.3).
- **The tools are confined — assume the agent is hostile.** An agent driving these
  tools may be acting on prompt-injected input, so tool arguments are untrusted:
  - `assertSafePath()` (`lanza-content.ts`) rejects `..`, `.`, leading `/`, `\`,
    `%`, NUL, empty segments and `.git` on **every** path reaching the Contents
    API. `encodeURIComponent` does not escape dots, so encoding alone does not
    neutralize traversal — `fetch()` normalizes `..` when it parses the URL.
  - `assertEntryPath()` (`mcp-core.ts`) additionally requires the entry tools'
    `path` to be a `.md` file inside a folder some collection in
    `data/schema.json` declares. Without it, "update an entry" is whole-repo
    write: `lanza.config.json` (which decides who owns `/admin`) and
    `.github/workflows/*` (code execution in the tenant's CI, via staging a
    workflow then calling `publish`) are both in range.
  - `locale` is validated against `data/site.json` — it is interpolated into a
    write path, so it is input, not a label.
  - `create_content` refuses an existing path rather than upserting.

  The adversarial cases are in `functions/_lib/mcp-core.test.mjs`; they assert the
  call was refused **and** that nothing was written. See `security-model.md` §2.
- **Public clients + PKCE S256**, refresh-token rotation, one-time auth codes. No client
  secrets are issued.
- **CIMD-first** (avoids a client-record store); DCR is the compatibility fallback.
