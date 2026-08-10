# Security TODO — fewer moving parts

**Written 2026-08-09.** A first-principles pass over the auth architecture, plus the
work it implies. Companions: `security-model.md` (**authoritative on authz**),
`keys-and-secrets.md` (the credential inventory this cites throughout).

> **The thesis in one line:** the only question the whole auth system exists to answer
> is *"may this GitHub user write this repo?"* — and GitHub already answers it,
> authoritatively and instantly. Almost everything we hold a secret for is a
> re-implementation of that answer.

**Updated 2026-08-09: the migration is approved.** §0 records the decision and the
choices that shape it; **§10 is the target design** and is authoritative for the work.
§1–§9 are the reasoning that got there, kept as written.

---

## 0. START HERE — status and next steps

**Session of 2026-08-09 ended here. Nothing in the product was changed by any of this
work — the experiments were a throwaway repo and a prototype. `main` is clean.**

### What is settled (all tested live, not assumed — see §3)

| Question | Answer |
|---|---|
| Can the CMS log in with no secret? | **Yes** — GitHub Device Flow |
| Can it refresh with no secret? | **Yes** — so zero secrets, permanently |
| Who may edit? | GitHub — `permissions.push` |
| Who may publish? | GitHub knows (`permissions.admin`) but **cannot enforce it** on a free private repo |
| Is the token safely bounded? | **Yes** — installation ∩ user permission. 2 writable repos out of 33 owned |
| Can a browser do this alone? | **No** — `github.com/login/*` sends no CORS. Zero-**secret**, not zero-**server** |

### The decision — MADE 2026-08-09. We migrate.

Owner's call, recorded with the three choices that shape it:

| Question | Decision |
|---|---|
| Login UX — device code instead of one click | **Accepted.** See the correction below: it is once per browser, not once a day |
| Editors | **GitHub collaborators, CMS-enforced.** An invited editor must actually be able to write the repo. §10.3 states the limit this carries |
| Scope | **Everything §4 lists** — CMS, MCP, `FANOUT_SECRET`, the bot PAT. §10.7 corrects one item that cannot in fact be deleted |
| A third role? | **Viewer, where GitHub can express it** — org-owned repos only. §10.2 |

**The target design is §10.** Read it before writing any code. Phases are §10.8;
each ends at a green `npm test` (baseline: 134 functions + 91 admin).

> **Correction to an earlier framing.** The 8-hour token does *not* mean an 8-hourly
> device code. GitHub fixes that TTL and it is not ours to extend — the only App
> setting that touches it *disables* expiry entirely, which yields a permanent
> `ghu_` token and **no refresh token at all**, strictly worse. It does not matter:
> refresh happens server-side and silently, and §3 measured a *fresh* 184-day
> refresh token coming back from each refresh. The window slides, so **a person who
> opens the CMS at least once every 184 days enters a device code exactly once, per
> browser, ever.**

### Do these regardless — they are small and unrelated to the migration (§6)

- [ ] Rotate the credentials `keys-and-secrets.md` §7 lists as owed
- [ ] Point the bot's `GITHUB_TOKEN` at `staging`, not `main`
- [ ] Purge the Cloudflare cache so the deleted `/hgjhg/` stops 200-ing
- [ ] Scope down the local `gh` PAT (`admin:org`, `admin:enterprise`, `delete_repo`)

### One live gap shipped on 2026-08-09 — decide before it bites

The **People panel is deployed** and says nothing about the fact that **removing an
editor does not lock them out for up to 7 days** (sessions cannot be revoked, §7).
Either surface that in the panel or fix the underlying gap. This is the only item
here where the current UI actively misleads a user.

### Where the prototype is

`prototype/device-cms/` — `node prototype/device-cms/server.mjs` → localhost:4400.
Runs against `dsottimano/dave-test`. Holds no secret. Not shipped (absent from
`package.json` `files[]`). Safe to delete once the direction is decided.

---

