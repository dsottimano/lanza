# Lanza — `@lanza/site` extraction plan (rental model + update control)

**Status:** design decision-complete (2026-07-04); Phase-0 spike pending before code.
Supersedes the "everyone builds against a floating `stable`, we press rebuild"
sketch in `onboarding-broker-design.md` §6 — that was *forced* auto-update; Dave
chose customer-controlled updates (see §2).

## 1. Why (the problem this solves)

`/generate` gives each tenant a **frozen photocopy** of the whole repo. No upstream
link → when we fix a CMS/site bug, existing tenants never get it. Every tenant is a
stranded fork; patching a bug means committing into N repos by hand. Doesn't scale
past the dogfood.

**Fix (the "rental"):** the tenant repo holds **content only**; all code (Astro site
+ Lanza admin + Pages Functions) ships as a versioned npm package **`@lanza/site`**,
pulled at Cloudflare Pages build time. Fix core once → publish a version → tenants
move to it. This is Phase 4 of the onboarding design, now the active workstream, and
it carries **Thread #2 (per-tenant identity)** with it (see §6) — identity is
per-tenant *content*, so it belongs in the thin repo, which is exactly the seam the
split needs anyway.

## 2. Update control (the safeguard) — DECIDED: pinned + notify

The version pin lives in the **tenant's own `package.json`** (in their repo, which
the CMS already writes to via the broker proxy). That one line is the control knob.
Default posture: **exact pin, notify-only, never auto-apply.**

| Customer wants | Mechanism |
|---|---|
| **Don't update** | Exact version pinned (`"@lanza/site": "2.3.1"`) + lockfile committed. Our releases never touch them. |
| **Update** | CMS shows "v2.4.0 available → [Update]". Click writes `2.4.0` to their `package.json` + rebuilds. Same write path as saving a post. |
| **Update & revert** | Every npm version is immutable (2.3.1 never disappears). Revert = write the old number back + rebuild. Git already records it; reuse the CMS's existing revert machinery. |

- **No new infrastructure** — update control is the CMS committing one line to a file.
- We publish a **"latest stable" pointer** (npm dist-tag or a tiny JSON the CMS
  fetches) *only* so the CMS knows an update exists — **not** what tenants build against.
- **Revert caveat:** code reverts cleanly; content written under a newer version may
  not be readable by older code if the *data format* changed. So tag each release
  `safe-revert: true|false`. Bugfix/CSS/render → safe. Data-format change → one-way
  (CMS hides revert). Publish this flag alongside the version in the stable pointer.

## 3. The two repos

**Tenant repo (thin, per-customer) — content + config only:**
```
tenant-repo/
  package.json              → depends on @lanza/site@x.y.z; build = "lanza build"
  package-lock.json         → committed (pins the exact tree)
  lanza.config.json         → { owner, name } — repo identity (Thread #2), broker-written
  content/                  → posts/ pages/ authors/ categories/ tags/   (was frontend/content/)
  data/                     → site.json appearance.json menu.*.json seo.*.json schema.json redirects.json
  public/images/uploads/    → CMS media
  functions/_lib/tenant-owner.ts → ADMIN_LOGIN (broker-written)  [see §6 open Q]
```

**`@lanza/site` (shared, versioned) — all code:**
```
@lanza/site/
  frontend/  components/ layouts/ lib/ pages/ styles/ presets/   (NO content/, NO data/)
  admin/     the Vue CMS (builds to public/admin/)
  functions/ gh-proxy.ts session.ts cf-proxy.ts tenant-config.ts + admin/api routes
  scripts/   gen-content-config.mjs gen-redirects.mjs + theme toolchain
  themes/    packed default/ocean design bundles
  bin/lanza  CLI: `lanza build`, `lanza dev`  (§4)
  astro config factory
```

Classification detail lives in the discovery inventory; the load-bearing rule:
**everything under `frontend/data/` and `frontend/content/` + `public/images/uploads/`
is tenant surface; everything else is code.** `data/schema.json` is tenant data with
a code-provided default (CMS content-type editor rewrites it per tenant).

## 4. The mechanism — how code + content recombine at build

**VALIDATED (from Astro 7.0.3 source, `content/loaders/glob.js:165`):**
`baseDir = new URL(globOptions.base, config.root)` — content `base` resolves against
Astro **`root`** (the tenant repo / cwd), *not* `srcDir` and *not* the package
location. So content in the tenant repo is reachable by package code. This is the
crux and it holds.

