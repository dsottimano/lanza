# Cloudflare static site + Sveltia CMS + Telegram bot

A hardened, all-Cloudflare, **free-tier-first** content site. The public site is
static Astro on Cloudflare Pages; editing is git-based via Sveltia CMS; a Telegram
bot stages draft content. Built to eventually carry a **real-estate listings** site
(hand-entered listings), but the listings module is intentionally not built yet.

> **Active work lives on branch `scaffold/pages-admin-split`** (not yet merged to
> `main` or pushed). The legacy EmDash starter still sits in `emdash/` + `wiki/` —
> see [Legacy](#legacy) at the bottom.

## Why this exists (the pivot)

This repo began as an EmDash CMS starter. EmDash was judged **too slow** for the
goal: the whole app runs SSR-on-a-Worker, so public pages hit D1 on every request
and cold paths time out. The entire `emdash/CLAUDE.md` ruleset is aggressive
caching to fight that — a sign the architecture was working against us.

**The fix: separate "content" from "data," and serve content statically.**

| | Old (EmDash) | New |
|---|---|---|
| Public render | SSR per request, D1-backed | **Static**, built once, edge-served |
| Content store | D1 (Portable Text) | **Markdown in git** |
| Admin | EmDash on a Worker | **Sveltia** (git-based, browser-only) |
| Speed / cost | Cache-engineered, timeout-prone | Static = fast + free, no DB on the read path |

The DB+cache model EmDash used wasn't *wrong* — it's right for **listings**
(structured, queryable, frequently-changing). It was wrong for **static content**.
So listings will return as D1 later; everything else is static git content now.

## Architecture

```
┌─ Cloudflare Pages ──────────────┐     ┌─ Cloudflare Worker ─────────┐
│ site/  Astro 7, static          │     │ bot/  Telegram bot (grammY) │
│  - content in git (markdown)    │     │  - msg → commit draft:true  │
│  - draft:true hidden from prod  │◀────│    via GitHub Contents API  │
│  - SEO + JSON-LD, _redirects    │     │  - never publishes directly │
│ public/admin/  Sveltia CMS      │     └─────────────────────────────┘
│  - edits git, draft = review    │
└─────────────────────────────────┘
        content flow:  bot/editor → git (draft) → review in CMS → flip draft:false → Pages build → live
```

### Guiding constraints (the project's law)

1. **All Cloudflare, free tier unless scaling forces otherwise.** Static page views
   are unmetered; only the bot webhook consumes Worker requests (100k/day, shared).
2. **Content in git, served static.** No DB on the public read path.
3. **The `draft` boolean is the review gate.** New content (incl. every bot
   submission) defaults to `draft: true` and is excluded from the production build
   until an editor unchecks it in the CMS. (Sveltia has no editorial-workflow yet —
   this is the sanctioned pattern.)
4. **Listings = D1, later.** When real-estate listings are designed, they become
   structured D1 records with cached detail pages (long `s-maxage` + purge-on-write);
   live faceted/map search is NOT cacheable and queries the DB/an index.

## Repo layout

```
site/                 Astro static site → Cloudflare Pages
  src/content/posts/  markdown content (draft:true hidden in prod)
  src/data/           seo.json + redirects.json   (CMS-editable)
  src/lib/            seo.ts (resolve) + jsonld.ts (schema graph)
  src/components/     Seo.astro (meta + JSON-LD)
  src/pages/          index + posts/[...slug]
  public/admin/       Sveltia CMS (index.html + config.yml, SRI-pinned)
  scripts/            gen-redirects.mjs → public/_redirects
bot/                  Telegram bot Worker (grammY) — see bot/README.md
emdash/, wiki/        legacy (see below)
```

## Local development & testing

```bash
# Public site — drafts ARE visible in dev
npm --prefix site run dev          # http://localhost:4321 (or next free port)

# Production behaviour — drafts hidden, _redirects compiled, canonicals absolute
npm --prefix site run build && npm --prefix site run preview

npm --prefix site run check        # astro check (types)
```

Astro 7 runs dev as a **daemon**; manage with `npm --prefix site exec astro dev
status|stop`.

### See the CMS locally (no GitHub, no proxy)

Sveltia uses the browser **File System Access API** (Chromium only — it ignores
`local_backend`/proxy servers):

1. Start the dev server, open **`http://localhost:<port>/admin/index.html`** in
   **Chrome or Edge**.
2. Choose **"Work with local repository"**, grant access to the repo root.
3. Edits write directly to local files. (On deployed Pages the URL is `/admin/`.)

## SEO

`Seo.astro` renders, per page (CMS-editable) merged with global defaults
(`src/data/seo.json`):

- Title template, description, **auto canonical**, robots/`noindex`, full Open
  Graph + Twitter cards, `og:locale`.
- **Auto JSON-LD `@graph`:** `WebSite` + `Organization` sitewide, `BlogPosting`
  per post (dates, author, publisher), linked by `@id`.

Absolute URLs derive from `site:` in `site/astro.config.mjs` — **set this to your
real domain before launch** (every canonical/JSON-LD URL depends on it).

## Redirects

Edited as data in the CMS (`src/data/redirects.json`), compiled to Cloudflare's
native `public/_redirects` at build by `scripts/gen-redirects.mjs`. Enforced at the
edge, **no Worker cost**. Free-plan limits (verified mid-2026):

| Mechanism | Free limit | Use |
|---|---|---|
| **`_redirects`** (this) | 2,000 static + 100 dynamic = **2,100** | primary store |
| Redirect Rules | 10 / zone | a few wildcard host/path rules |
| Bulk Redirects | **10,000** (5 lists) | escalate past 2,100 |
| Page Rules | 3, deprecated | avoid |

## Deploy (when ready)

| Piece | How |
|---|---|
| **Site → Pages** | Connect repo: root `site`, build `npm run build`, output `dist` |
| **Bot → Worker** | `bot/README.md` — `wrangler deploy` + 4 secrets + `setWebhook` |
| **Before launch** | Set `site:` in `astro.config.mjs`; set `ALLOWED_CHAT_IDS` + `WEBHOOK_SECRET` (bot fails closed without them) |

## Status

- ✅ Static site (Astro 7), draft gate, SEO + JSON-LD, redirects pipeline
- ✅ Sveltia CMS (posts, SEO defaults, redirects) — local + git backends
- ✅ Telegram draft bot (grammY), hardened (fail-closed auth, allowlist, no error leaks)
- ⏳ **Deferred: real-estate listings** (D1 schema + cached detail routes + search)
- ⏳ Not yet: push branch / PR to `main`; deploy; set real domain

## Legacy

The original corrected-EmDash starter still lives here and is **not** part of the
new architecture:

- `emdash/` — the EmDash app (Astro SSR). Its rules: `emdash/CLAUDE.md`.
- `wiki/` — static HTML docs of the EmDash fixes (`npm run dev` → :8080 via `server.mjs`).

These remain for reference/migration only. New work targets `site/` + `bot/`.