## 1. Where the risk actually is

Not in any single weakness. In **concentration**.

`keys-and-secrets.md` §6 lists three broker secrets whose leak impact is not "bad" but
*categorical*:

| Secret | Leak impact |
|---|---|
| `HANDOFF_PRIVATE_KEY` | **Total.** Forge a session for any login on any tenant — every customer site at once |
| `GH_APP_PRIVATE_KEY` | **Severe.** `Contents:write` on every repo the App is installed on |
| `FANOUT_SECRET` | **Fleet-wide.** One header + `{"apply":true}` rewrites `package.json` on every reachable repo. No rate limit, no audit trail |

The tenant side of the design is genuinely good — a tenant holds only a public key and
can only verify, so compromising a customer's site, repo or Cloudflare account yields
nothing that reaches anyone else. That property was bought by moving *all* the risk
into one Pages project. It is a defensible trade, but it means **one broker compromise
is silent, simultaneous takeover of every customer**, and no amount of hardening
changes the shape of that.

The order-of-magnitude win is not hardening the broker. It is **deleting the reason it
exists.**

---

## 2. What we assumed, and what is actually true

### Assumptions that turned out to be convention, not law

| Assumption | Reality |
|---|---|
| The CMS needs *our own* session, so we mint RS256 tokens | Convention, inherited from dropping Cloudflare Access |
| Who may edit belongs in `lanza.config.json` | GitHub already stores this, per repo |
| Owner/editor roles need implementing | GitHub has push / maintain / admin |
| "Who may publish" needs a role check | Branch protection on `main` **is** that check |
| Agents need a bespoke OAuth AS + MCP router | Content is git; `git push` is already a complete edit |
| Tenants hold no secrets, *therefore* a broker holds all of them | Non sequitur — "nobody holds them" was never priced |
| A token must never reach the browser | Half true. It stops **exfiltration**, not **use**: XSS on `/admin` can drive the same-origin proxy regardless (see the note in `frontend/lib/url.ts`) |

### Fundamental truths to build from

1. Content is plain files in git. Git is the storage, history, transport and rollback.
2. **GitHub authoritatively answers "may this person write this repo?"** — instantly
   revocable, with teams, an audit log, and 2FA/SSO enforcement we get for free.
3. Branch protection answers "may this person publish?"
4. Cloudflare Pages builds on push and serves static files unaided.
5. A static site needs no server. Every function is attack surface a static site did
   not have.
6. **A secret that does not exist cannot leak.**

---

## 3. The experiment — do this before touching anything

**One fact gates the entire direction.** GitHub's OAuth token exchange normally
requires a client secret, which is why a server exists in the auth path at all.

- [x] **Verify GitHub Device Flow works for this without a client secret.**
      **VERIFIED 2026-08-09 — secretless, blocked only by an App toggle.**

      ```
      POST https://github.com/login/device/code   (Accept: application/json)
        client_id=Iv23ct5fK2N5QtDUbzyx        → 400 {"error":"device_flow_disabled",
                                                     "Device Flow must be explicitly
                                                      enabled for this App"}
        client_id=Iv23NOTAREALCLIENTID        → 404 {"error":"Not Found"}
      ```

      The control is what makes this conclusive: a bogus id 404s, ours reaches a
      **per-App policy check**. GitHub resolved the `lanza-cms` App from the
      `client_id` alone and never asked for a secret. The flow is secretless by
      construction; the only blocker is a checkbox.

- [x] **Flip the toggle.** **DONE — confirmed 2026-08-09** by probing
      `POST /login/device/code` with the real `client_id`: it now returns a live
      `device_code` + `user_code` instead of `device_flow_disabled`. The checkbox
      was already flipped during the round-trip work below; this box was just
      never ticked.