`@lanza/site` ships a `lanza` CLI that owns the Astro project and injects the tenant's
content/data. `lanza build` (tenant's `package.json` build script) does:

1. Read the tenant's `data/site.json` + `data/schema.json` from **cwd**.
2. Run `gen-content-config.mjs` → write `content.config.ts` with each collection's
   `base` pointing at the tenant's `./content/<coll>` (was `./frontend/content/<coll>`).
3. Run `gen-redirects.mjs` → tenant `data/redirects.json` → `public/_redirects`.
4. Run `astro build` with **root = tenant cwd**, **srcDir = the package's `frontend/`**,
   feeding tenant `data/` in via config (not bundled relative imports — see §5).

`lanza dev` mirrors this for local work (replaces today's `scripts/dev.mjs`).

## 5. Seams to fix (each = a path indirection)

| # | Seam | Fix |
|---|---|---|
| 1 | `content.config.ts` `base: "./frontend/content/posts"` | ✅ validated. Generator emits `base` → tenant `./content/<coll>`; resolves against Astro root (tenant cwd). |
| 2 | `srcDir: "./frontend"` (code) vs content in tenant repo | Astro `root` = tenant cwd; `srcDir` = package `frontend/`. Content decoupled via #1. **Spike confirms srcDir-into-package + generated `content.config.ts` placement.** |
| 3 | `astro.config.mjs` reads `./frontend/data/site.json` at build | Config factory in package reads `data/site.json` from cwd. |
| 4 | Bundled data imports in code: `i18n.ts` `import site from "../data/site.json"`; `Base.astro` `import appearance`; `site.ts` `import.meta.glob("../data/menu.*.json")` | Replace compile-time JSON imports with a build-time loader reading the tenant `data/` dir (Vite alias/virtual module → cwd `data/`). Mechanical but touches several files. |
| 5 | `admin/src/schema.ts:20` imports `../../frontend/data/schema.json` as boot seed | Ship a default `schema.json` inside the package as the seed; runtime still overlays the tenant's live copy via the proxy (already does). |
| 6 | Codegen scripts write across trees | Scripts (in package) read tenant `data/` from cwd, write config/`_redirects` where Astro reads them. |
| 7 | Hand-mirrored files (`theme-fileset` ↔ admin, `gen-redirects` ↔ `redirect-rules.ts`, etc.) | All are code → all land in the package together; the mirror couplings stay internal (no cross-repo drift). |

## 6. Thread #2 (per-tenant identity) folded in

Currently hardcoded to `dsottimano/lanza` in two places:
- `functions/_lib/gh-proxy.ts:11-12` — `OWNER`/`NAME`
- `admin/src/backend/config.ts` — `REPO`

Both are **code** (they move into the package), so they can't hold per-tenant values.
Move identity into tenant content: **`lanza.config.json` = `{ owner, name }`** at the
tenant repo root. Package code reads it:
- `gh-proxy.ts` reads it server-side (Pages Function has fs/env access to the deployed
  tenant repo — or the broker injects it as an env var at deploy; **decide in spike**).
- The admin SPA is bundled at build → its `REPO` must be injected at `lanza build`
  time from `lanza.config.json` (Vite `define`), so each tenant's admin build carries
  its own repo. **This is the "admin bundled at build" gotcha from the TODO.**

Broker writes `lanza.config.json` at repo creation (like it already writes
`tenant-owner.ts`). **Open Q:** collapse `tenant-owner.ts` (ADMIN_LOGIN) into
`lanza.config.json` too, so the broker writes one identity file, not two. Leaning yes.

Second half of Thread #2 — **install the `lanza-cms` App on the new repo during
onboarding** (design §4 step 3, still unbuilt; dogfood was installed by hand) — is
independent of the split; do it in the broker whenever.

## 7. Phased build order (each phase verifies before the next)

- **P0 — Spike. ✅ PASSED (2026-07-04).** Throwaway: `@lanza/site` (frontend/ +
  content.config.ts) symlinked into a tenant dir's `node_modules`; tenant holds
  `content/` + `data/`; `astro build` from the tenant cwd produced
  `<h1>SPIKE-OK site=TenantSiteName</h1><li>POST:HelloFromTenantContent</li>` (exit 0).
  Confirms all three unknowns at once: **#2** srcDir → `node_modules/@lanza/site/frontend`
  (Astro accepts srcDir under node_modules); **#1** content `base: "./content/posts"`
  resolves against tenant root, not the package; **#4** tenant data via
  `readFileSync(join(process.cwd(), "data/site.json"))`. The rental mechanism is proven.
  Spike lives in the session scratchpad. **Next: P1.**
- **P1 — Restructure in place. ✅ DONE (2026-07-04, branch `feat/lanza-site-extraction-p1`).**
  `frontend/content/` → `content/`, `frontend/data/` → `data/` at repo root; ~25 refs
  repointed (not the "~7" first estimated). Two commits: **P1a** Astro render side
  (config/scripts/schema.json/lib/layouts; data imports use root-relative `/data/*`),
  **P1b** CMS write-paths + theme-fileset mirror + bot `CONTENT_DIR` + comment sweep.
  `frontend/*` code prefixes + `frontend/content.config.ts` intentionally stay (they're
  code → move in P2). Verified: astro build (12 pages, test post renders from `content/`),
  admin vue-tsc + vite build. Note: 1 **pre-existing** gh-proxy test failure (stale
  `POST git/refs` assertion) unrelated to P1. Docs (README, project CLAUDE.md) still
  cite `frontend/content/posts` — update at P1 merge. Not yet merged to main.
- **P2 — Package boundary. ✅ DONE (2026-07-04).** Three commits on
  `feat/lanza-site-extraction-p1`. **P2a** `lanza` CLI + `lanzaConfig()` factory
  (absolute srcDir → package/frontend; content+data from cwd), dogfooded in-place.
  **P2b** public/ merge — platform assets (brand/favicon/social/lanza.js + prebuilt
  admin SPA) ship in the package; factory sets publicDir → package/public; `lanza
  build` overlays the tenant's public/ (uploads + generated _redirects) onto dist/.
  **P2c** packaging: CLI resolves Astro via `createRequire` (real installs hoist it);
  package.json version/files(enumerated public subdirs)/engines(node≥22)/prepack;
  `.npmignore` (ships the gitignored public/admin) + `.nvmrc`.
  **Validated the clean way — no symlinks:** `npm pack` → real tarball install into a
  fresh content-only tenant → `npm run build` → 12 pages, tenant content + prebuilt
  admin + tenant upload + generated _redirects; tarball audited (no
  content/data/source/node_modules leaks). srcDir-under-root + dep-hoisting confirmed.
  **OPEN SEAM surfaced:** `functions/` (Pages Functions) ship in the package, but
  Cloudflare Pages deploys `functions/` from the tenant *repo root*, not node_modules
  — so the tenant template needs functions/ at root (thin re-export, or `lanza build`
  copies them out). Resolve in P3 (identity touches functions anyway) or the template step.
- **P3 — Identity (Thread #2).** `lanza.config.json`; `gh-proxy`/`admin` read it;
  broker writes it; App-install redirect. Verify: dogfood edits its own repo via config.
- **P4 — Publish + thin template.** Publish `@lanza/site@x`; create the thin template
  repo (content only, depends on the package); dogfood cuts over to it. Verify: dogfood
  rebuilds from the published package.
- **P5 — Update UX.** Stable-pointer + `safe-revert` flag; CMS "update available" banner
  → writes `package.json` version + rebuild; revert. Verify: bump/revert round-trip.

## 7b. "What if Astro changes `base`?" — dependency risk

Not exposed, for three stacked reasons:

1. **Astro is pinned *inside* the package**, not the tenant. Package pins `astro@x`;
   tenant pins `@lanza/site@x`. A future Astro that changes `base` semantics can't
   reach a customer until *we* bump Astro in the package, test, and republish — we
   catch it in our CI, once, never in a live tenant site. (The update safeguard, one
   level down.)
2. **`base` is a public, documented Content-Layer API**, not reverse-engineered
   internals. Changing "resolve relative to project root" = semver-major + deprecation
   cycle, which we only meet when *we* choose to upgrade.
3. **Root-independent fallback:** pass `base` as an absolute `file://` URL —
   `new URL(absURL, root)` ignores `root` by URL-spec rules, nothing Astro-specific
   left to break. Can adopt from day one.

Tailwind: content-from-anywhere is the *point* of Content Layer (loaders decouple
content from `src/`) — we use it as designed. Residual risk is "we leave Astro
entirely," which — because all code is in the package — is a one-place rewrite, not
N tenant repos. Real unproven bit is **seam #2 (srcDir → package)**, gated by the P0 spike.

## 8. Risks / open questions

- **P0 srcDir-into-package** is the real unknown; everything downstream assumes it works.
- **Data loader (#4)** — Vite virtual module vs `define` vs fs read; the spike picks one.
- **`gh-proxy` reading `lanza.config.json`** at runtime in a Pages Function — confirm
  the deployed function can read the repo file or needs the value as an env/`define`.
- **Node pin:** package requires Node 22 (`.nvmrc` / `NODE_VERSION`, build image v3) —
  tenant template must set it.
- **Two-file vs one-file identity** (`tenant-owner.ts` + `lanza.config.json`) — collapse?
- Keep `@lanza/site` **public** (private pkg needs per-project `.npmrc` + `NPM_TOKEN`).
