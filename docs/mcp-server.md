# Lanza MCP server

Lets an external agent (ChatGPT / Claude / Codex) connect to a **live** Lanza site and
edit its content — create/update/delete pages and posts, then publish. It ships inside
`lanza-site`, so **every tenant that installs the CMS gets an MCP endpoint on their own
domain automatically**, the same way `functions/admin/api/gh` gives every tenant a GitHub
proxy.

There are **two endpoints**, and which one you hand the agent decides how far the
resulting token reaches:

| | Endpoint | Reaches | Use when |
|---|---|---|---|
| **Multi-site** | `POST https://connect.lanzacms.com/api/mcp` | the sites you tick at consent | you own more than one site — one entry, one login |
| **Single-site** | `POST https://<your-site>/api/mcp` | exactly that one site | you want the tightest possible grant, or you self-host with no broker |

- **Transport:** MCP Streamable HTTP, **stateless** — each POST is a self-contained
  JSON-RPC exchange. No Durable Object, no session store. `GET` (server→client SSE) is
  unsupported.
- **Auth:** OAuth 2.1. Zero-friction — the user pastes the URL into the connector,
  approves once in the browser via GitHub, done. No API keys, no PATs.
- **Protocol revision:** the server advertises `2025-06-18`
  (`mcp-core.ts:SUPPORTED_PROTOCOL`), which is why JSON-RPC batching is still
  accepted. Don't cite `2025-11-25` here without changing the code — that revision
  removed batching.

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

## Multi-site: one connection for every site you own

One MCP entry and one OAuth round-trip *per site* does not survive a user with five
sites. `connect.lanzacms.com/api/mcp` is the answer — and it is a **router, not a second
MCP server**.

It holds **no tool definitions and no content logic.** Every real call is forwarded to
that site's own `/api/mcp`, which stays the single implementation (`mcp-core.ts`). Three
consequences, and they are the whole reason for the shape:

1. **No duplication, so no drift.** `tools/list` is fetched from a live granted site, not
   hardcoded — a tool added to a tenant shows up here on its own.
2. **Authorization stays where it already works.** The tenant still checks
   `login == adminLogin`. The router never becomes the thing that decides who owns a site.
3. **Blast radius stays bounded.** See below.

### The grant, and why the consent screen exists

GitHub's own consent proves **identity**, not **scope**. So for the multi-site resource
the broker inserts one more screen (`_lib/consent-page.ts`): a checkbox list of the Lanza
sites that login administers. The choice becomes a **`sites` claim** on the access token.

The list is computed server-side (`gh-app.ts:listUserSites` — the `lanza-cms` App's
installation repos, filtered to those whose `lanza.config.json` names *this* login as
`adminLogin`). The POST is intersected with that list, so a tampered form can only
**narrow** the grant, never widen it. A refresh carries the same list unchanged.

### Blast radius

| Credential | Reaches | Lifetime |
|---|---|---|
| Access token the client stores | only the ticked sites | 1h, refreshable |
| Token minted per forwarded call | **one** site (audience-bound) | 5 min |
| GitHub token | never leaves the tenant — repo-scoped, Contents:write | ~1h |

Nothing downstream ever holds a multi-site credential. `/api/token`'s
`audienceAllowedForRepo` rule is **deliberately untouched**: the router mints its own
per-site tokens rather than asking that endpoint to accept a multi-site audience — so the
check that currently contains blast radius keeps containing it.

### Tool surface

`list_sites` is the broker's own (answered from the claim; no tenant is contacted).
Every other tool is the tenant's, with a **required `site`** injected — `"owner/repo"`,
enumerated in the schema so agents can't guess. A `site` outside the grant is refused
*before any token is minted for it*.