- [x] **Complete the round trip.** **DONE 2026-08-09 — both confirmed.**

      **1. The token exchange needs no secret.** Sent `client_id` + `device_code` +
      `grant_type`, nothing else. Got a `ghu_` user-to-server token:
      `token_type: bearer`, `expires_in: 28800` (8h), `scope: ""` (empty — a GitHub
      App token carries no classic OAuth scopes; its power comes from the
      installation).

      **2. The token is DOUBLY bounded — this is the finding.**

      | | |
      |---|---|
      | Repos the account owns | **33** |
      | Repos the App installation covers | **2** (`dsottimano/lanza`, `dsottimano/dave-test`) |
      | Repos the token can **write** | **exactly those 2** |

      Write probe against the other 31 owned repos → **`403`**, despite the user
      holding `admin: true` on every one. Probe against `torvalds/linux` → `403`.
      Capability is **App installation ∩ the user's own permission**; neither alone.

      The probe was non-destructive by construction: the `PUT` omitted `content`, so
      an authorised call fails validation (`422`) and an unauthorised one fails auth
      (`403`). Nothing could be created either way. `422` = allowed, `403` = refused.

      **3. GitHub already returns the boolean `roles.ts` re-implements.**
      `GET /repos/{owner}/{repo}` →
      `permissions: {admin, maintain, push, triage, pull}`.
      `push` *is* "may this person edit". `dsottimano/lanza` → `push: true`;
      `torvalds/linux` → `push: false, pull: true`.

- [x] **Token refresh — TESTED 2026-08-09. No secret required.**

      A refresh token works immediately; there is no need to wait for the access
      token to expire. Sent `client_id` + `grant_type=refresh_token` +
      `refresh_token`, **no `client_secret`** → a new `ghu_` access token came back.

      ```
      access_token  ghu_…  expires_in                 28800  (8 hours)
      refresh_token ghr_…  refresh_token_expires_in 15897600 (184 days)
      refresh WITHOUT client_secret → SUCCESS
      ```

      **So the CMS can hold zero secrets, permanently** — not just for login, but
      for the whole token lifecycle. The last unknown is closed.

      **One honest caveat.** The refresh token lives **184 days**, so it is now the
      longest-lived credential in the design — it must sit in an HttpOnly cookie, and
      it should be treated as the thing worth protecting. It is still better than
      what it replaces: today's 7-day session **cannot be revoked at all**, whereas a
      GitHub refresh token is revoked instantly by the user from their own GitHub
      settings, or by uninstalling the App. Revocation moves from "impossible" to
      "the user can do it themselves, without us."

- [x] **Prototype built** — `prototype/device-cms/` against `dsottimano/dave-test`.
      Sign-in, `permissions.push`, and a real write to `staging` all confirmed live.

- [x] **Branch protection as the publish gate — FALSIFIED 2026-08-09.**

      Tested on a throwaway **private** repo, account plan **free**:

      ```
      POST /repos/…/rulesets                      → 403
      PUT  /repos/…/branches/main/protection      → 403
      "Upgrade to GitHub Pro or make this repository public to enable this feature."
      ```

      Both mechanisms are paid-plan-only on private repos. And tenant repos **must**
      be private (see §3a), so the target user — GitHub Free, private repo — cannot
      have either. Branch protection is not available as the publish gate.

      **What survives, and it is most of it.** `permissions` is returned on a free
      private repo:
      `{"private":true,"permissions":{"admin":true,"maintain":true,"push":true,…}}`

      So GitHub still *answers* both questions; it just cannot *enforce* the second
      one for free tenants:

      | Question | Answered by | Enforced by |
      |---|---|---|
      | May this person edit? | GitHub — `permissions.push` | GitHub (the token is bounded) |
      | May this person publish? | GitHub — `permissions.admin` | **us**, a one-line check before `POST /merges` |

      This is still the win. The lists go away — no `adminLogin`, no `editors`, no
      invite panel, no publish-then-rebuild delay, no 7-day revocation lag. What is
      left is a single call asking GitHub "is this person an admin on this repo?"
      before allowing a merge. `roles.ts` collapses from a path/branch/tree policy
      engine into that one question.

