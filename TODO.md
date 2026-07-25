# Lanza — handoff (session 11, 2026-07-25)

**Read first:** `docs/security-model.md` (authoritative on auth/authz) ·
`docs/keys-and-secrets.md` (every credential, who holds it, blast radius) ·
`docs/onboarding-workflow.md` (life-of-an-onboarding + Cloudflare API notes) ·
`docs/onboarding-broker-design.md` (why/decisions) · `docs/mcp-server.md`.

Status legend: ☑ done · ◐ in progress · ☐ todo

**Everything is committed and pushed.** Typecheck clean in both repos; `npm test` 36/36
in `lanza`, AS tests 10/10 in `lanza-broker`. Nothing is blocked on code you can't see.

Session 11 shipped, all deployed: the MCP OAuth AS onto the canonical broker (`8cbaa78`),
the `LANZA_OAUTH_KV` rename (`a6ee422`), and two wizard fixes found by watching a real
onboarding (`05aebaf`, `762df16`) — the "Open Cloudflare" button no longer goes live
before the account id exists (it reads "Checking your Cloudflare account…" until then),
an inline error no longer follows the user into the next step, and the wordmark links to
lanzacms.com.

Broker typecheck note: `lanza-broker` has no `package.json`, so `npx tsc` there tries to
install and fails. Use the sibling's binary:
`cd lanza-broker && /home/dsottimano/source/websites/lanza/node_modules/.bin/tsc --noEmit -p tsconfig.json`

---

## Where things stand

**Onboarding works end to end.** A stranger (GitHub `datadefine` + Cloudflare
`data@definemg.com` — deliberately not the Lanza owner) went from nothing to a live site:
repo generated → deployed → `/admin` login → post written → saved to `staging` →
published to `main` → Cloudflare rebuilt → live. Confirmed twice, the second time
(`datadefine/bbbb`) on a clean account with no manual dashboard work at all.

Session 10 fixed nine things, all pushed. The reasoning now lives in the docs rather
than here — `onboarding-workflow.md` §3 for `8000011` (an account-level Cloudflare git
connection record that only Cloudflare itself can write), §1 for the two repo-generation
races, and `keys-and-secrets.md` for the credential model. `git log` in `lanza-broker`
has the per-fix detail.

**Testing note that will waste an hour if forgotten:** step 3 is only exercised on an
account with **no** connection record. Check
`/accounts/<id>/pages/connections` → must be `result: []` before a test run, or the
wizard sails past the thing you meant to test.

### Debugging setup worth reusing

Brave with CDP on `:9222` + a dependency-free client (`cdp.py` in the session
scratchpad: `targets` / `eval` / `goto` / `shot`, `CDP_TARGET=<url substring>`). That is
how Cloudflare's dashboard API was queried as the logged-in user and how the CMS
edit/publish was driven without copy-paste. Launch:
`brave-browser-stable --remote-debugging-port=9222 --user-data-dir=<fresh dir> <url>`
— an already-running Brave swallows the flag.

---

## ☐ Next up

1. **☐ Orphan repo on rejected install.** The tenant repo is created in the OAuth
   callback, *before* the user sees the `lanza-cms` App install screen. Clicking
   **Reject** leaves a repo on their account that nothing owns and the wizard never
   mentions. Either create the repo after consent, or detect the rejection at
   `/api/onboard/setup` and offer to delete it. (`onboarding-workflow.md` §1.)
2. **☐ Option B — get Cloudflare tokens out of the browser.** See its section below.
   This is what makes Site Health work at all, and it closes a known-accepted risk.
3. **☐ Support ticket to Cloudflare** for the already-installed trap: if the Workers and
   Pages App is already installed on a GitHub account, Cloudflare's *own* connect flow
   dead-ends at `github.com/settings/installations/<id>` and never writes the connection
   record. Reproduced with our code out of the picture. We can only hint at it; they
   have to fix it.
4. **◐ MCP** — server side is done and verified in production. One step left: restart
   Claude Code, `/mcp` → `dmg` → Authenticate, then run the three tools. See below.
