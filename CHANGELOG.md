# Changelog

`lanza-site` on npm. Tenants pin a version, so nothing here reaches a live site until
that site updates (Settings → Software).

## 0.1.12 — 2026-07-26

### Fixed

- **Saving an entry with no title broke the whole site build.** `title` is required by
  the generated content schema, so an untitled entry fails the build outright
  (`InvalidContentEntryDataError: title: Required`) rather than just rendering oddly —
  and Cloudflare keeps serving the last good deployment, so the site looks fine while
  every later edit silently stops going live. Pressing Save on a brand-new page wrote
  `untitled.md` with no title key. The editor now refuses to save without one.

  **If a site is already broken this way**, delete or fix the offending entry
  (the build log names it, e.g. `content/pages/en/untitled.md`) on both `staging` and
  `main`. Updating the package does not repair content already committed.

## 0.1.11 — 2026-07-26

The security sweep, plus two CMS fixes. **This is the release to be on.**

### Security

Eight adversarial audits across the auth gate, both proxies, MCP, the CMS, the update
path and the bot, followed by five red-team rounds against the fixes themselves. Full
reasoning in `docs/security-model.md` (five invariants now — I5 is new).

- **An MCP access token was accepted as an `/admin` session cookie.** The broker signs
  both with the same key and the client could name any `resource`, so asking for a
  site's bare origin returned a token byte-identical to that site's session. Both
  families now carry `typ` and every consumer checks it. *(Broker-side fix — already
  live for all sites.)*
- **`..%2f` skipped the `/admin` auth gate**, reaching the Cloudflare-token proxy with
  no session check. Exemptions are an exact path set; encoded separators are refused.
- **`javascript:` injection through template slots and menu URLs** — script on the
  `/admin` origin, where the session cookie rides same-origin fetches. The template
  engine is now URL-context-aware, and the build additionally verifies its OUTPUT with
  a real HTML parser (`assert-rendered-safe.ts`), failing the deploy if a value
  produced something a browser would act on. Post/page bodies get the same check on the
  sanitizer's output.
- **Build RCE via `data/schema.json`** — the code generator interpolated collection and
  field names into generated code with no escaping, and that file is written by theme
  import. Proven with an `execSync` in a field name.
- **Theme import used a deny-list**, leaving `package.json`, `astro.config.mjs` and
  `lanza.config.json` (which decides who owns `/admin`) writable by a theme author.
- Media uploads are extension-allowlisted; menu URLs go through the renderer's scheme
  policy at entry as well as at render.
- A real Content-Security-Policy and `frame-ancestors` ship for the first time.
- Dependency lifecycle scripts are disabled (`.npmrc`) so a compromised transitive
  cannot run code during a tenant build.
- The Telegram bot strips control characters from titles — a stray carriage return
  broke the *whole site build* — gains `ALLOWED_USER_IDS`, and no longer retry-loops.

### Fixed

- **`get_site` and MCP write tools now return a staging URL on a custom domain.** They
  derived it from the request host, so custom-domain sites got `stagingUrl: null` and
  no `reviewUrl` — the sites most likely to want a review link were the ones without
  one. A site whose Pages project was not created by the onboarding flow can name it
  explicitly with `pagesProject` in `lanza.config.json`.
- `parse5` is a direct pinned dependency. It was reached transitively, and it is a
  build-blocking import.

### CMS

- Entry lists show a **View** link per entry, opening that entry on the staging
  deployment — where the CMS actually writes, so it shows what you just saved rather
  than 404ing until you publish.
- Entry lists are wider and tighter; the old column left most of the window empty.

### Upgrading

No config changes required. Two notes:

- Publishing this package now requires `npm publish --ignore-scripts=false` — `.npmrc`
  disables lifecycle scripts, which also suppresses the `prepack` that rebuilds the
  admin SPA.
- A site whose Cloudflare Pages project was created by hand (not by onboarding) should
  add `"pagesProject": "<project-name>"` to `lanza.config.json`, or its review links
  will point at a derived hostname that does not resolve.
