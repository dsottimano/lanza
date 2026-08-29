# Release plan — tenant sovereignty

Owner decision, 2026-08-29: **once a tenant installs, the site is theirs.** A
compromised broker must not be able to reach it.

Companions: `security-todo.md` §10 (the migration this completes),
`keys-and-secrets.md` (credential inventory), `onboarding-workflow.md` (the flow).

---

## 1. The requirement, stated as tests

A new user goes to lanzacms.com, installs, deploys, and is done. Then:

| # | Must be true | Today |
|---|---|---|
| R1 | No key, token or env var is typed by the user | ✅ (Site Health is opt-in and off) |
| R2 | One manual click survives: Cloudflare connecting itself to GitHub | ✅ unavoidable, theirs to fix |
| R3 | **A broker compromise cannot write the tenant's repo** | ❌ §2 |
| R4 | **A broker compromise cannot forge a session on the tenant** | ❌ phase 4 |
| R5 | Content leaves without us: their repo, their git history, plain files | ✅ |

R3 and R4 are the release blockers. Nothing else here is new work.

## 2. Why R3 fails today

`GH_APP_PRIVATE_KEY` lives on the broker, the `lanza-cms` App stays installed on
every tenant repo with `Contents: read/write`, and `listInstallations()` enumerates
the fleet. Repo write is site takeover: Cloudflare Pages rebuilds from that repo on
push, so control of `package.json` is arbitrary code on the customer's live site.

Two things still consume that installation:

- `functions/api/mcp.ts` (tenant) mints through the broker — phase 5 removes it
- **fanout** — the broker force-upgrading tenants below the `critical` dist-tag,
  unasked, on their repository

The CMS edit path already does not: since phase 3 the gh proxy attaches the
signed-in person's own device-flow token.

## 3. The decision

**Delete `GH_APP_PRIVATE_KEY` from the broker**, and every consumer of it.

The first idea was to uninstall the App at the end of onboarding, and it was wrong:
a GitHub App's user-to-server token only reaches repositories the App is installed
on, so a tenant's own device-flow sign-in DEPENDS on that install. The App stays
installed. What goes is anyone holding a key that can act *as* the App rather than
as a person - device flow needs only the public `client_id`.

Fanout dies with it. That is the cost, stated plainly:

| | With fanout | Without |
|---|---|---|
| Critical `lanza-site` fix reaches a tenant | on our push, no consent | on their next build, after the CMS warns them |
| Who can write a stranger's repo | us | nobody |

The replacement is what already exists (`admin/src/backend/version.ts` shows the
version warning) plus a build-time refusal below the `critical` floor. Slower, and
the owner acts instead of us. Rejected alternative: keep the install and make fanout
advisory — it leaves fleet-wide write in place, which is the thing being removed.

## 4. Order of work

Nothing is deleted before its replacement is proven live.

| # | Step | Done when |
|---|---|---|
| 1 | **Phase 4** (`security-todo.md` §0) — delete the RS256 session family | grep finds no `HANDOFF`, no `adminLogin`; R4 met |
| 2 | **Phase 5** — MCP to device flow, delete the OAuth AS | MCP writes against `dmg` with a `ghu_` bearer |
| 3 | **Delete the broker's App-key surface** — `api/token.ts`, the MCP OAuth AS, `_lib/handoff.ts`, `setup.ts`'s install check, `appJwt` | `grep env.GH_APP` finds nothing |
| 4 | **Delete fanout** — `_lib/fanout.ts`, `api/admin/fanout.ts`, `FANOUT_SECRET` | grep finds no `FANOUT`; R3 met |
| 4b | **By hand:** delete `GH_APP_PRIVATE_KEY` from the Pages project, then every private key on the `lanza-cms` App | GitHub lists no private key for the App |
| 5 | **Build-time floor** — `lanza build` refuses below the `critical` dist-tag | a pinned-below-floor tenant fails its build with the fix named |
| 6 | **Phase 7** — rotate what remains; rewrite `security-model.md`, `keys-and-secrets.md`, `/architecture` | docs describe the deployed system again |

Step 4b is the irreversible one, and it is the whole release: after it, no running
service holds anything that can write a tenant repository. Regenerating a key is
possible from the App's settings page, which means the remaining blast radius is
"someone compromises the owner's GitHub account", not "someone compromises a
Worker".

## 5. Open

- **Orphan repo** when a user rejects the install screen (creation precedes consent).
- **Re-install path** — an owner who *wants* a forced fix has no one-click way back
  in. Decide whether that is a product feature or a support email.
