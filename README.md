# Astro static site + Sveltia CMS + Telegram bot (Cloudflare)

Pure-static Astro at the repo root, edited through Sveltia CMS, with a Telegram
Worker for drafting on the go. Everything runs on Cloudflare's free tier. Content
lives in git; the production build drops `draft: true` entries.

No Cloudflare adapter yet — add `@astrojs/cloudflare` + per-route
`prerender = false` only when the real-estate listings need on-demand rendering
(those will move to D1).

```
.                 Astro project (root)
├── src/          pages, content collections, data (seo.json, redirects.json)
├── public/       static assets, /admin (Sveltia CMS, self-hosted)
├── scripts/      gen-redirects.mjs (redirects.json → public/_redirects)
└── bot/          Telegram → draft-post Cloudflare Worker (own README)
```

## Local dev

```bash
npm install
npm run dev      # drafts ARE visible in dev
npm run build    # gen-redirects → astro build (static, drafts hidden)
npm run check    # astro check (type-check)
```

Admin in dev: open `http://localhost:<port>/admin/index.html` (the dev server
doesn't auto-resolve `/admin/` to its index; Cloudflare Pages does in prod).

## Editing content — Sveltia CMS at `/admin`

- Deploy, then visit `https://<your-site>/admin/`.
- Sign in with **"Sign in with Token"** using a GitHub **fine-grained PAT**
  (this repo, permission **Contents: read & write**). No auth Worker needed for a
  solo/technical editor.
- **Local workflow:** "Work with Local Repository" needs a Chromium browser
  (File System Access API) — Chrome/Edge/Brave. No proxy or config flag required.
- **Drafts:** new entries default to `draft: true` and stay off the live site
  until you uncheck *Draft* and save (Sveltia has no editorial workflow yet).
- **SEO:** per-entry under the *SEO* group; site-wide defaults under
  *Settings → SEO defaults* (`src/data/seo.json`).
- **Redirects:** *Settings → Redirects* (`src/data/redirects.json`), compiled to
  Cloudflare's native `public/_redirects` at build time by `scripts/gen-redirects.mjs`.

The CMS runtime (`@sveltia/cms`) is **self-hosted** at `public/admin/sveltia-cms.js`
rather than loaded from a CDN — unpkg's cache served bytes that didn't match the
published npm version, breaking SRI. To upgrade, replace that file from npm:

```bash
curl -sL "$(curl -s https://registry.npmjs.org/@sveltia/cms/<version> | python3 -c 'import sys,json;print(json.load(sys.stdin)["dist"]["tarball"])')" | tar xz -O package/dist/sveltia-cms.js > public/admin/sveltia-cms.js
```

## Deploy to Cloudflare Pages

Connect the repo in the Pages dashboard with:

| Setting | Value |
|---|---|
| Root directory | `/` |
| Build command | `npm run build` |
| Output directory | `dist` |

Static page views are unmetered (free tier). Update `site:` in `astro.config.mjs`
to your real domain, and the `repo:` in `public/admin/config.yml` if you fork.
