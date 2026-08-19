# TODOs

The running work list. Deeper lists live in their own files and are linked from here
rather than copied — `security-todo.md` (the auth migration, phase by phase),
`cms-review-todo.md` (~25 verified defects in `admin/`), `site-system.md` (the
composition contract itself).

**Ordering:** `Now` is what is actually next and why. Everything under `Open` is real
but unscheduled. The shipped log is at the bottom — it is context, not work.

Started 2026-08-15. Last restructured 2026-08-19.

---

## Starting cold? Read these, in this order

1. `CLAUDE.md` — project rules. Rule 7 is the site system, rule 6 the review surface,
   rule 4 the CMS + security posture.
2. `docs/site-system.md` — the composition contract. **The code wins over the doc**;
   `functions/_lib/site-system.mjs` is the enforcement.
3. This file's `Now` section (below). It is three items and they are in priority order.

Then prove the tree is healthy before changing anything:

```sh
npm test            # 227 function + 313 admin, all green as of 43c03a1
npm run check:site  # 2 template dirs, 0 errors, 0 warnings
node bin/lanza.mjs build   # 15 pages
```

Traps that have already cost time:

- **`astro check` reports 1 pre-existing error** at `Base.astro:36` (`appearance.json`'s
  `brand.scheme` widens to `string`). It is not yours. Don't chase it.
- **The CMS commits to GitHub, not to your checkout.** `git fetch` before assuming your
  `main` is current — live edits to `content/` land upstream while you work.
- **Anything under `functions/` is bundled by Cloudflare with an older esbuild**, so
  `npm test` passing proves nothing about the deploy. Check it the way CI will:
  `npx wrangler@3.114.17 pages functions build --outdir /tmp/fnbuild`.
- **Never add a content type to this repo's `data/schema.json` to try something out** —
  it is lanzacms.com's own model. Use `scripts/apply-recipe.mjs --into <tmpdir>`.

---

# Now

Three items. They are here together because each one, on its own, is the reason the site
system is not yet the thing it claims to be.

## 1. The MCP surface — CRITICAL

**An agent connected over MCP can edit content and nothing else.** It cannot create a
content type, write a template, declare a route, or offer a style. So the entire system
shipped on `site-system` is reachable only by someone with a checkout and a terminal —
which is precisely the person who did not need it. Everything else in this file is
secondary to closing that.

The existing surface is `get_site`, `list_collections`, `get_schema`, `list_content`,
`read_content`, `create_content`, `update_content`, `delete_content`, `list_changes`,
`publish` (`functions/_lib/mcp-core.ts`; the broker at `lanza-broker/functions/api/mcp.ts`
is a router with no tool definitions of its own, so a tool added to a tenant appears
there automatically — see `docs/mcp-server.md`).

- [ ] **`describe_site_system`** — return the layer model, the positions, the widget list
      and the reserved names, so an agent learns the contract from the server instead of
      being expected to have read a markdown file. `LAYERS`, `POSITIONS`, `WIDGETS`,
      `PART_DATA` in `functions/_lib/site-system.mjs` are already exported as data for this.
- [ ] **`write_template`** — create/replace `templates/<name>/{template.html,fields.json}`,
      **refusing on any checker error**. The refusal is the feature: it is the only way an
      agent finds out it typed `{{ vneue }}`, because the engine renders that as empty
      text and says nothing.
- [ ] **`create_content_type`** — a folder collection derived from a template's
      `fields.json` (`fieldsFrom`), optionally with its `route`.
- [ ] **`apply_recipe`** — the whole-site path. Takes a recipe (see item 3), validates it
      entire, writes nothing on failure.
- [ ] **`list_styles` / `set_style`** — read `data/styles.json`, and write a chosen
      variant into `appearance.json`. Proposing styles must NOT publish one.
- [ ] **`validate_site`** — run the checker and return findings. Cheap, read-only, and it
      lets an agent verify its own work before handing back.

Two constraints that will shape the build, both learned the hard way:

- **The checker has to run inside `functions/`.** It lives in `functions/_lib/site-system.mjs`
  today. Cloudflare bundles all of `functions/` with an **older esbuild** than local, so
  `npm test` passing proves nothing about the deploy — verify with
  `npx wrangler@3.114.17 pages functions build --outdir /tmp/fnbuild` (CLAUDE.md).
  Move it to `functions/_lib/` or import it from there, and keep it dependency-free.
- **`data/schema.json` is compiled into code the build imports.** `gen-content-config.mjs`
  and `gen-routes.mjs` both treat it as untrusted for exactly that reason. An MCP tool
  that writes it widens *who* can reach that position, so this needs a pass over
  `docs/security-model.md` §5 before it ships — not after.

## 2. The contract has to be readable — in docs AND on the public site

`docs/site-system.md` is written, and it is invisible: it is one file in a repo, and the
audience is agents operating a site they were pointed at ten seconds ago.

- [ ] **`/llms.txt` should carry it.** Highest leverage of anything on this list — the
      audience for the contract literally *is* agents, and `frontend/pages/llms.txt.ts`
      is already the document they fetch first. Today it advertises `window.lanza` read
      methods and lists posts/pages. It should also say: this site is a Lanza site, here
      is how its content model is shaped, here is where the full contract lives.
