# Security TODO — fewer moving parts

**Written 2026-08-09.** A first-principles pass over the auth architecture, plus the
work it implies. Companions: `security-model.md` (**authoritative on authz**),
`keys-and-secrets.md` (the credential inventory this cites throughout).

> **The thesis in one line:** the only question the whole auth system exists to answer
> is *"may this GitHub user write this repo?"* — and GitHub already answers it,
> authoritatively and instantly. Almost everything we hold a secret for is a
> re-implementation of that answer.

This document is a direction and a set of experiments, **not an approved migration.**
Nothing here should be refactored before §3 is verified.

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

- [ ] **Flip the toggle** — GitHub App settings → `lanza-cms` → General →
      **Enable Device Flow** → Save. (Owner action; needs the App owner's login.
      If the App is org-owned it is under the org's Developer settings instead.)

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