Files: `lanza-broker/functions/api/mcp.ts` (router),
`functions/api/oauth/consent.ts` (site picker POST), `functions/_lib/consent-page.ts`
(the screen), `functions/.well-known/oauth-protected-resource.ts` (the broker's own PRM).

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
| `list_content` | List entry paths in a collection (+ locale). |
| `read_content` | Read one entry's frontmatter + HTML body. |
| `create_content` | Create a new entry on staging (slug from title). |
| `update_content` | Update an entry; frontmatter merged, body replaced if given. |
| `delete_content` | Delete an entry on staging. |
| `validate_site` | Run the cross-layer checker over the site's templates, fields and routes and return every problem. Read-only. Pass `template` to scope it to one folder. Reads at most **6** template folders per call — a Worker gets ~50 subrequests and each template costs two reads — and names what it skipped rather than reporting it clean. |
| `list_changes` | What's staged but not yet published. |
| `publish` | Merge staging → main to go live. |

### Why the last two exist

Everything above `describe_site_system` edits **content**. The site system — content
types, templates, routes, styles — was reachable only from a checkout and a terminal,
which is precisely the person who did not need a CMS. These two are the read half of
closing that: an agent can learn the contract from the server instead of being assumed
to have read `docs/site-system.md`, and then check its own work before handing back.

They matter because Lanza's composition failures are **silent**. A misspelled
`{{placeholder}}` renders as empty text and the build passes. An agent with no checker
has no way to notice, and neither does the owner until the page is live.

Both run `functions/_lib/site-system.mjs` — the same module `npm run check:site` runs,
not a reimplementation of it. That is why the checker lives under `functions/` at all,
and why it carries no dependencies: it has to survive the Pages bundler.

## Setup

### Broker prereqs (once, `lanza-broker`)

1. **Create a KV namespace** and bind it as `LANZA_OAUTH_KV` (auth codes, refresh tokens,
   DCR clients). This is broker-only infrastructure on the broker's own Cloudflare
   account — tenants never get one:
   ```sh
   wrangler kv namespace create lanza-oauth
   # then add the binding (variable name LANZA_OAUTH_KV) to the broker Pages project —
   # dashboard, or a [[kv_namespaces]] entry if the broker adopts wrangler config.
   ```
   The namespace name and the binding name are independent: the namespace is what you
   see in the account's KV list, the binding is what the code reads as
   `env.LANZA_OAUTH_KV`. Bind it per-environment (Production, and Preview if you test
   there) — Pages only picks up a new binding on the next deployment.
2. **Register the OAuth callback** `https://connect.lanzacms.com/api/oauth/github-callback`
   as a callback URL on the `lanza-cms` GitHub App (alongside the existing
   `/api/auth/callback`).
3. Existing broker secrets already cover the rest: `GH_APP_ID`, `GH_APP_PRIVATE_KEY`,
   `GH_APP_CLIENT_ID`, `GH_APP_CLIENT_SECRET`, `HANDOFF_PRIVATE_KEY`.

### Tenant

Nothing per-site. `HANDOFF_PUBLIC_KEY` and `BROKER_ORIGIN` are baked into `lanza-site`
(`functions/_lib/tenant-config.ts`); repo identity comes from `lanza.config.json`. A
`GITHUB_TOKEN` secret is an optional self-host fallback for when the broker is
unavailable.

## Connecting an agent

Use `https://connect.lanzacms.com/api/mcp` for all your sites, or
`https://<your-site>/api/mcp` for exactly one. Everything else is identical — the same
discovery, the same GitHub login. The multi-site URL adds the site-picker screen.

- **Claude** (Settings → Connectors → Add custom connector): paste the URL. It discovers
  OAuth automatically and opens the GitHub approval.
- **ChatGPT** (Settings → Connectors, developer mode for a custom URL): same URL; OAuth
  is the only supported auth and is handled automatically.
- **Codex** (`~/.codex/config.toml`):
  ```toml
  [mcp_servers.lanza]
  url = "https://connect.lanzacms.com/api/mcp"
  # auth = "oauth" is the default
  ```
  then `codex mcp login lanza` (browser OAuth; no key pasted).

**Sign in as the right GitHub account.** Authorization follows the login in the consent
popup, not your Claude/ChatGPT account. GitHub silently reuses whatever session is live,
so re-authenticating does *not* switch accounts — sign out of GitHub first. On the
multi-site endpoint a wrong account shows up honestly (an empty picker naming the login);
on a single-site endpoint it is a bare 403.

## Tests

```sh
# Tenant (this repo): protocol + content flow (fake GitHub, no token)
npm test

# Broker (lanza-broker): OAuth utils, the authorization-code/PKCE/refresh flow, and
# the multi-site consent → sites-claim → router chain (incl. the adversarial cases:
# a tampered consent POST, a replayed single-site token, an ungranted site).
node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs \
  --test functions/_lib/oauth-util.test.mjs functions/api/oauth/oauth-flow.test.mjs \
         functions/api/mcp-multisite.test.mjs
```

## Security notes

- **Audience binding (RFC 8707):** access tokens carry `aud = your MCP URL`; a token
  minted for another Lanza site is rejected. The `resource` in the protected-resource
  metadata must match the connect URL exactly. This holds in **both** directions on the
  multi-site endpoint: a tenant-audience token is refused there (it would otherwise be
  read as a multi-site grant), and the broker's own audience is refused by every tenant.
- **A multi-site token is bounded by its `sites` claim, not by its audience.** The
  audience only says "this is the router"; the claim says how far it reaches. So the
  router must check `sites.includes(site)` on every call — that check *is* the boundary,
  and it runs before any per-site token is minted. A token with no `sites` grants
  nothing (403) rather than defaulting to everything.
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
