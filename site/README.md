# site — Astro static site + Sveltia CMS (Cloudflare Pages)

Pure-static Astro. Content lives in git; the production build drops `draft: true`
entries. No Cloudflare adapter yet — add `@astrojs/cloudflare` + per-route
`prerender = false` only when the real-estate listings need on-demand rendering.

## Local dev

```bash
npm install
npm run dev      # drafts ARE visible in dev
npm run build    # gen-redirects → astro build (static, drafts hidden)
npm run check    # astro check (type-check)
```

## Editing content — Sveltia CMS at `/admin`

- Deploy, then visit `https://<your-site>/admin/`.
- Sign in with **"Sign in with Token"** using a GitHub **fine-grained PAT**
  (repo `dsottimano/emdash-starter`, permission **Contents: read & write**).
  No auth Worker needed for a solo/technical editor.
- **Drafts:** new entries default to `draft: true` and stay off the live site
  until you uncheck *Draft* and save. This is the review gate (Sveltia has no
  editorial-workflow yet).
- **SEO:** per-entry under the *SEO* group; site-wide defaults under
  *Settings → SEO defaults* (`src/data/seo.json`).
- **Redirects:** *Settings → Redirects* (`src/data/redirects.json`), compiled to
  Cloudflare's native `public/_redirects` at build time by `scripts/gen-redirects.mjs`.

## Deploy to Cloudflare Pages

Connect the repo in the Pages dashboard with:

| Setting | Value |
|---|---|
| Root directory | `site` |
| Build command | `npm run build` |
| Output directory | `dist` |

Static page views are unmetered (free tier). Update `site:` in `astro.config.mjs`
to your real domain.