5. **◐ Multi-site MCP — built, not yet deployed or live-verified.** See its section
   below. Needs a broker deploy, then a real connect against two `datadefine` sites.

---

## ◐ MCP — code is in; blocked on two Cloudflare/GitHub settings

The repo split is **done** (`lanza-broker` `8cbaa78`, pushed). The AS turned out to be
untracked files, not commits, so it was a copy-forward rather than a rebase — nothing in
canonical conflicted. One real drift was caught and fixed on the way: canonical's
`_lib/oauth` exports `getUser` → `{login, id}`, not the `getUserLogin` the AS was written
against, so it would never have compiled. Typecheck clean, AS tests 10/10.

Verified while carrying it over — the token contract holds end to end: the access token is
a broker-signed RS256 JWT, and `/api/token`'s `audienceAllowedForRepo` does
`new URL(aud).origin`, so the MCP audience (`https://site.com/api/mcp`) reduces to the
tenant origin and matches. Discovery lines up too: the tenant PRM advertises
`connect.lanzacms.com` (bare origin), so clients fetch `/.well-known/oauth-authorization-server`,
which the broker now serves with `issuer` computed as the request origin — a byte match.

1. **☑ Rebase/copy the AS onto the canonical checkout.** Done.
2. **☑ Prereqs done.** KV namespace bound to the broker Pages project as
   **`LANZA_OAUTH_KV`** (renamed from `OAUTH_KV`, commit `a6ee422`); the
   `/api/oauth/github-callback` callback is registered on the `lanza-cms` App — proven
   by a real login completing, not just by inspection. Notes that cost time: a Pages KV
   binding can only reach a namespace in the *same account*, bindings are
   per-environment, and **a new binding does nothing until the next deployment** — the
   first `/register` returned Cloudflare error `1101` (Worker threw) purely because the
   running deployment predated the binding. `docs/mcp-server.md` §Setup.
3. **◐ Live-verify.** Everything server-side passes in production (table below). What is
   left is only the client leg: **restart Claude Code** (it holds the MCP config from
   startup, so the `dmg` add is not live yet), then `/mcp` → `dmg` → Authenticate →
   `tools/list` → `create_content` → `publish`. Then ChatGPT (developer mode) and Codex.

### Verified in production 2026-07-25

| Check | Result |
|---|---|
| `/.well-known/oauth-authorization-server` | 200, `issuer` byte-matches the PRM |
| Tenant PRM | 200, points at `connect.lanzacms.com` |
| `/api/oauth/register` (KV write) | 201, `dcr_…` |
| `/api/oauth/authorize` (KV read + write) | 302 to GitHub with the right callback |
| Tenant `/api/mcp` unauthenticated | 401 + `WWW-Authenticate` **on the 401** |
| **Gate 2 vs a stranger's valid token** | **403 `"Forbidden: not the site owner."`** |

That last row is the one worth keeping: a correctly-signed token for GitHub login
`datadefine` was refused by `dsottimano`'s site. CLAUDE.md's "a signature alone
authorizes nobody" is now demonstrated against production, not just asserted.

### Which account, and against which site

This wasted real time, so: **Dave operates as `datadefine`** (see the tenant-testing
persona). `lanzacms.com` has `adminLogin: "dsottimano"`, so a datadefine token can never
drive it — that 403 is correct behaviour, not a bug. The MCP test target must be a
**datadefine-owned site**.

- Test tenant: **`datadefine/define-media-group`** →
  `https://define-media-group-3e8206c30d74.pages.dev` (live; PRM + 401 correct;
  `adminLogin: "datadefine"`, so no identity race).
- Registered locally as MCP server **`dmg`** (the old `lanza` entry pointing at
  `lanzacms.com` was removed — it could only ever 403).
- The Claude *account* is irrelevant to authorization; only the **GitHub login in the
  consent popup** matters. A free Claude plan can't add claude.ai custom connectors, but
  Claude Code itself works as an MCP client and needs no such plan.
- GitHub silently reuses whatever session is live, so re-authenticating does **not**
  change the account. Sign out of GitHub first if you need a different login.

