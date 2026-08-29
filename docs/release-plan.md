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

**Uninstall the App at the end of onboarding.** The broker keeps `GH_APP_PRIVATE_KEY`
to create the repo and install once; it retains nothing afterwards.

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
| 3 | **Uninstall** — `DELETE /app/installations/{id}` at the end of `onboard/setup.ts` | a finished tenant appears in no `listInstallations()` page |
| 4 | **Delete fanout** — `_lib/fanout.ts`, `api/admin/fanout.ts`, `FANOUT_SECRET` | grep finds no `FANOUT`; R3 met |
| 5 | **Build-time floor** — `lanza build` refuses below the `critical` dist-tag | a pinned-below-floor tenant fails its build with the fix named |
| 6 | **Phase 7** — rotate what remains; rewrite `security-model.md`, `keys-and-secrets.md`, `/architecture` | docs describe the deployed system again |

Steps 3 and 4 are irreversible for existing tenants: re-acquiring write means the
owner re-installs the App. That is the point.

## 5. Open

- **Orphan repo** when a user rejects the install screen (creation precedes consent).
- **Re-install path** — an owner who *wants* a forced fix has no one-click way back
  in. Decide whether that is a product feature or a support email.
