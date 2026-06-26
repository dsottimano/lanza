# Project rules

Static Astro site (repo root) + Sveltia CMS (`/admin`) + a Telegram draft bot
(`bot/`), all on Cloudflare's free tier. Content is git-based markdown under
`src/content/posts`; `draft: true` is the publish gate (the build hides drafts).

## Rules

1. **Stay free-tier and all-Cloudflare.** Pages for the static site, Workers for
   the bot. D1/R2 only when listings need them (see Rule 4). Page views are
   unmetered; Workers free tier is 100k req/day account-wide — the bot is the
   only request-consumer, keep it that way.

2. **Cache public routes.** Every public page is static and cacheable. Don't add
   handlers or middleware that defeat caching. `/admin/*` and the bot are never
   cached. When listings move to on-demand routes, give each a `routeRules` entry
   and cache by tag — never a `/[...path]` catch-all cache rule (it would cache
   the admin).

3. **Minimize D1/R2 once added.** Reads/writes cost money and latency. Cache or
   avoid queries; serve media straight from R2's public domain, never through a
   Worker. New content queries must justify themselves.

4. **Sveltia is config-only.** The CMS is configured in `public/admin/config.yml`
   and runs from the self-hosted `public/admin/sveltia-cms.js` (not a CDN — see
   README for why and how to upgrade). No CMS forks or runtime patches.

5. **Bot secrets via wrangler, never in the repo.** `BOT_TOKEN`, `BOT_INFO`,
   `WEBHOOK_SECRET`, `GITHUB_TOKEN` are `wrangler secret put`. The bot fails
   closed (webhook secret + chat allowlist required). See `bot/README.md`.

## Before you commit

- New public page? → keep it static/cacheable; no catch-all cache rule.
- New content query (D1/R2)? → can it be cached or avoided?
- Touching the bot? → secrets stay out of the repo; keep it fail-closed.
- Path moved? → update `config.yml`, `bot/wrangler.jsonc` (`CONTENT_DIR`), and
  `scripts/gen-redirects.mjs` together.