Useful while debugging — decode the token Claude Code actually stored (claims only):
```sh
python3 -c "
import json,base64,os
d=json.load(open(os.path.expanduser('~/.claude/.credentials.json')))
for k,v in d.get('mcpOAuth',{}).items():
    b=v['accessToken'].split('.')[1]; b+='='*(-len(b)%4)
    print(v['serverUrl'], json.loads(base64.urlsafe_b64decode(b)))"
```
A tenant's `*.pages.dev` name is derivable, no lookup needed —
`slug(repo)-<first 12 hex of sha256("owner/repo")>` (`_lib/tenant-origin.ts`).

Run the AS tests (the broker has no `package.json`, so no `npm test`):
`cd lanza-broker && node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs --test functions/api/oauth/oauth-flow.test.mjs functions/_lib/oauth-util.test.mjs`

**Gotchas:** `WWW-Authenticate` must be on the 401 (Claude ignores it on 200) ✓. PRM
`resource` must byte-match the connect URL ✓. CIMD is primary, DCR the KV-backed fallback.

---

## ◐ Multi-site MCP — one connection for every site you own

**Why:** one MCP entry + one OAuth per site doesn't survive a user with five sites.
`connect.lanzacms.com/api/mcp` is one entry for all of them.

**Shape — it's a router, not a second MCP server.** It holds zero tool definitions and
zero content logic; every real call is forwarded to that site's own `/api/mcp`, which
stays the single implementation. So `mcp-core.ts` never gets duplicated, the tenant's
`login == adminLogin` check still runs unchanged, and `/api/token`'s
`audienceAllowedForRepo` was **not** relaxed — the router mints its own per-site,
5-minute, audience-bound tokens instead.

**Blast radius is the point.** A GitHub login proves identity, not scope, so consent
gained a site-picker screen; the ticked list becomes a `sites` claim on the token. The
POST is intersected with the server's own list (tamper can only narrow), refresh carries
it unchanged, and absent/empty means *nothing*, never everything. Nothing downstream ever
holds a multi-site credential.

Written, typecheck clean, **20/20 broker tests** (10 new, incl. the adversarial four:
tampered consent POST, broadening refresh, replayed single-site token, ungranted `site` —
each asserts refusal *and* that no request reached a tenant). Tenant repo untouched:
36/36 still green, and the single-site flow is byte-identical.

New/changed in `lanza-broker`: `functions/api/mcp.ts` (router),
`functions/api/oauth/consent.ts`, `functions/_lib/consent-page.ts`,
`functions/.well-known/oauth-protected-resource.ts`, plus `sites` threaded through
`oauth-store.ts` / `oauth/token.ts` / `oauth/github-callback.ts` and an `expectedAud`
argument on `handoff.verifySession`. Design + rationale: `docs/mcp-server.md`
§Multi-site; the I4 exception is written up in `docs/security-model.md` §1.

- ☐ **Deploy the broker.** Nothing is live until then — and remember a Pages
  binding/route change does nothing until the *next* deployment (that's what produced
  the `1101` last session).
