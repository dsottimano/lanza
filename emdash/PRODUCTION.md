# Taking this EmDash starter to Cloudflare production

A field guide distilled from a real production deployment (La Perle Panamá, EmDash
0.19 on Cloudflare Workers + D1 + R2 + Access). Every item here cost real debugging
time — follow it and skip the pain. The starter ships Node-only for local dev; this
is the checklist to make a clone production-ready on Cloudflare.

---

## 1. CSS scoping — never let the theme bleed into the admin

**Already applied in this starter.** `src/styles/theme.css` brand tokens are scoped
to `.site` (set on `<html>` in `Base.astro`), and `Base.astro`'s dark-mode `@layer
base` blocks are scoped to `.site` too. The EmDash admin (`/_emdash`) renders WITHOUT
`.site`, so it keeps its own theme.

**The rule:** never write a bare `:root {}`, `html {}`, or `body {}` style rule in
ANY `.astro` page or layout. Astro emits bare `body`/`html`/`:root` selectors as
**global** even inside a scoped (non-`is:global`) `<style>` block — so they land in
the shared CSS bundle the admin also loads. The classic failure: a bare
`body { background: #10202a }` on a standalone page repaints the admin body dark
while its components stay light → unreadable admin. Always scope to `.site` (or a
page-specific class like `body.flow-shell`). Keep ONLY the bare `:root { --color-bg:
#ffffff … }` light defaults (the admin reads those).

Debug method when the admin looks wrong: in the admin DevTools console compare
`getComputedStyle(document.body).backgroundColor` vs
`getPropertyValue('--color-bg')`. A mismatch ⇒ a hardcoded (non-var) bare rule is
painting it; grep the built bundle for `body{...#xxxxxx` and trace to source.

---

## 2. Cloudflare adapter + bindings (conditional config)

Keep Node for local dev, switch to Cloudflare at build time via `DEPLOY_TARGET`:

```js
// astro.config.mjs
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

const isCf = process.env.DEPLOY_TARGET === "cloudflare";
let adapter, database, storage, auth, cacheProvider;

if (isCf) {
  const cloudflare = (await import("@astrojs/cloudflare")).default;
  const { d1, r2, access, cloudflareCache } = await import("@emdash-cms/cloudflare");
  adapter = cloudflare();
  database = d1({ binding: "DB", session: "auto" });
  storage = r2({ binding: "MEDIA" });
  if (process.env.CF_ACCESS_TEAM_DOMAIN && process.env.CF_ACCESS_AUD) {
    auth = access({
      teamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
      audience: process.env.CF_ACCESS_AUD,
      autoProvision: true,
    });
  }
  cacheProvider = cloudflareCache();
} else {
  adapter = (await import("@astrojs/node")).default({ mode: "standalone" });
  database = sqlite({ url: "file:./data.db" });
  storage = local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" });
}
```

`wrangler.jsonc` essentials:

```jsonc
{
  "name": "my-site",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": "./dist" },
  "workers_dev": false,                    // kills the unprotected *.workers.dev admin backdoor
  "vars": { "CF_ZONE_ID": "<zone-id>", "MEDIA_PUBLIC_BASE": "https://media.example.com" },
  "routes": [{ "pattern": "example.com", "custom_domain": true }],
  "d1_databases": [{ "binding": "DB", "database_name": "my-site", "database_id": "<id>" }],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "my-site-media" }]
}
```

Build/deploy scripts (`package.json`) — bake the non-secret CF Access identifiers in:

```json
"build:cf": "DEPLOY_TARGET=cloudflare CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com CF_ACCESS_AUD=<aud> astro build",
"deploy": "npm run build:cf && wrangler deploy"
```

> EmDash 0.19's Cloudflare build can hit a circular-import TDZ that 500s the Worker.
> Collapse emdash into one chunk: `vite.build.rollupOptions.output.manualChunks(id)`
> → return `"emdash-runtime"` when `id` includes `/emdash/` or `@emdash-cms/`.

---

## 3. Cloudflare Access (admin auth) — the gotchas

- **Self-hosted Access app**, destination `example.com` path **`_emdash`** (NOT
  `_emdash*` — a trailing `*` breaks path matching so Access stops fronting the route
  and the Worker returns bare `401 Authentication failed`). Add `www` as a second
  destination.
- **Allow policy** with your emails. Default-deny: a missing policy = locked out.
- IdP (e.g. Google) redirect URI must be EXACTLY
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`.
- **⚠️ The AUD tag rotates if you delete + recreate the Access app.** The Worker bakes
  `CF_ACCESS_AUD` at BUILD time, so after a reinstall the old AUD → every
  `/_emdash/admin` request 401s. Fix: grab the new AUD (Access → app → Overview →
  Application Audience Tag), update `build:cf`, rebuild + redeploy.
- Diagnostic: `curl -I https://example.com/_emdash/admin`. A **302** to
  `…cloudflareaccess.com/cdn-cgi/access/login/…?kid=<AUD>` = Access is fronting and
  that `kid` must equal the Worker's baked AUD. A **401** = Access NOT fronting
  (path/policy wrong).

---

## 4. Media — DON'T serve images through `/_emdash` (the #1 production trap)

EmDash core **hardcodes** content image URLs as `/_emdash/api/media/file/<storageKey>`
(in `resolveMediaReference` / `normalize` / `loader`; `r2({ publicUrl })` only affects
*upload* return URLs, not rendered content — a genuine core gap). Two failures:

1. That path is under `/_emdash`, which **Access protects** → anonymous visitors get
   302'd to login → **every public image is broken** (you only see them because
   you're authenticated).
2. Even un-gated, it's a Worker invocation + R2 read per image request.

**Fix (best): R2 public custom domain + a streaming rewrite.**

1. R2 bucket → Settings → **Public access → Custom Domains** → connect
   `media.example.com` (Cloudflare adds the DNS automatically). Images are then served
   directly by the CDN from R2 — edge-cached, no Worker, no Access.
2. Rewrite the hardcoded URLs to that domain at the project level (survives EmDash
   upgrades — no core patch). **Already wired** in `src/middleware.ts`: set
   `MEDIA_PUBLIC_BASE` (wrangler var, e.g. `https://media.example.com`) and it swaps
   `/_emdash/api/media/file/<key>` → `https://media.example.com/<key>` in
   `<img>`/`<source>`/`og:image`/icon. It's a streaming `HTMLRewriter` (no buffering),
   runs only on cache-miss renders, and no-ops when `MEDIA_PUBLIC_BASE` is unset.

Verify: `curl -I https://media.example.com/<key>` → 200, and a 2nd hit →
`cf-cache-status: HIT`.

---

## 5. Edge caching — cache everything public, hit D1/R2 only on miss

`cloudflareCache()` provider + `experimental.routeRules` (Cloudflare branch only):

```js
experimental: {
  cache: { provider: cacheProvider },
  routeRules: {
    "/": { maxAge: 300, swr: 86400 },
    "/blog/[slug]": { maxAge: 300, swr: 86400 },
    // … one entry per PUBLIC route. List static catch-all pages explicitly
    // (e.g. "/about", "/contact").
  },
}
```

Rules:
- **The provider does nothing without a route rule** — `Astro.cache.set()` no-ops on
  unlisted routes. Route rules supply `maxAge`/`swr`; pages supply `Cache-Tag`s.
- In each cached page, after queries: `if (Astro.cache?.enabled) Astro.cache.set(cacheHint)`
  using the `cacheHint` returned by `getEmDashCollection`/`getEmDashEntry`.
- Some helpers return a **bare array, no `cacheHint`** (e.g. `getEntriesByTerm`,
  `getTaxonomyTerms`). Set a manual hint matching EmDash's tag convention —
  `collection:<name>` and `term:<defName>`, e.g.
  `Astro.cache.set({ tags: ["collection:listings", "term:region"] })` — so publishing
  purges the page.
- **NEVER add a `/[...path]` catch-all route rule** — it would match `/_emdash/*` and
  make the admin cacheable. List specific public page slugs instead.
- Leave `/search`, `/_emdash/*`, and 404 uncached (the provider only caches
  `response.ok` and skips requests carrying an `astro-session=` cookie).
- Invalidation is purge-by-tag on publish (needs `CF_ZONE_ID` var +
  `CF_CACHE_PURGE_TOKEN` secret, a Cache-Purge–scoped API token). **Never run
  `purge_everything`** — prefer purge-by-tag or single-URL.
- Cache-busting bundled CSS needs a real DECLARATION change (e.g. an `--asset-rev`
  custom property); a CSS *comment* is stripped by minification → same hash.

---

## 6. HTTPS + final polish

- Cloudflare → SSL/TLS → Edge Certificates → **Always Use HTTPS: On** (else `http://`
  serves 200 with no redirect) and enable **HSTS**.
- `/_astro/*` and other hashed assets are served `immutable` — never purge by
  filename; a poisoned/truncated edge entry is escaped by bumping the bundle hash.
- If the admin author-filter dropdown 500s with "EmDash is not initialized", EmDash
  0.19 forgot to bind `handleContentAuthors` in the auth middleware locals — apply it
  via `pnpm patch emdash` (one added line in `dist/astro/middleware.mjs`).
