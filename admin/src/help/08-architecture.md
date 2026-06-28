# How Lanza works (architecture)

A short tour of what's under the hood — useful if you're maintaining the site, not
just editing it. Nothing here is needed for day-to-day writing.

## The big picture

Your site is two apps in one repository, plus a small bot:

- **`frontend/`** — the public website, built with **Astro**. Pure static HTML:
  every page is pre-rendered at build time, so there's no server to run and page
  views are free and fast. (Astro is pointed at this folder via `srcDir` in
  `astro.config.mjs`.)
- **`admin/`** — **Lanza**, this CMS. A Vue 3 + Vite single-page app that builds
  to `public/admin/` and is served at **`/admin`**. It has no backend of its own.
- **`bot/`** — an optional Telegram → draft-post Cloudflare Worker.

There is **no database and no application server**. The "database" is your Git
repository; the "server" is GitHub's API plus Cloudflare's static hosting.

## Where content lives

Everything you edit is plain text committed to the repo:

- **Posts, pages, taxonomies, authors** → markdown files under
  `frontend/content/…` (one subfolder per language for translated collections).
- **Site settings** (SEO defaults, menus, redirects) → JSON files under
  `frontend/data/…`.
- **Images** → committed under `public/images/uploads/` and served as static files.

Post and page **bodies are stored as HTML** (Lanza is the source of truth); the
content model — which collections exist and what fields they have — is defined in
one file, `admin/src/schema.ts`.

## How saving works (the GitHub proxy)

When you save, Lanza calls the GitHub Contents API to commit the file. The
important part: **your GitHub token never lives in the browser.** Requests go to a
proxy at `/admin/api/gh/…`, which attaches the token on the server side and
forwards the call to GitHub:

- **In production:** a Cloudflare **Pages Function**
  (`functions/admin/api/gh/[[path]].ts`) injects the `GITHUB_TOKEN` secret
  (configured in the Pages dashboard) and relays the request.
- **In development:** a Vite middleware in `admin/vite.config.ts` does the same,
  reading the token from `admin/.env` (never bundled into the app).

Either way the browser only ever talks to `/admin/api/gh` — the token stays out of
the page, the network tab, and the build output.

## Who can get in

`/admin` (and its proxy) sits behind **Cloudflare Zero Trust (Access)**, so only
authorized people reach the CMS at all. Past that gate, the server-side token does
the GitHub work — no per-user token pasting required.

## Publishing

1. You save in Lanza → a commit lands in the repo via the proxy.
2. Cloudflare Pages rebuilds: `npm run build` regenerates the CMS
   (`build:admin` → `public/admin`), compiles redirects, then runs the Astro
   build, which renders `frontend/` into static HTML in `dist/`.
3. The new static site goes live. Entries marked `draft: true` are dropped from
   the production build, so drafts never appear publicly.

## The bot (optional)

The Telegram Worker lets you fire off a quick draft from your phone. It commits a
`draft: true` markdown file to `frontend/content/posts/` through the same GitHub
API. Nothing it sends publishes automatically — you review and publish it here in
the CMS like any other draft.
