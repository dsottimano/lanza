# Lanza — Architecture B TODO

Turning Lanza into a WordPress replacement for non-technical owners: each tenant
owns a **thin content repo**; the CMS/site code ships as a versioned package
`@lanza/site`. Full rationale + decisions (tagged Live/Planned) live in
`admin/src/help/09-onboarding-and-hosting.md`. This file tracks the build work.

**Status legend:** ☐ todo · ◐ in progress · ☑ done

---

## 1. Content-model generator — `schema.json` → `content.config.ts`  ◐ (designing)

**The problem.** The content model is defined **twice**, hand-synced:
- `frontend/data/schema.json` (873 lines) — the CMS's source of truth. The
  content-type editor writes it. Each collection has `fields[]` with a `widget`.
- `frontend/content.config.ts` (191 lines) — Astro's Zod schemas, written by hand.
- Astro **never reads `schema.json`** (verified: no reference anywhere in
  `frontend/`). So if a tenant invents a content type in the CMS, Astro doesn't know
  the collection exists and won't build/render those files. **This breaks
  multi-tenant** — it's a core correctness bug, not just packaging.

**The fix.** Generate `content.config.ts` from `schema.json` at build time so JSON
is the single source of truth. Proposed location: `scripts/gen-content-config.mjs`
(next to `scripts/gen-redirects.mjs`), run as a build step.

**Heart of it: widget → Zod mapping.**
| CMS widget | Zod | Notes |
|---|---|---|
| `string`, `text` | `z.string()` | |
| `datetime` | `z.coerce.date()` | tolerate blank `''` → optional (Sveltia writes empty) |
| `boolean` | `z.boolean()` | + `.default(...)` |
| `image`, `file` | `z.string()` | a path today — **see media task, may change** |
| `number` | `z.number()` | |
| `select` (has `options`) | `z.enum([...])` **or** `z.string()` | OPEN DECISION below |
| `relation` | `z.string()` / `z.array(z.string())` | array if `multiple:true` |
| `object` (has `fields`) | `z.object({...})` | recurse |
| `list` (has `fields`) | `z.array(z.object({...}))` | recurse |
| `required:false` | `.optional()` | |
| has `default` | `.default(x)` | |
| collection `localized:true` | glob `base: ./content/<folder>`; ids are `<locale>/<stem>` | i18n handled in `frontend/lib/i18n.ts` |

