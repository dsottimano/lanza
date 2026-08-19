# TODOs

The running work list. Deeper lists live in their own files and are linked from here
rather than copied — `security-todo.md` (the auth migration, phase by phase),
`cms-review-todo.md` (~25 verified defects in `admin/`), `site-system.md` (the
composition contract itself), `mcp-server.md` (the tool surface).

**Ordering:** `Now` is what is actually next and why. Everything under `Open` is real
but unscheduled. The shipped log is at the bottom — it is context, not work.

Started 2026-08-15. Last restructured 2026-08-19.

---

## What this product is, in one paragraph

Someone onboards — broker, Cloudflare, GitHub — then opens ChatGPT or Claude or Grok,
connects this site's MCP server, and **talks**. The LLM works out what content types the
site needs, invents them, creates the URLs, writes the page templates and their input
fields, sets the look, shows the owner a staging URL, and the owner says yes. Read that
again before planning anything: it is the test every capability is judged against, and
the failure mode is building a library of prefabricated site types instead. Dave,
2026-08-19: *"I'm using recipes and real estate as examples, not prefabricated."*

`docs/site-system.md` is the grammar the LLM composes against; `npm run check:site` and
the MCP `validate_site` tool are what tell it whether what it invented holds together.

---

## Starting cold? Read these, in this order

1. `CLAUDE.md` — project rules. Rule 7 is the site system, rule 6 the review surface,
   rule 4 the CMS + security posture.
2. `docs/site-system.md` — the composition contract. **The code wins over the doc**;
   `functions/_lib/site-system.mjs` is the enforcement.
3. `docs/mcp-server.md` — the 20 tools, and which ones exist to close the gap above.
4. This file's `Now` section (below). Three items, in priority order.

Then prove the tree is healthy before changing anything:

```sh
npm test            # 291 function + 313 admin, all green
npm run check:site  # 1 template dir, 0 errors, 0 warnings
node bin/lanza.mjs build   # 15 pages + /llms.txt + /site-system.json
npx wrangler@3.114.17 pages functions build --outdir /tmp/fnbuild   # must compile
```

Traps that have already cost time:

- **`astro check` reports 1 pre-existing error** at `Base.astro:36` (`appearance.json`'s
  `brand.scheme` widens to `string`). It is not yours. Don't chase it.
- **The CMS commits to GitHub, not to your checkout.** `git fetch` before assuming your
  `main` is current — live edits to `content/` land upstream while you work.
- **Anything under `functions/` is bundled by Cloudflare with an older esbuild**, so
  `npm test` passing proves nothing about the deploy. That now includes the site-system
  checker and parse5. Check it the way CI will (command above).
- **Never add a content type to this repo's `data/schema.json` to try something out** —
  it is lanzacms.com's own model. Drive the MCP tools in a test instead
  (`functions/_lib/mcp-core.test.mjs` has a fake GitHub), or use
  `scripts/apply-recipe.mjs --into <tmpdir>`.
- **Don't build a recipe library.** See the paragraph at the top. `recipes/event-site` is
  a worked example that proves the machinery runs; it is not the product.

---

# Now

Three items. The tool surface is complete enough that an LLM can build a site end to end
(there is a test that does it), so these are the three things standing between "the tests
pass" and "someone actually did this".

## 1. Drive it with a REAL LLM against a REAL site — CRITICAL

**Everything shipped so far is proven by tests that call the tool functions directly.**
That proves the mechanics. It does not prove the *ergonomics*, and the ergonomics are the
product: a tool description is the only contract a cold model gets, and there is no
evidence yet that a model reads `describe_site_system` and then does the right thing.

This is the highest-value unknown on the list, and it is the one most likely to be wrong.

- [ ] Connect a real client (Claude / ChatGPT / Grok) to a **datadefine-owned** test site —
      `dmg` or `mcp-test`, never `lanzacms.com` and never a customer. A 403 on lanzacms.com
      is the gate working, not a bug.