- [ ] **Decide where the token lives.** This is the one real tension: the user's own
      token in the browser reintroduces exfiltration risk that the HttpOnly cookie +
      proxy currently prevents. Likely answer: **keep the thin same-origin proxy,
      delete the identity system.** The proxy stops being a policy engine and becomes
      a header-attacher; GitHub's own permissions bound what the token can do.

---

## 3a. Tenant repos must be private — and that is what constrains the design

The platform is open source. A tenant's **content** is not, and conflating the two is
how drafts end up world-readable.

| What leaks in a public tenant repo | Why it matters |
|---|---|
| **Drafts** | `draft: true` is the publish gate. In a public repo an unpublished post is readable **the moment Save is pressed** — embargoed announcements, unannounced pricing, a post naming a client. A CMS whose "unpublished" is publicly readable is not offering unpublished |
| The `staging` branch | Every save lands there, so Save silently means "readable by anyone" |
| Git history | Deleting a page does not unpublish it. On a public repo there is no undo, including for something written in error or about a person |
| `lanza.config.json` | `adminLogin` + `editors` is a precise list of whose account to phish |
| Media uploads | Land in the repo whether or not any page references them |
| Commit author emails | Exposed on every commit |

**Therefore tenant repos default to private** — which is exactly why the branch-
protection result above is disqualifying rather than a detail.

> **`dsottimano/lanza` stays PUBLIC** — decided 2026-08-09. It is the product repo and
> being open is the point. The consequence is accepted knowingly: **our own drafts are
> world-readable**, and `docs/` publishes a detailed map of the auth surface (no
> secrets — verified — but a map). Do not put anything in this repo that is not meant
> to be read.

---

## 4. What this deletes if it holds

Migration by **deletion**, which is the cheapest kind:

- `HANDOFF_PRIVATE_KEY` and the entire handoff/session system (`functions/_lib/session.ts`,
  `functions/admin/api/auth/*`)
- `adminLogin`, `editors`, `functions/_lib/roles.ts`, and the People panel
  — **including the role work shipped 2026-08-09.** It is a re-implementation of
  GitHub Collaborators with strictly worse properties (see §5).
- The 7-day unrevocable session, and the revocation gap with it
- The MCP OAuth AS: consent screen, refresh rotation, `sites` claim, the router
- `FANOUT_SECRET`
- The bot's standing PAT
- Most of the `gh-proxy` allowlist — a user's own token is already bounded by GitHub

**Keep, unchanged — these are right:** static-only output, git as the database, no
D1/R2 for content, per-request short-lived tokens, the tenant holding no signing key,
onboarding as a one-time wizard (out of the *runtime* auth path).

---

## 5. Today's role work, judged honestly

The owner/editor feature shipped on 2026-08-09 (`4e85138`, `eefb8a1`) works and is
tested — 29 adversarial cases covering the real bypasses (an absent `branch` meaning
production; git-data trees naming `lanza.config.json`; `content\..\data/site.json`
defeating a prefix check). None of that is wasted: **those same bypasses exist in any
design where we, not GitHub, decide who may write what.**

But measured against GitHub-native, it loses on every axis:

| | Shipped today | GitHub-native |
|---|---|---|
| Invite someone | edit config → publish → **wait for a rebuild** | add collaborator, **instant** |
| Remove someone | **up to 7 days** — sessions cannot be revoked | instant |
| Who may publish | `roles.ts` + 29 tests | a branch-protection checkbox |
| Audit trail | none | GitHub's |
| Teams / SSO / 2FA policy | none | inherited |

Keep it running. Do not build on it.

---

## 6. Do these regardless — independent of the experiment

Unconditional, cheap, and owed now.

