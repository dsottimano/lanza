# EmDash Starter — project rules

This repo *corrects* EmDash and ships a hardened Cloudflare-production starter. The
EmDash app lives in `emdash/`; its own instructions are in `emdash/AGENTS.md`
(symlinked as `emdash/CLAUDE.md`). The rules below are the starter's law and
**override convenience**. Full rationale + the live audit are in the wiki
(`wiki/rules.html`).

## The five rules

1. **Never touch EmDash core.** No edits to `node_modules/emdash`,
   `@emdash-cms/*`, or `pnpm patch`es of their `dist/`. Every fix is project-level:
   Astro middleware (`src/middleware.ts`), injected routes, config, or a plugin.
   This is what lets the starter survive EmDash upgrades. Any core bug gets worked
   around with a hook (Rule 5), never a fork.

2. **Optimize aggressively to limit D1 and R2 queries.** D1 reads/writes and R2
   reads cost money and latency. Cache first (Rule 4), serve media straight from R2's
   public domain (never through a Worker), use `d1({ session: "auto" })` read
   replicas, coalesce writes (the autosave middleware collapses dozens of revision
   INSERTs into one). New code that queries content must justify the query or cache it.

3. **Only standard Workers — never Dynamic Workers, and no third-party plugins.**
   Plugins run in-process (listed under `plugins:`, `format: "native"`/`"standard"`),
   never `sandboxed:` (which requires the paid Dynamic Workers product). Only
   first-party (`@emdash-cms/*`) and local (`@local/*`) plugins are allowed — never an
   untrusted npm plugin. Adding a plugin = writing it in `emdash/packages/plugins/`.

4. **Leverage Cloudflare caching at all times.** Every public route gets a
   `routeRules` entry (`maxAge`/`swr`) AND each page calls
   `Astro.cache.set(cacheHint)` so publishing purges by tag. Helpers that return a
   bare array (no `cacheHint`) need a manual `{ tags: ["collection:x", "term:y"] }`.
   **Never** add a `/[...path]` catch-all route rule — it would cache `/_emdash/*`
   (the admin). `/search` and `404` stay uncached.

5. **Use hooks to modify EmDash, never forks.** Behavioural changes go through Astro
   middleware (`onRequest`) and integration hooks (`astro:config:setup` →
   `injectRoute`), e.g. the autosave-coalesce + media-rewrite middleware and the
   invite-route re-injection. This is the sanctioned mechanism for Rule 1.

## Before you commit

- Did you touch anything under `node_modules`, `@emdash-cms`, or `patches/`? → stop, use a hook.
- New public page? → add a `routeRules` entry **and** `Astro.cache.set(cacheHint)`.
- New plugin? → local or `@emdash-cms` only, in-process, never `sandboxed:`.
- New content query? → can it be cached or avoided?