- [ ] Give it a one-line brief in a shape nobody has tried ("a site for my violin repair
      shop") and watch where it goes wrong. Expect the failures to be in the DESCRIPTIONS,
      not the logic: a tool it never calls, a field it invents, an order it gets wrong.
- [ ] **Write down every wrong turn before fixing any of them.** The instinct will be to
      patch the first one; the pattern across all of them is the finding.
- [ ] Known-weak spots to watch specifically:
      - Does it call `describe_site_system` at all, or guess?
      - Does it work out the template → content-type order without being told? (The order
        is forced: a type's fields come FROM its detail template, and its route NAMES its
        listing template. `write_template` defers `listing-unknown-collection` for exactly
        this reason.)
      - Does it ever call `validate_site` unprompted?
      - Does it know a page needs `preset` + `slots`? See item 3.

## 2. Media — an agent cannot put a picture on the site

A violin shop, a pottery studio and a restaurant all need photographs, and there is **no
upload tool**. An LLM can reference a URL it was given and nothing else. The CMS uploads
to `public/images/uploads` and serves them as static assets.

- [ ] **`upload_media`** — write a binary to `public/images/uploads/<name>` on staging and
      return the path. GitHub's Contents API takes base64, so the transport is the easy
      half.
- [ ] The hard half is **where the bytes come from**. An MCP client cannot hand over a
      local file, so the realistic inputs are a URL to fetch (server-side fetch from a
      Worker — needs a size cap, a content-type allowlist and a think about SSRF) or
      base64 in the tool call (bounded by the client's own message limits).
- [ ] Whatever it accepts, the path is **derived**, never passed: `public/images/uploads/`
      plus a slugged filename plus an extension from a fixed allowlist. Same posture as
      the settings paths — see `security-model.md` §3.
- [ ] Changing the media path breaks every existing image reference. Don't make it
      configurable.

## 3. The home page — composable, but undocumented

An LLM can create a page entry whose `preset` names a template folder and whose `slots`
carry the values, and it works. Nothing tells it that. `describe_site_system` explains
positions and widgets but never says how a *page* reaches a template.

- [ ] Say it in `describe_site_system`: a page is an entry in `pages` with
      `preset: "<template folder>"` and `slots: { … }`, and `template` is a different
      thing (the layout variant — `default` / `full-width` / `landing`). The two names are
      near-synonyms and an agent reliably guesses wrong; this is already in
      `site-system.md`'s Traps and needs to be in the served contract.
- [ ] Consider a worked example in the contract — the smallest page template plus the
      `create_content` call that fills it. An example is worth more than a rule here.
- [ ] Check whether `create_content` needs to say it too. Its description covers
      frontmatter generically and never mentions `preset`.

---

# Then — auth and the release

1. **Phase 4 of the zero-secret auth migration.** `security-todo.md` §0 is written to
   start cold. The first step is not a code change: **sign in on the live site and
   confirm the CMS works end to end**, because phase 4 deletes the fallback and should
   not be done while unable to use its replacement.
2. **Publish `0.1.12`** — read "Before publishing" below first. Tenants are on `0.1.11`
   and have none of this work.
3. ~~Merge `site-system`.~~ Merged to `main` at `eeb504b`. Everything since is on `main`
   and unpushed — `git log origin/main..main` is the honest list.

---

# Open — the site system

`docs/site-system.md` is the contract; `npm run check:site` and MCP `validate_site` both
enforce it, from the same module.

- [ ] **Nothing can DELETE.** No tool removes a content type, a template or an entry-less
      collection, and `update_content_type` will not rename `name` (that is a migration —
      the folder and every built URL derive from it). An LLM that gets the model wrong
      twice leaves debris. Deletion is destructive and revert-shaped, so design it against
      `docs/review-surface.md` before building it.
- [ ] **A site cannot become multilingual over MCP.** `data/site.json` (locales, default
      locale) is not in the Settings collection and no tool touches it. Adding a locale
      restructures routing and hreflang for the whole site, so it is a real feature.
- [ ] **Taxonomy routes for custom types** (`/properties/neighbourhood/<x>/`) are not
      generated — only the listing and the detail page are.
- [ ] **The CMS does not expose `route`.** The content-type editor needs a route panel;
      right now a route is only reachable as data or through MCP.
- [ ] **Filtering, sorting and pagination.** A listing takes one `sortBy`. Forty entries
      is fine; four hundred is not, and "3+ bedrooms under X" is not expressible at all.
      This is the first thing a real catalogue will hit.
- [ ] **Relations between types render nowhere.** The `relation` widget exists in the model
      and a detail template cannot print the related entry's fields.
- [ ] **Galleries have no template idiom.** A `list` of images works, but nothing shows the
      shape an agent should reach for.
- [ ] `recipes/` is not in `package.json` `files`, so tenants receive none. Deliberate, and
      per the framing at the top of this file, likely to stay that way.
- [ ] Pre-existing, unrelated: `astro check` reports one error at `Base.astro:36`
      (`appearance.json`'s `brand.scheme` widens to `string` through the JSON import).

# Open — the review surface

- [ ] **Clicking a preview region does not focus the field.** Selection highlights and
      lists it, but the cursor does not move. This is the step toward editing IN the
      preview and needs a focus-by-path API the form does not have — the path plumbing
      now exists (`field-paths.ts`, `data-field-path` stamps), so the missing piece is
      scroll-and-focus by path, not the addressing.
- [ ] **Click-to-edit in the preview**, the actual goal. Blocked on the preview's 180ms
      `innerHTML` swap, which destroys DOM identity on every keystroke: an inline editable
      region needs re-render suppression while it holds focus.
- [ ] **`{{{ body }}}` has no sub-region markers.** The body is one marker, whole.
      Per-paragraph mapping needs the editor's own node positions, not the template
      engine. Fine until someone wants to click a paragraph in the preview.
- [ ] A slot placed directly in `<table>`/`<tr>` content gets foster-parented by the
      browser along with its marker. The raw text already is, marker or not.
- [ ] **`PendingView` has no count badge in the nav.** `pendingCount` (`ui/staging.ts`)
      only refreshes on editor mount/save, so it would read stale on a fresh load. Wire a
      refresh, then add the badge.
- [ ] Per-row publish does not exist and must not be faked: publishing is a staging→main
      merge, all or nothing. If per-row is wanted it is a real feature (cherry-pick or
      per-path merge), not a UI change.

# Open — settings, and "every possible option"

The inventory is done. Three tiers, in order:

- [ ] **Declare more field-driven screens.** `Field[]` → `FieldForm` already renders any
      declared field set, and exactly one screen uses it (SEO defaults). Anything
      form-shaped costs a JSON entry and no Vue.
- [ ] **Collapse the duplicated catalogs into data** — what actually makes the CMS
      configurable, and the DRY fix regardless:
      - `FONT_CATALOG` is **triplicated** (`admin/src/backend/brand.ts`,
        `frontend/lib/appearance.ts`, `frontend/styles/site.css`), each with a
        "⚠️ MIRROR" comment.
      - The locale catalog is duplicated: `LANG_CATALOG` (`admin/src/backend/site.ts`) vs
        `KNOWN_LOCALE_CODES` (`frontend/lib/i18n.ts`). The second must keep recognising
        DISABLED locales, so it cannot derive from `site.json` — derive both from one
        catalog instead.
      - `COLOR_TOKENS`, `RADIUS_OPTIONS`, `PRESETS` (`brand.ts`) are fixed enums; a
        seventh colour token needs a code change.
      - Newly relevant: `site-system.mjs` mirrors `admin/src/schema.ts`'s `Widget` union
        and `Base.astro`'s `partData`, and `COLLECTION_NAME` mirrors
        `gen-content-config.mjs`. Three more MIRROR comments, same disease. (The route
        rules went the other way and are now shared — `gen-routes.mjs` imports them.
        That is the pattern to copy.)
      - `set_brand` made this worse in a useful way: `FONT_CATALOG` is now the list an
        MCP client is TOLD is valid, so a fourth copy drifting is now visible to a
        stranger's agent, not just to us.
- [ ] **Dead config**: `data/appearance.json`'s `theme` and `logo` are unreachable from
      the UI — `schema.json` still declares them but the sidebar filters that entry out.
      `set_brand` now writes `logo`, so it is half-alive: reachable by an agent and not by
      a person. Wire it or drop it, but stop leaving it in between.
- [ ] **Do NOT expose**: the gh-proxy allowlist, `adminLogin`/`owner` (self-promotion),
      branch names (they live in two files with no shared source), media paths (changing
      them breaks every existing image reference).

# Open — the dashboard direction

- [ ] **Global to-do beyond publishing.** `PendingView` answers "what is waiting to go
      out". The dashboard also wants "what needs a decision" — broken links, missing
      translations, a page no one has touched in a year. `npm run check:site` findings
      belong here too.
- [ ] **Connectors, read-only first** (Search Console). Anything that SPENDS money (Meta
      ads) reintroduces the standing-secret blast radius the auth migration just removed,
      and needs a spend gate that a typo fix does not.
- [ ] **Agent attribution.** Every change is already a commit with an author, and nothing
      in the UI shows who made it. "The agent changed this" vs "you changed this" is the
      difference between reviewing and re-reading.

# Open — smaller, and unrelated

- [ ] `cms-review-todo.md` — ~25 verified defects in `admin/`, none fixed.
- [ ] Rotate the credentials `keys-and-secrets.md` §7 lists as owed.
- [ ] Point the bot's `GITHUB_TOKEN` at `staging`, not `main`.
- [ ] `vue-tsc` segfaulted once (clean on re-run, exit 0). If it recurs, it is the
      toolchain, not the types.

---

# Before publishing `0.1.12`

`functions/` ships inside the `lanza-site` package and `bin/lanza.mjs` copies it into the
tenant repo at build time, so **a release replaces every tenant's auth gate and both
proxies at once**.

- [ ] **Finish phase 4.** Mid-migration, `editors` in `lanza.config.json` controls nothing
      (roles come from GitHub collaborators) while `PeopleView` still edits that list — a
      tenant owner would "invite" someone and nothing would happen, silently. Phase 4
      replaces that panel with a link to GitHub's collaborator settings.
- [ ] **Verify against a datadefine-owned tenant** (`dmg` / `mcp-test`), never a customer.
      A `ghu_` token is bounded by *App installation ∩ the user's own permission*, and the
      work is only proven on `dsottimano/lanza`, where the App is installed. If a tenant
      repo lacks the installation, device-flow tokens may not see it and everyone there is
      locked out of their own CMS.
- [ ] Every tenant editor is signed out at once by the release and needs one device code.
      That should land with working invite UI, not before it.
- [ ] New: the release also ships `gen-routes.mjs` and the two collection-route
      components. Additive — a tenant with no `route` block generates nothing and builds
      byte-identically (verified) — but that is the claim to re-check on the first tenant
      build after release.
- [ ] New: `functions/` now carries the site-system checker **and parse5**, so the Worker
      bundle went 221K → 524K. Well inside Cloudflare's limits, but it is the first time a
      dependency entered that bundle; re-verify with the `wrangler pages functions build`
      command in the cold-start block before releasing.
- [ ] New: the MCP surface went from 10 tools to 20, and six of them WRITE outside
      `content/` (templates, parts, `data/schema.json`, the settings files). Every one is
      confined by a derived path rather than a validated one; `security-model.md` §3 is
      the record. Re-read it before a release that widens the surface again.

---

# Shipped

## 2026-08-19 — the site system, reachable without a checkout

Nine commits on `main`, unpushed. The site system existed but was operable only by
someone with a terminal — which is precisely the person who did not need a CMS. This
closed that.

- **The checker moved to `functions/_lib/site-system.mjs`** so the MCP server runs the
  same code `npm run check:site` does. `checkSite()` takes injected IO — the CLI hands it
  `fs`, the server hands it a GitHub branch — because a second implementation would be a
  second opinion.
- **The contract became data.** `CHECKS` (every problem code with the silent failure it
  stands for) and `siteSystemContract()`, served at **`/site-system.json`** and by
  `describe_site_system`, from the same constants the checker enforces. A test scans the
  source both ways so the published list cannot rot.
- **`/llms.txt` says what the site IS** — the one rule, the contract URL, the MCP
  endpoint, and a "Content types" section generated from the tenant's own `schema.json`.
- **Ten new MCP tools**, taking the surface from 10 to 20: `describe_site_system`,
  `validate_site`, `write_template`, `write_part`, `create_content_type`,
  `update_content_type`, `get_settings`, `set_brand`, `set_menu`, `set_seo`.
  Settings was not a gap but a blind spot — `getCollections()` drops every folderless
  collection, so no `kind: "files"` entry was reachable at all.
- **Template safety, classified.** A template is raw markup emitted with `set:html` on the
  origin that serves `/admin`, and `assert-rendered-safe.ts` was built on its author being
  a trusted human. `checkTemplateSafety()` PARSES (reusing `dangerousConstructs()`, never
  a regex) and severity depends on the AUTHOR: warnings for a human, refusal for an agent.
  `security-model.md` §3 carries the reasoning, §5 the two accepted limits.
- **Two end-to-end tests** in `mcp-core.test.mjs` — a real-estate site and a pottery
  studio, both invented from nothing through the tools, the second including the owner
  changing their mind and publishing. If they stop passing, the pitch is not true.

Three bugs the tests caught before shipping, all of the same kind — something failing
silently: a false positive on `href="{{ url }}"` (not a URL yet), `write_template`
mutating the caller's object, and a `note` key collision that swallowed the "this type
has no URL" warning.

**Deprioritized here:** `apply_recipe` and per-vertical recipes. See the framing at the
top of this file.

## 2026-08-18 — the site system (merged to `main` at `eeb504b`)

The composition contract for agent-built sites. `docs/site-system.md` is authoritative.

- **A cross-layer checker** (`functions/_lib/site-system.mjs`, `npm run check:site`) that mirrors
  the engine's grammar and innermost-out scope resolution rather than approximating them.
  Catches what was silent: undeclared slots, `{{#each}}` over a scalar, unclosed blocks,
  `{{{ }}}` on a non-body slot, dead fields, routes to missing templates.
- **Generic collection routing** — `collection.route` in `data/schema.json` →
  `scripts/gen-routes.mjs` emits the `.astro`. Closes the long-standing gap where a
  CMS-invented content type rendered at no URL and tenants could not ship `.astro` to fix
  it. The trick: hand the engine an entry's frontmatter instead of a page's slots.
- **Recipes** — one directory expands into content type + templates + fields + route +
  seed + styles. Fields declared once (`fieldsFrom`); nothing written unless everything
  validates.
- **`/style-preview/`** — variants from `data/styles.json` side by side, route present
  only when that file is.
- Fixed two errors in `docs/authoring-templates.md` that were teaching agents to write
  broken templates (`showNav` does not exist — it is `showSwitcher`; the "no triple-brace"
  line contradicted both the engine and the table above it).

## 2026-08-15 — auth phases 1–3, and the review surface

**Auth** — device-flow sign-in screen, the gate reading GitHub `permissions`, the proxy
attaching the signed-in person's own token. No broker mint, no standing PAT, zero secrets
on the tenant.

**The review surface** — a change is a proposal with a diff, a rendered before/after and a
one-click revert: `entry-diff.ts`, preview markers in the render engine, `ChangeList.vue`,
`useEntryReview.ts`, `PendingView.vue`.

**Editor fixes** — labelled title, resolved URL with locale prefix, per-entry and per-list
language bars, grouped/collapsed template slots, a sticky preview, focus-follow.
