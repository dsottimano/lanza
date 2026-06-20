# EmDash Starter (corrected)

A corrected [EmDash](https://emdashcms.com) CMS starter, captured from the definemg
migration. It bundles the EmDash app (`emdash/`) and a documentation **wiki**
(`wiki/`) that explains the non-obvious fixes and how the admin actually works.

## What's corrected vs. a stock EmDash template

| Area | Fix |
| --- | --- |
| **Block Kit form block** | A `form` block's inputs must live under `fields`/`block_id`, not `elements`/`blockId`, or the renderer throws "fields is not iterable". The fix is documented in `wiki/block-kit.html`. (The demo plugin that showcased it was removed to keep the production build clean — Rule 3.) |
| **Theme** | "Editorial Authority" — Deep Ink + Paper + gold, sharp 0-radius, serif headlines (Libre Caslon Text), Inter body, Hanken Grotesk labels. |
| **Tailwind v4** | Added via `@tailwindcss/vite` (utilities only, **no preflight** — doesn't reset existing styles). |
| **Blog post template** | `src/pages/posts/[slug].astro` restyled: centered serif header, breadcrumb, meta column with share, boxed TOC, pull-quotes, end CTA. |
| **Pattern-driven routing** | `src/pages/[...path].astro` catch-all using EmDash's exported `resolveEmDashPath`, so the admin **URL Pattern** field actually controls public URLs. |

Full write-ups are in the wiki — start with **Pattern-driven routing** and **Block Kit & the form-block fix**.

## Layout

```
emdash/        the EmDash app (Astro, output: server)
wiki/          static HTML documentation
server.mjs     zero-dependency static server for the wiki
package.json   wiki runner (npm run dev → :8080)
```

## Quick start — the app

```bash
cd emdash
cp .env.example .env          # set EMDASH_ENCRYPTION_KEY: openssl rand -base64 32
pnpm install
npx emdash dev                # runs migrations + seed, regenerates data.db/uploads
```

App: http://localhost:4321/ · Admin: http://localhost:4321/_emdash/admin

## Quick start — the wiki

```bash
npm run dev                   # from the repo root → http://localhost:8080/
```

No dependencies; it's plain HTML served by `server.mjs`.

## Notes

- `data.db` and `uploads/` are **gitignored** — they're regenerated from
  `emdash/seed/seed.json` on the first `npx emdash dev` run.
- `emdash/CLAUDE.md` is a symlink to `AGENTS.md` (EmDash project instructions).
- This starter is kept in sync with corrections made in the `definemgwordpress`
  working project as they happen.