- [ ] **A machine-readable contract endpoint** — `/site-system.json`, served from the
      same exported constants the checker uses, so the served version cannot drift from
      the enforced one. This is what `describe_site_system` should return too; build it
      once.
- [ ] **A public page on lanzacms.com.** A fixed page (`frontend/lib/fixed-pages.ts`,
      gated by `PRODUCT_ONLY` so tenant sites do not serve our marketing) explaining how
      an agent builds a Lanza site. `/agents/` is the natural neighbour and may be the
      right home rather than a new slug — decide before building a second page that says
      an overlapping thing.
- [ ] **Link it from the repo.** `README.md` and `docs/authoring-templates.md` should both
      point at `docs/site-system.md`; right now nothing does except `CLAUDE.md`.
- [ ] Keep the doc and the code honest about each other. `site-system.md` already says
      "the file wins" — there is no test asserting the doc's tables match the exports, and
      that is how the `showNav` error survived in `authoring-templates.md` for months.

## 3. Recipes beyond events — the format is unproven

**`event-site` was an example, not the requirement.** The system has to produce a real
estate site, a shop catalogue, a restaurant, a portfolio. One worked example proves the
machinery runs; it does not prove the *format* is general, and a format that only fits
events is a demo.

- [ ] **Write a second and third recipe in genuinely different shapes** — `real-estate`
      (listings with galleries, price, status, an agent to contact) and `catalogue`
      (products with variants, price, an external buy link). Expect them to break the
      format. That is the point of writing them.
- [ ] **Known gaps the event recipe never exercised**, each likely to surface immediately:
      - **Relations between types.** A property has an agent; a product has a category.
        The `relation` widget exists in the model but nothing renders the far side — a
        detail template cannot currently print the related entry's fields.
      - **Filtering and sorting a listing** beyond one `sortBy` field. Real estate is
        unusable without "3+ bedrooms, under X".
      - **Pagination.** Forty events is fine; four hundred products is not.
      - **Galleries.** A `list` of images has no template idiom yet.
      - **Money and number formatting.** `price` is a free-text string today, which is
        honest for events and wrong for a catalogue.
      - **Taxonomy routes for custom types** (`/properties/neighbourhood/<x>/`). Only the
        listing and the detail page are generated.
- [ ] **Be explicit that a shop is a catalogue, not a checkout.** Lanza is static on
      Cloudflare's free tier (Rule 1). Ecommerce here means a catalogue plus an external
      payment link. Say so in the recipe's description rather than letting someone
      discover it after building one.
- [ ] **The real goal is authoring, not picking.** A library of canned recipes is a
      stopgap; the system works when an agent *writes* a recipe from a brief and the
      checker tells it whether the thing it invented is coherent. The recipe format is
      the agent's output format, so it has to be simple enough to write from scratch and
      strict enough to be wrong out loud.
- [ ] **`recipes/` is not in `package.json` `files`,** so tenants receive no recipes on
      install. Deliberate — it changes what a release ships. Decide once there is more
      than one recipe worth shipping.

---

# Then — auth and the release

1. **Phase 4 of the zero-secret auth migration.** `security-todo.md` §0 is written to
   start cold. The first step is not a code change: **sign in on the live site and
   confirm the CMS works end to end**, because phase 4 deletes the fallback and should
   not be done while unable to use its replacement.
2. **Publish `0.1.12`** — read "Before publishing" below first. Tenants are on `0.1.11`
   and have none of this work.
3. **Merge `site-system`.** Five feature commits plus docs, unpushed, tests green. It
   touches no auth and no `functions/`, so it is independent of phase 4.

---

# Open — the site system

`docs/site-system.md` is the contract; `npm run check:site` enforces it.

- [ ] **The CMS does not expose `route` or the style variants.** Both are edited as data
      (`data/schema.json`, `data/styles.json`) or written by a recipe. The content-type
      editor needs a route panel; Settings → Brand needs a "compare options" entry.
- [ ] **Recipes never delete, and re-applying refuses rather than merging.** Fine for now;
      an "update this recipe" path is a real feature, not a flag.
- [ ] **The style specimen is one card.** It is honest, but a whole-page preview under a
      variant would be more convincing. Blocked on nothing except deciding whether it is
      worth generating N copies of a real page.
- [ ] Pre-existing, unrelated: `astro check` reports one error at `Base.astro:36`
      (`appearance.json`'s `brand.scheme` widens to `string` through the JSON import).
      Predates the site-system work.

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
      - Newly relevant: `site-system.mjs` now mirrors `admin/src/schema.ts`'s `Widget`
        union and `Base.astro`'s `partData`. Two more MIRROR comments, same disease.
- [ ] **Dead config**: `data/appearance.json`'s `theme` and `logo` are unreachable from
      the UI — `schema.json` still declares them but the sidebar filters that entry out.
      Either wire them or delete the declaration.
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
- [ ] New: the release now also ships `gen-routes.mjs` and the two collection-route
      components. They are additive — a tenant with no `route` block generates nothing and
      builds byte-identically (verified) — but that is the claim to re-check on the first
      tenant build after release.

---

# Shipped

## 2026-08-18 — the site system (branch `site-system`, unpushed)

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