- [ ] **Rotate the credentials `keys-and-secrets.md` §7 still lists as owed:**
      the broker `OAUTH_CLIENT_SECRET`, the exploratory Cloudflare API token, and the
      old tenant `GITHUB_TOKEN`. The doc's words: *"were pasted or screenshotted in
      earlier sessions. Rotate them."* Still outstanding.
- [ ] **Point the bot's `GITHUB_TOKEN` at `staging`, not `main`.** It is the only
      long-lived standing repo-write credential in the system and it currently targets
      the branch Astro builds from. `keys-and-secrets.md` already recommends this; it
      is a one-line change.
- [ ] **Confirm `FANOUT_SECRET` is unset** unless a fan-out is actively running.
      Unset = 503 = the safe default.
- [ ] **Purge the Cloudflare cache** so the deleted `/hgjhg/` stops returning a stale
      200 to crawlers. It 404s correctly with a cache-buster.
- [ ] **Scope every `ALLOWED_TENANT_ORIGINS` entry to its repo** (`owner/repo=https://origin`).
      A bare origin applies to every repo.

---

## 7. Known gaps to track (from `security-model.md` §5)

Accepted decisions, not oversights — but the first one changed status on 2026-08-09.

- [ ] **Sessions cannot be revoked.** Stateless 7-day RS256 bearer, no `jti`, no
      server state. Removing a login from the allow-list does **not** invalidate
      outstanding sessions; the only kill switch is rotating `HANDOFF_PRIVATE_KEY`,
      which signs out every tenant at once.
      **This got worse today:** shipping invites made it user-visible — *removing an
      editor does not lock them out for up to 7 days*, and the People panel does not
      say so. Either surface it in that panel or fix the underlying gap.
- [ ] **The handoff token *is* the session token.** Anything that observes the handoff
      once holds a 7-day session.
- [ ] **Refresh tokens are 30-day bearers with no reuse detection.** Rotation is
      single-use, but nothing invalidates the live chain when a replay is seen.

---

## 8. Public-page accuracy

`/architecture` claims the broker holds the secrets and every other piece holds none.
True for a **managed** tenant's six pieces, but two caveats are unstated:

- [ ] **The Telegram bot holds secrets**, including that standing `GITHUB_TOKEN`. It
      is not one of the six pieces, so the table is not wrong — but "the broker holds
      all of them" is not the whole picture for lanzacms.com.
- [ ] **A self-hoster holds `GITHUB_TOKEN` and Cloudflare credentials.** The "No"
      column is true for managed hosting only.

Fix: qualify the row as *managed* hosting and footnote self-hosting.

---

## 9. Honest sizing

Not 100x. Roughly:

- **Secrets:** ~12 broker + 1 bot PAT + 1 keypair → **1, possibly 0**
- **Worst case:** from *every customer taken over silently and simultaneously* → *one
  login flow phished*
- **Revocation:** from *rotate the fleet key and sign out every tenant on earth* →
  *remove a collaborator*

An order of magnitude in parts, and a **categorical** change in blast radius. That is
the win, and it comes from deleting code rather than writing it.

---

## 10. The target design — authoritative for the migration

**Written 2026-08-09, after the decision in §0.** This is what we are building
toward. `security-model.md` stays authoritative for what is *deployed*; this
describes what replaces it, and does not become true until the phases in §10.8 land.

**The thesis, restated as a design rule:** *GitHub is the identity system.* We do not
mint tokens, keep lists of people, or answer "who is this" — we ask, cache the answer
briefly, and enforce our own product policy on top of it.

### 10.1 The auth path

Six steps, no secret at any of them.