- ☐ **Live-verify:** connect `https://connect.lanzacms.com/api/mcp` as `datadefine`,
  confirm the picker lists their sites (and *not* `dsottimano`'s), tick one, then
  `list_sites` → `create_content` → `publish`. Then re-connect ticking two and confirm a
  call to the unticked one is refused.
- ☐ **`GH_APP_ID` / `GH_APP_PRIVATE_KEY` must be set on the broker Pages project** —
  `listUserSites` needs the App JWT. They already are for `/api/token`; confirm the
  binding covers the same environment.
- ☐ **Custom domains aren't routable yet.** `siteOrigin()` derives the `*.pages.dev`
  origin (always resolves, per `tenant-origin.ts`). A site reached only by a custom
  domain still works — the derived origin serves the same Pages project — but if that
  ever stops being true, this is the line to fix.
- ☐ **`MAX_SITES = 25`.** Beyond that the picker truncates and says so. Fine for now;
  revisit if anyone has more.

---

## ☐ Option B — runtime CF proxy + per-tenant token store

Decided, not built. Wire tenant `functions/admin/api/cf/[[path]].ts` to source the
Cloudflare token **through the broker** (dual-mode: own `CLOUDFLARE_API_TOKEN` direct,
else broker), and decide the broker's persistent `{access, refresh, expires_at}` store
(KV? DO?).

Two things depend on it: **every onboarded tenant's Site Health panel returns 503
permanently** (the broker sets only `NODE_VERSION` on new Pages projects), and it is the
fix for Cloudflare tokens living in a browser cookie (below). Separate from the wizard,
which rides cookies by design.

---

## ☐ Known-open security items (reviewed, deliberately not fixed)

Full detail + rationale in `docs/security-model.md` §5. Listed so they stay decisions.

- ☐ **Sessions can't be revoked.** Stateless 7-day RS256 bearer, no `jti`. Logout clears
  the cookie only; removing a login from `ADMIN_LOGIN` doesn't invalidate live sessions.
  Only kill switch is rotating `HANDOFF_PRIVATE_KEY`, which signs out every tenant.
- ☐ **The handoff token *is* the session token** — one artifact for transport and session.
- ☐ **CF tokens live in a browser cookie** (`lanza_cf`, unauthenticated base64 JSON,
  `HttpOnly; Secure`, `Path=/`). Fixed by Option B above.
- ☐ **CF OAuth scopes: three still unused.** `cf/login.ts` requests
  `workers-kv-storage.write`, `d1.write`, `workers-r2.write`, which no code path calls.
  **Trim the code, not the CF client** — trimming the client first breaks the connect
  step with a generic error. Also `cf/login.ts` honours an unauthenticated `?scope=`
  override.
  **Do not reuse the trim sitting uncommitted in the nested checkout** — it also drops
  `user-details.read`, which was correct when it was written and is now wrong:
  `describeIdentity` (`_lib/cf-accounts.ts:67`) fetches `/client/v4/user` for the email in
  the wizard's identity strip. It's best-effort, so the scope loss would show up as a
  silently missing email, not an error. Re-derive the trim from the canonical tree.
- ☐ **Proxy relays upstream headers verbatim** — inherits GitHub's `Cache-Control` and
  `ACAO: *` rather than enforcing CLAUDE.md Rule 2. Latent: live if the session cookie
  ever moves to `SameSite=None`.
- ☐ **No `Origin` validation on the MCP transport** (spec asks for it; low impact,
  Bearer auth).
- ☐ **Wizard polls with no cap or backoff** — every 3s, several CF API calls per tick, no
  attempt limit. A user who walks away generates ~1,200 authenticated calls/hour.
- ☐ **`ensureDeployment` ignores `res.ok`** — a failed deployment trigger still reports
  `state:"deploying"`, so the build poll spins forever with no terminal error.

---

## ☐ Cleanup owed

- ☐ **Test wreckage under `datadefine`:** repos `test`, `star-real-estate`, `blah-blah`
  (all three carry the WRONG identity in `main` — they predate the race fix), `aaaaaa`
  and `bbbb`, plus their Pages projects. `star-real-estate`'s project is the zombie:
  linked repo, no connection behind it. As of 2026-07-25 `gh api users/datadefine/repos`
  lists only `bulk-labeling`, and neither `aaaaaa` nor `bbbb`'s derived `.pages.dev`
  resolves — so most of this may already be gone. Confirm before hunting.
  **Keep `define-media-group`** — it's the live MCP test tenant.
- ☐ Delete `dsottimano/lanza-deploytest-11556` + the two `lanza-deploytest-*` Pages
  projects.
- ☐ **Delete the nested `lanza/lanza-broker` checkout.** It no longer holds anything
  unique now that the AS is on canonical — only the stale scope trim noted above, which
  should be re-derived rather than reused. Keeping it around is how the AS got stranded
  in the first place.
- ☐ **Rotate secrets pasted or screenshotted in earlier sessions:** the exploratory CF
  API token, the broker `OAUTH_CLIENT_SECRET` / App client secret, and the old tenant
  `GITHUB_TOKEN` (now unused on prod). Broker private keys are already Secret type.
  Procedure + blast radius: `docs/keys-and-secrets.md` §7.
- ☐ Drop test post `content/posts/es/test.md` via the CMS if unwanted (it publishes).
- ☐ Sweep the word "dogfood" out of the repo (~16 places: `bin/lanza.mjs`,
  `functions/_lib/tenant-config.ts`, `docs/lanza-site-extraction-plan.md`,
  `admin/src/help/09-onboarding-and-hosting.md`, others). Say "the site we run on Lanza".

---

## ☐ Backlog / deferred (genuinely open, not blocking)

- ☐ **MCP: the wrong-GitHub-account failure is invisible.** Hit for real on 2026-07-25.
  The tenant returns a precise `403 "Forbidden: not the site owner."`, but the MCP client
  shows only *"Got new credentials, but lanza rejected them on reconnect"* and loops —
  never naming the account used or hinting the account is the problem. Anyone with two
  GitHub logins hits this, and GitHub silently reuses the live session so re-authenticating
  changes nothing. Options: pass GitHub's `login`/`prompt` hint from `/api/oauth/authorize`,
  surface the offending login in the 403 body, or have the AS refuse to mint a token whose
  login can't own the requested `resource` (fail at consent, where the user can act, rather
  than at the tenant). Note the broker can't know `adminLogin` without asking the tenant —
  the cheap version is the better error message.
  **Largely solved on the multi-site endpoint**, which fails at consent by construction:
  wrong account → the picker is empty and names the login it signed in as. The gap is now
  only the single-site endpoint. `listUserSites` also disproves the "broker can't know
  `adminLogin`" note above — it reads each repo's `lanza.config.json`.