Also emit: the glob loader per collection (`base` = the collection's `folder`), and
the shared `seoSchema` (reused by posts/pages/listings today).

**OPEN DECISIONS (need Dave):**
- **`select` strict vs loose.** Strict `z.enum` = build fails on a bad value; loose
  `z.string()` = themes can add options without breaking. Current hand file does
  BOTH (enum for `listingType`, loose for `template`). Pick a rule — likely: enum
  by default, loose when the field is theme-extendable (needs a flag in schema.json?).
- Confirm generator location `scripts/gen-content-config.mjs`.

**Verify:** `node scripts/gen-content-config.mjs` must reproduce today's
`content.config.ts` closely enough that `npm run build` yields the same site.
Prove it **in place** before any repo-splitting.

---

## 2. Media / image storage — the real scaling limit  ☐

**Why this matters (and why it may change the generator).** `schema.json` and
markdown content stay small. **Media in git does not** — images bloat the repo fast
(GitHub warns ~1GB repo, caps files at 100MB). Today uploads live at
`public/images/uploads/**`, committed to the repo. Fine for a plumber, fatal for
many image-heavy tenants.

**Target.** Media moves to **Cloudflare R2** — each tenant's own bucket, served from
R2's public domain, never through git and never through a Worker (CLAUDE.md Rule 3).

**Interaction with the generator (Dave's flag).** If `image`/`file` fields stop
storing a repo path and start storing an **R2 URL/key**, the generator's mapping for
those widgets may need to change (validate a URL? a bucket key? keep it a loose
string?). Decide the media reference format BEFORE finalizing the `image` widget
mapping in task 1 — that's the coupling.

**OPEN DECISIONS (need Dave):**
- R2 reference format in frontmatter: full public URL vs bucket key + resolve at
  render. (Affects the generator + the Astro image rendering + the CMS media picker.)
- Per-tenant bucket vs one shared bucket keyed by tenant. (Provisioning + isolation.)
- Upload path: CMS uploads straight to R2 (needs credentials/presigned URLs) vs via
  the broker. Keep it off any Worker request path where possible.
- Migration of existing `public/images/uploads/**` for the dogfood site.

**Touches:** `admin/src/backend/media.ts`, `admin/src/fields/useImageUpload.ts`,
the `image` widget in the generator, Astro image rendering, `frontend/lib/sanitize.ts`.

---

## 3. Rest of Architecture B (from the design — not yet started)  ☐

Detailed design already produced (see chat / can be regenerated). Sequenced:

- ☐ **`lanza build` CLI** — Astro can't be consumed as a pure npm dependency; the
  package ships the code tree + a build CLI that assembles the site from the
  tenant's local `content/` + `data/`. Tenant repo just runs `npm run build`.
- ☐ **Ship admin SPA prebuilt** inside `@lanza/site` (don't rebuild Vue/TipTap per
  tenant deploy).
- ☐ **Functions delivery** — `lanza build` copies `@lanza/site/functions/**` →
  `./functions` at build time (Pages reads `functions/` post-build). Smoke-test on
  one tenant before fan-out.
- ☐ **Path migration** — `frontend/content` + `frontend/data` → top-level `content/`
  + `data/` in the thin repo. Touches `admin/src/backend/config.ts`,
  `bot/wrangler.jsonc` (`CONTENT_DIR`), `gen-redirects`, gh-proxy allowlist together.
- ☐ **`@lanza/site` publish pipeline** — CI in `dsottimano/lanza`: build → typecheck
  → `npm publish` (exact versions) → `canary` dist-tag → smoke on dogfood →
  advance `stable`. Needs an npm org `@lanza` (Dave).
- ☐ **Update fan-out** — Cloudflare **Deploy Hooks** per tenant Pages project; broker
  stores them and POSTs to rebuild all when `stable` advances (code-only changes
  make no content commit, so nothing else triggers a build). Plus rollback plan.
- ☐ **Broker rework** — `lanza-broker` currently uses GitHub App `/generate` of the
  FULL repo (Administration-scoped). Change to: OAuth `public_repo` creates a THIN
  repo (one-time token, discarded) → install the `lanza-cms` App on just that repo,
  **Contents-only** (drop Administration). See `lanza-broker/functions/`.
- ☐ **gh-proxy credential model** — proxy uses a static `GITHUB_TOKEN` today. In B the
  standing credential is a per-repo App installation. Decide: long-lived
  fine-grained PAT (simple) vs proxy mints short-lived installation tokens from the
  App key on demand (cleaner, matches Contents-only App). Reuse
  `lanza-broker/functions/_lib/gh-app.ts`.
- ☐ **Cloudflare Pages provisioning** — wire the tenant's CF account (CF OAuth, like
  `wrangler login`) → create their Pages project → set env vars (`ADMIN_LOGIN`,
  token/installation, `SESSION_SECRET`). The last onboarding seam.
- ☐ **Dogfood as a thin consumer** — split `dsottimano/lanza`'s content/data into a
  new thin repo `dsottimano/lanza-site` tracking `@lanza/site@canary`; proves the
  real tenant path end-to-end.
- ☐ **lanzacms.com** currently points at the dogfood site but must become the pure
  broker/marketing origin.

---

## Already shipped (context)

- ☑ GitHub-OAuth login gate replacing Cloudflare Zero Trust (`functions/admin/_middleware.ts`,
  `functions/admin/api/auth/*`, `functions/_lib/session.ts`). Allowlist = `ADMIN_LOGIN`.
- ☑ `dsottimano/lanza` made public + template.
- ☑ `lanza-broker` repo + Pages project live (install→create-repo, App-`/generate`
  version — to be reworked per task 3).
- ☑ Onboarding & hosting doc: `admin/src/help/09-onboarding-and-hosting.md`.