| # | Step | Who holds what |
|---|---|---|
| 1 | Unauthenticated `/admin` renders a **sign-in screen** (not a redirect — device flow has nowhere to redirect to) | — |
| 2 | `POST /admin/api/auth/device/start` relays to `github.com/login/device/code` with `client_id` only; returns `user_code` + `verification_uri`, and keeps the **device code server-side in an HttpOnly cookie** | `client_id` is public |
| 3 | The person enters the code at `github.com/login/device` | GitHub authenticates them |
| 4 | `POST /admin/api/auth/device/poll` relays to `github.com/login/oauth/access_token`; on success sets **two HttpOnly cookies** and returns neither to JS | tenant holds them per-browser, not per-site |
| 5 | The proxy attaches the access token to every GitHub call | browser JS never sees a token |
| 6 | On a `401` from GitHub, the proxy refreshes once (`client_id` + `grant_type=refresh_token`, **no secret**), re-sets both cookies, retries | refresh rotates → sliding window |

**Where the tokens live** — the question §3 left open:

```
lanza_gh          ghu_…  Max-Age 28800     (8h)    HttpOnly Secure SameSite=Lax Path=/admin
lanza_gh_refresh  ghr_…  Max-Age 15897600  (184d)  HttpOnly Secure SameSite=Lax Path=/admin
```

`Path=/admin` keeps both off every cached public route, exactly as `lanza_session`
does today. The refresh token becomes the most valuable thing in the design and is
treated as such — it is never returned to the page, never logged, and only ever sent
to `github.com`. It is still better than what it replaces: today's 7-day session
**cannot be revoked at all**, whereas this is revoked instantly by the user from
their own GitHub settings, or by removing them as a collaborator.