- ☐ **Wizard: GitHub-account gate before step 1** — non-technical users may not have a
  GitHub account, and "Connect GitHub" with none is a dead end. Ask first → No opens
  `github.com/signup` in a new tab; Yes proceeds. Frame GitHub as "the free account that
  stores your site's content." `lanza-broker/index.html` step "github".
- ☐ **Wizard: gamified progress — plane + skydiver** — replace "Step N of 5" with an SVG
  scene in the page's hand-drawn blue-arrow aesthetic: a plane climbing across steps
  1–4, skydiver jumping on step 5 (deploy→land-in-/admin). Honor `prefers-reduced-motion`.
- ☐ **MCP media/image upload tool** (deferred from v1 — content tools only).
- ☐ **MCP self-host story** — without a broker there's no OAuth AS; document or provide
  an authless/bearer mode.
- ☐ **`@lanza/site` extraction P4/P5** — deferred post-v1 (v1 ships a fat template repo,
  design §11.4). P4: thin content-only tenant repo + publish `@lanza/site`. P5: stable
  pointer + safe-revert + "update available" banner. Recover from
  `docs/lanza-site-extraction-plan.md` + git history.
- ☐ **Variables page in Settings** — site-wide `{{ placeholders }}` for templates and the
  header/footer builder (the clean fix for wanting a computed year instead of a raw
  `<script>`, which the engine emits verbatim and the preview sandbox blocks).
- ☐ **Taxonomy-rename referential integrity** — renaming a category/tag/author slug
  doesn't rewrite posts referencing it. Needs a reference sweep or a guard.
- ☐ **Slug-collision UX** — renaming onto an existing slug fails with a raw GitHub 422;
  wants a pre-flight check.
- ☐ **Preview brand accuracy** — CMS live-preview uses `site.css` defaults, not the live
  Brand overrides from `appearance.json`.
- ☐ **CMS in-place visual editing (Phase 2)** — click a rendered region → edit → write
  back to its `{{slot}}`; needs a DOM→template source-map (`data-lz-path`).
- ☐ **Admin dark mode** — mixes CSS vars with hardcoded `text-zinc-*`/`bg-white` across
  ~36 files; needs a var-ification sweep first.