**Why a server still exists** (§3's CORS finding): `github.com/login/*` sends no
`Access-Control-Allow-Origin`, so the browser cannot do steps 2, 4 or 6 itself.
**Two** thin relays and a token-attacher — step 6 happens *inside* the proxy, which
already has the request in hand and can append `Set-Cookie` to its own response, so a
third `/refresh` route would be an endpoint nothing calls. Zero-**secret**, not
zero-**server**.

**The device code never reaches the page.** `/start` puts it in an HttpOnly cookie and
returns only what a human reads off the screen; `/poll` takes it from that cookie and
ignores the request body. Without that binding, someone could approve a flow with
their OWN GitHub account and feed the code to a victim's browser — signing that
browser in as the attacker, who then receives whatever the victim writes. It is the
device-flow shape of a login CSRF, and it is why this differs from the prototype,
which passed the device code through the page.

### 10.2 Roles come from GitHub's own booleans

`GET /repos/{owner}/{repo}` → `permissions`. No lists, anywhere.

| GitHub says | Lanza role | May |
|---|---|---|
| `admin: true` | **owner** | everything — publish, settings, templates, Cloudflare |
| `push: true` | **editor** | content only, working branch only |
| `pull: true` only | **viewer** | read-only `/admin` |
| no access | — | `403`, and the token could not write anyway |

**On the viewer role.** GitHub's API reference is explicit that the collaborator
`permission` parameter is *"Only valid on organization-owned repositories"*, default
`push` — so on a **personal-account** repo every collaborator gets write, and a
viewer cannot be expressed there. It costs nothing to read the boolean, so we do:
the role is correct the day a tenant repo is org-owned, and simply never occurs
before then. We do not simulate it with a list of our own — that is the exact move
this migration exists to stop.

**Caching.** One `GET /repos` per request is a round-trip we do not need. Cache the
permissions per isolate, keyed by a hash of the access token, **60-second TTL**.
That makes removal-of-access take effect in ≤60s — against 7 days today.

### 10.3 Publish, and the limit we are accepting

Owner-only publish is **one call before `POST /merges`**: `permissions.admin`.
`roles.ts` collapses from a policy engine into that question plus the editor write
rules it already enforces.

State this plainly wherever it is user-visible, because it is a real change:

> An editor is a repo collaborator, so they hold genuine write access to the
> repository. The CMS refuses to let them publish. **Git does not.** An editor who
> wants to can `git push` to `main` from a laptop and bypass every check here.

Branch protection would close it and is **paid-plan-only on private repos** (§3,
falsified live), and tenant repos must be private (§3a). So on GitHub Free this is
enforced by the CMS and advisory at the repo. That is the honest description, and it
is the trade the owner accepted: an invited editor must actually be able to edit, and
someone you hand repo write to is someone you already trust.

### 10.4 What the proxy keeps — it is demoted, not deleted

**Keeps** (each earns its place):

- **Attaching the token from an HttpOnly cookie.** The whole reason the browser
  never holds a durable credential. XSS on `/admin` can still *drive* the proxy while
  the page is open — true today too, and stated in `frontend/lib/url.ts`.
- **Repo confinement** — `upstreamPath` + `upstreamTargetAllowed`. A user token is
  bounded to *installation ∩ their permission*, which can be more than one repo; this
  pins this site's proxy to this site's repo.
- **The method+path allowlist.** §4 guessed most of it would go. It should not: with
  editors enforceable (§0), path checks are load-bearing anyway, and the allowlist is
  what keeps an XSS-driven call to something the CMS never does from reaching GitHub.
- **`roles.ts`'s editor write rules** — content-only prefixes, working-branch-only,
  `POST /merges` refused, tree entries checked, dot-segment and multi-round
  percent-decoding defences. **All 29 adversarial cases survive**, because §5 is right
  that those bypasses exist in any design where we decide who writes what — and we
  still do.
- The CSRF origin check and the `/admin` security headers.

**Drops:** the broker mint round-trip (`broker-token.ts` and invariant I2 with it —
there is no second credential to escalate *to*), the standing `GITHUB_TOKEN` PAT
fallback, RS256 session verification, and `resolveRole`'s list lookup.

### 10.5 What is deleted

- `HANDOFF_PRIVATE_KEY`, `HANDOFF_PUBLIC_KEY`, `functions/_lib/session.ts`,
  `functions/admin/api/auth/{login,handoff}.ts`, `functions/_lib/broker-token.ts`
- `adminLogin` and `editors` from `lanza.config.json`; `admin/src/backend/access.ts`'s
  list handling; **`PeopleView.vue` becomes a link to GitHub's collaborators
  settings** — GitHub's UI *is* the invite panel, and it is instant
- The 7-day unrevocable session, and the §7 revocation gap with it
- The MCP OAuth AS: consent screen, refresh rotation, `sites` claim, the router
- `FANOUT_SECRET` and its endpoint

### 10.6 MCP

Device flow is *designed* for input-constrained clients, so MCP uses the same
`client_id` and the same flow: the client obtains its own `ghu_` token and sends it
as the bearer; `functions/api/mcp.ts` validates it by asking GitHub the same
`permissions` question as §10.2. The audience/`sites`/`typ` machinery exists to stop
one broker-signed token being mistaken for another family — with no minting, there
are no families, and the whole class of confusion in `session.ts`'s long comment
disappears rather than being defended against.

### 10.7 What survives, and one thing §4 got wrong

**Survives, correctly:** static-only output, git as the database, no D1/R2 for
content, the tenant holding no signing key, onboarding as a one-time wizard.

**The broker does not go away — it leaves the *runtime* path.** It still holds
`GH_APP_PRIVATE_KEY` to create a repo and install the App, and Cloudflare credentials
to create a Pages project. That is onboarding, once per tenant, not per request.

**Two secrets §4 implies are deletable, and are not:**

1. **The bot's `GITHUB_TOKEN` cannot be eliminated.** The bot is an unattended
   Worker with no user present; device flow needs a human at a browser. A machine
   that writes a repo has to hold something. It can be *scoped* and *pointed at
   `staging`* (§6) — that is the whole available win, and §4's "delete the bot's
   standing PAT" overstates it.
2. **The tenant still holds `CLOUDFLARE_API_TOKEN`** for `/admin/api/cf/*`. §1's
   "a tenant holds only a public key" was never true for a tenant with hosting
   controls wired up.

Final inventory: broker ~2 (onboarding only), tenant 1 (Cloudflare), bot 3. From
~12 + 1 + a keypair — and, more to the point, **nothing left whose leak is
fleet-wide**.

### 10.8 Phases

Each ends green on `npm test`. Nothing is deleted until its replacement is proven
live, so no phase can sign anyone out mid-flight.

| # | Phase | Done when |
|---|---|---|
| 1 | Add the device relays + cookies. Change nothing else | **DONE — see §10.9** |
| 2 | Gate reads GitHub `permissions`; roles resolve from booleans. **Both** cookie families accepted | An RS256 session and a `ghu_` cookie both open `/admin` |
| 3 | Proxy uses the user token; drop the broker mint and the PAT fallback | Editor + owner writes work; the 29 cases still pass |
| 4 | **Delete** §10.5's CMS half. Everyone re-authenticates once | Grep finds no `HANDOFF`, no `adminLogin` |
| 5 | MCP to device flow; delete the AS | MCP writes against `dmg`, not lanzacms.com |
| 6 | `FANOUT_SECRET` endpoint → a local operator script; bot scoped to `staging` | Fan-out runs from a laptop with the operator's own credentials |
| 7 | Rotate what remains (§6); update `security-model.md`, `keys-and-secrets.md`, `/architecture` (§8) | Docs describe the deployed system again |

**Testing constraint to solve in phase 1:** a Pages **preview** cannot host a login —
`productionOriginIfPreview` bounces all of `/admin` to production, deliberately. So
phases 1–3 verify against local dev + a test repo, and only phase 4's cutover touches
a live tenant. `dmg` (datadefine-owned) is the tenant-side test target, never
lanzacms.com.

### 10.9 Phase 1 — status

**Shipped 2026-08-09.** Additive only: nothing existing changed behaviour, and the
old auth path is untouched and still the only thing that authorises anything.

- `functions/_lib/device-flow.ts` — the whole flow as a pure, runtime-neutral module
  (the `gh-proxy.ts` pattern), so dev and prod cannot drift when phase 3 wires it in
- `functions/admin/api/auth/device/{start,poll}.ts` — the two relays
- `functions/_lib/device-flow.test.mjs` — 20 tests; `admin-gate` gains 5
- **`npm test` green: 154 functions (was 134) + 91 admin. `tsc --noEmit` clean.**

**Verified live against GitHub:**

| | |
|---|---|
| App toggle | Device Flow **enabled** — real `device_code` + `user_code` returned |
| `/start` request shape | Accepted; `client_id` the only field sent |
| `/poll` request shape | **~60 live polls** answered `authorization_pending`. A malformed or secret-requiring request returns `invalid_request` / `incorrect_client_credentials` instead, so this confirms the exact three-field, secretless body is what GitHub expects |
| `permissions` on the test repo | Present and complete — the §10.2 role source, confirmed on `dsottimano/dave-test` |

**Round trip VERIFIED END TO END in this code, 2026-08-09.** Not the ad-hoc script
of §3 — `functions/_lib/device-flow.ts` itself, against the real App and
`dsottimano/dave-test`:

```
poll    → ghu_… (40 chars)  expires_in 28800 (8h)
          ghr_…             refresh_token_expires_in 15897600 (184d)
who     → dsottimano
repo    → 200  permissions {admin,maintain,push,triage,pull: true}  → role: owner
refresh → NEW ghu_, refresh token ROTATED, window back to 184 days  ← it slides
          the refreshed token still authenticates: true
cookies → lanza_gh (Max-Age 28800) · lanza_gh_refresh (Max-Age 15897600)
          lanza_gh_device cleared
secrets used: 0
```

Every claim §10 rests on is now measured rather than argued: secretless login,
secretless refresh, rotation, the sliding window, and `permissions` as the role
source. **Phase 2 is unblocked.**

**Two design changes made while building, both in §10.1:** two relays rather than
three (the proxy refreshes inline; a `/refresh` route would be dead code), and the
device code is now bound to the browser in an HttpOnly cookie instead of passing
through the page as the prototype did.
