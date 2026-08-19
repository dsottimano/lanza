# CMS review — findings and fixes

**Written 2026-08-09.** A five-way parallel review of `admin/` (~13.6k LOC, ~70
files). Every item below was traced in the code; the ones marked SUSPECTED are the
ones where a claim could not be fully confirmed, and they say why.

This is a work list, not a design doc. `docs/security-todo.md` is the auth
migration and is unrelated to everything here.

---

## 0. START HERE

Nothing in this document has been fixed. The review found and verified the items;
no code was changed.

> **Note, 2026-08-15.** `admin/` changed substantially on this date — the review
> surface landed (`docs/review-surface.md`) and the entry editor's header, locale
> handling and slot form were reworked. This list predates all of it, so re-verify
> a finding in `EditorView.vue`, `FieldForm.vue`, `PreviewPane.vue`,
> `TemplateEditor.vue`, `Sidebar.vue` or `site-urls.ts` before fixing it: some may
> be gone, and at least one item's surrounding code no longer looks the same.

**Suggested order:** §1 (silent loss of the user's work) → §2 (silent breakage of
the site build) → §3 (UI that says something false) → §4 (the rest).

**One empirical result that shapes several items.** Four findings hinged on what
GitHub does with a sha-less `PUT` to a file that already exists. Tested live on
`dsottimano/dave-test`:

| Request | GitHub | What our code does |
|---|---|---|
| `PUT` with **no sha**, file exists | **422** `"sha" wasn't supplied` | `putRaw` retries on 409 only → **fails loudly. Safe.** |
| `PUT` with a **stale sha** | **409** | `putRaw` refetches the sha and retries → **silent overwrite** |

So the "a blank editor could wipe the real file" family is NOT data loss — GitHub
refuses it. Those items survive only as false empty-states (§3). The 409 path is
the real one, and it is §1.1.

> Incidental finding while probing: `dave-test`'s default branch carries a ruleset
> requiring PRs, and it is a **public** repo — consistent with `security-todo.md`
> §3, where rulesets were found to be paid-plan-only on **private** repos.

---

## 1. Silently loses the user's work

- [ ] **1.1 A stale-sha 409 silently overwrites a concurrent writer.**
      `admin/src/backend/github.ts:238`
      `putRaw` catches any 409, refetches the current sha, and re-PUTs the same
      body. Two tabs, or the CMS racing an MCP write on the same `staging` branch,
      and one writer's paragraph is gone — with a green "Saved ✓" and nothing
      logged.
      **The code comment calls this "last-write-wins, which is fine for this
      single-editor-mostly CMS." That premise is dead** — the People panel shipped
      and the MCP tools write the same branch. Fix is a real decision, not a
      one-liner: surface the conflict, or merge, but do not silently pick a winner.
      Note `putJsonSafe` (`site.ts:112`) inherits this: its retry re-sends the
      payload built from the *pre-conflict* read, dropping the other writer's keys
      — the exact keys its read-merge-write exists to preserve.

- [ ] **1.2 Files over 1 MB load as empty and can be saved back empty.**
      `admin/src/backend/github.ts:145` (`loadEntry`), `:187` (`loadText`)
      Neither checks `file.encoding`. GitHub's contents API returns
      `content: "", encoding: "none"` for blobs over 1 MB, so `b64ToUtf8("")` → `""`
      and the editor opens blank with a valid sha. Retype a title, save, and a 1 MB
      post becomes a two-line stub. `loadJson` is accidentally safe
      (`JSON.parse("")` throws). Fix: reject a non-`base64` encoding loudly, and
      fall back to the blobs API (good to 100 MB) for large files.

- [ ] **1.3 Anything typed during a save is discarded with no prompt.**
      `admin/src/ui/useEntryEditor.ts:126`
      `save()` snapshots the body, awaits the write, then sets `isDirty = false` —
      clearing edits made *during* the round trip. The route guard and
      `beforeunload` then both pass, so navigating away loses the work silently.
      Fix: capture a dirty-counter at snapshot time and only clear if unchanged.

- [ ] **1.4 List and image field edits never mark the editor dirty.**
      `admin/src/fields/ListInput.vue:28,42,45`, `admin/src/fields/ImageInput.vue:52`
      Both entry editors detect edits by letting native `input`/`change` bubble.
      Add/remove/reorder an item, or remove the featured image, and nothing bubbles
      — `isDirty` stays false and the change is dropped on navigation with no
      confirm. **Every other editor in the CMS** (`BlocksView`, `ContentTypesView`,
      `RedirectsView`, `MenuEditor`) calls `markDirty()` explicitly from these same
      handlers; the entry editors are the outlier. Fix them the same way.

- [ ] **1.5 Tables are destroyed on the first save.**
      `admin/src/editor/Editor.vue:52` — no table extension is registered.
      ProseMirror lifts every cell into one paragraph:
      `<table>…</table>` → `<p>a b 1 2</p>`, stable across re-saves, unrecoverable
      from the CMS. Reachable three ways: the Telegram bot emits GFM tables, MCP
      agents write comparison tables, and writers paste from Docs/Sheets. Open the
      post, fix a typo, save — the table is gone.
      Fix: register `@tiptap/extension-table`, or refuse to load a body containing
      `<table>` rather than silently eating it.

- [ ] **1.6 A markdown draft containing any HTML-ish tag collapses to one paragraph.**
      `admin/src/backend/markdown.ts:7` (`looksLikeHtml`)
      `/<([a-z][a-z0-9]*)\b[^>]*>/i` treats the body as already-HTML and skips
      `marked`, so TipTap parses raw markdown as plain text and fuses every line.
      It fires on `<br>`, `<b>`, and on a bare markdown autolink `<https://…>`.
      A bot draft with one autolink opens as a single block with literal `#` and
      `-` characters, and saving commits that.

- [ ] **1.7 Block-content custom nodes empty themselves.**
      `admin/src/editor/extensions/Callout.ts:9`, `Testimonial.ts:20` — both are
      `content: "inline*"`, so `<div data-callout><p>one</p><p>two</p></div>`
      becomes an empty card with its text loose in the document. Permanently wrong
      once saved. `<blockquote><p>…</p></blockquote>` is exactly what an LLM writes
      by default, so this is the likely output of MCP `update_content`.

- [ ] **1.8 The editor deletes markup the sanitizer deliberately keeps.**
      `admin/src/editor/extensions/Embed.ts:25`
      `sanitize.ts:60` goes out of its way to allow a sandboxed `iframe`, but the
      editor only recognises one wrapped in `div[data-embed]`. A bare
      `<iframe src="…">`, `<video>` or `<audio>` round-trips to nothing; `<section>`
      and `<details>` are unwrapped. So markup that renders correctly on the live
      site is removed by the first human edit.

---

## 2. Silently breaks the site build

All three share a failure mode worth stating once: **Cloudflare keeps serving the
last good deployment**, so the site looks fine while every subsequent edit stops
going live. Nobody finds out until someone checks a deploy log.

- [ ] **2.1 Adding a field breaks every existing entry.**
      `admin/src/ui/ContentTypesView.vue:82` + `content-types/FieldEditor.vue:112`
      `addField()` pushes `{ required: true }` and `cleanField()` strips `required`
      unless it is `false`; `scripts/gen-content-config.mjs:186` treats an absent
      `required` as required, emitting no `.optional()`. Add `subtitle` to a
      50-post site → the next build fails on all 50 with `subtitle: Required`.
      Renaming a field does the same **and** orphans the old frontmatter key, which
      entry saves keep writing back forever (`useEntryEditor.ts:117` writes
      `{...data}`).
      The screen says the opposite: *"Changes commit `data/schema.json` and take
      effect immediately"* (`:230`).
      Fix: new fields default to optional, and warn (or backfill) when a field is
      made required on a populated type.

- [ ] **2.2 A hyphen in a content-type name kills the entire build.**
      `admin/src/ui/ContentTypesView.vue:30` accepts `/^[a-z0-9-]+$/`;
      `scripts/gen-content-config.mjs:65` requires a JS identifier
      (`/^[A-Za-z_$][A-Za-z0-9_$]*$/`) because the name becomes a `const` binding,
      and **throws** otherwise. Create `case-studies` → the CMS is happy, and
      nothing publishes at all until someone hand-edits `schema.json`.
      Fix: make the CMS's rule byte-identical to the generator's. These two regexes
      must not be allowed to disagree — same class of drift as §4.3.

- [ ] **2.3 Editing a `select` field's options breaks entries holding the old value.**
      `admin/src/ui/content-types/FieldEditor.vue:225`
      `gen-content-config.mjs:148` emits a deliberately strict `z.enum([...])`.
      Renaming option `sold` → `Sold` fails every entry still holding `sold`.
      SUSPECTED, same file: `cleanField` will save a `select` with **zero** options,
      emitting `z.enum([])`, which no value can satisfy.

---

## 3. Tells the user something false

Cheap to fix, and each one has already cost someone a wrong decision.

- [ ] **3.1 Publish claims "staging matches production" when the check failed.**
      `admin/src/ui/PublishView.vue:21,116` — a failed `compare` leaves `diff = null`,
      which renders identically to "no changes". The user dismisses an error dialog
      and reads that their unpublished work is already live. `null` needs its own
      "couldn't check" state.
- [ ] **3.2 Same failure-as-clean for the editor's pending badge.**
      `admin/src/ui/staging.ts:20` + `EditorView.vue:178` — `pendingCount = null`
      renders the same as zero.
- [ ] **3.3 Brand and Redirects claim the site is rebuilding when the write only
      reached `staging`.** `BrandView.vue:149,157`, `RedirectsView.vue:113,198,255`.
      Redirects is worse: `save()` calls `loadDeploy()`, so it shows a green
      "Live — last published 2 mins ago" describing an unrelated deployment.
      `PeopleView`'s amber aside gets this right — copy that pattern.
- [ ] **3.4 People marks invites live the moment you save.**
      `admin/src/backend/access.ts:141` — `access.editors` is loaded from
      *production* on purpose, then overwritten with what was just written to
      *staging*, so every "Not live yet" badge disappears while the change is still
      unmerged. Reloading brings them back, so the screen contradicts itself.
      (Distinct from the known 7-day removal lag, which is tracked in
      `security-todo.md` §7.)
- [ ] **3.5 The Pages health card can report a staging preview as production.**
      `admin/src/ui/useHealthChecks.ts:313` — `listDeployments(1)` has no
      environment filter, and the CMS commits to `staging` on every save, so the
      newest deployment is almost always a preview. A failed production build shows
      a green dot and "Live — last deploy 1 minute ago" next to "Branch: main".
      Fix: filter to `environment === "production"`.
- [ ] **3.6 A deleted storage resource still shows "Connected".**
      `useHealthChecks.ts:440` — `bound` comes from the binding map and is never
      corroborated against the list result. Green requires `bound && resource`;
      `bound && !resource` is an error state.
- [ ] **3.7 Toggling "Localized" on a populated type hides all its content.**
      `admin/src/ui/ContentTypesView.vue:337` — the list then reads
      `folder/<locale>` while the files remain at `folder/`. Still built, still in
      the repo, unreachable from the CMS. One checkbox, no confirm, no migration.
- [ ] **3.8 An invalid hex leaves the field showing a value that was never saved.**
      `admin/src/ui/BrandView.vue:64,209` — `setColor` ignores input failing `HEX`;
      since the bound value never changed, Vue re-renders nothing and the DOM keeps
      the user's text. Success banner, old colour saved.
- [ ] **3.9 The header/footer locale badge implies per-language parts.**
      `admin/src/ui/HeaderFooterView.vue:246` — only the menu is per-locale;
      `partPath()` writes `templates/parts/header.html` globally. Translating the
      header in Español changes English too.
- [ ] **3.10 Field deletion has no confirmation** while the *less* destructive type
      deletion does. `ContentTypesView.vue:86` — the ✕ sits next to the ↑/↓ buttons,
      and the data stays in frontmatter, invisible and uneditable.

---

- [ ] **3.11 An HTML error response is rendered into the UI as text.** Found live,
      2026-08-19: `/admin` served by `astro preview` (which does not run
      `functions/`, so `/admin/api/gh/*` 404s with `Content-Type: text/html`)
      pasted the site's entire 404 document — head, inline CSS, the wordmark SVG
      path data — into a modal. Nothing checks the content type before treating a
      response body as an error message. Not preview-only: the same thing happens
      in production any time the proxy 404s, a login redirect returns HTML, or
      Cloudflare serves an error page. The fix is one guard at the fetch boundary —
      if the response is not JSON, say "the API returned an HTML error page
      (HTTP <status>)" and log the body rather than displaying it.

## 4. Correctness, lower severity

- [ ] **4.1 Theme revert silently truncates at GitHub's 300-file cap.**
      `admin/src/backend/themeHistory.ts:109,128` — `getCommit` and `compare` return
      at most 300 files with no `truncated` flag, and the code guards tree
      truncation but not these. The destructive half: `changedSince` drives the
      conflict warning, so on a long-lived site `computeRevertSet` reports
      `conflicts: []` and the revert overwrites edits the UI just promised to name.
      **That warning is the entire safety net for the operation.** `planRevert` has
      no test; only the pure `computeRevertSet` does.
- [ ] **4.2 The rename path reports "Save failed" on a save that succeeded.**
      `admin/src/ui/useEntryEditor.ts:118-130` — the new file is written, then the
      old one deleted; if the delete fails the whole call throws. The content IS
      committed but the user is told it failed, and Retry (now with
      `renaming === false`) re-writes the new file and never retries the delete,
      leaving an orphan that publishes as a duplicate page.
      (The clobber-an-existing-slug variant is **not** a risk — §0's 422 result.)
- [ ] **4.3 The theme allow-list admits admin-origin code.**
      `admin/src/backend/theme-fileset.ts:15-27,47-51` — `DESIGN_EXPLICIT_FILES`
      includes `admin/src/schema.ts` (compiled into the `/admin` SPA) and
      `DESIGN_DIR_PREFIXES` includes `frontend/lib/` (which holds `sanitize.ts`).
      `theme.ts:136` claims applying a theme does not mean trusting the author with
      who owns the site; these two paths are outside that claim. `theme.test.ts`
      pins neither. Decide the boundary, then pin it with a test.
- [ ] **4.4 The editor's embed iframe has a weaker sandbox than the public site.**
      `admin/src/editor/extensions/Embed.ts:44`, `nodeviews/EmbedView.vue:34`
      hardcode `allow-scripts allow-same-origin` and claim in comments to match the
      public site. They don't: `sanitize.ts:29-55` grants `allow-same-origin` only
      when the src is genuinely third-party — precisely because scripts +
      same-origin on a same-origin src is a sandbox escape. So `/admin`, which holds
      the session cookie and both proxies, has the weaker sandbox.
      Divergence CONFIRMED; exploitability SUSPECTED (needs attacker-controlled
      HTML at a same-origin URL — `media.ts:18` blocks `.html` uploads, but the gh
      proxy is whole-repo write). Fix regardless: share one sandbox rule.
- [ ] **4.5 `checkCloudflare` has no `finally`.** `useHealthChecks.ts:313` — a throw
      past the token check (e.g. `deployment_configs` absent, which is optional in
      `cloudflare.ts:60`) leaves all five cards spinning forever, via an unhandled
      rejection from the un-awaited `onMounted(refreshAll)`. SUSPECTED.
- [ ] **4.6 A malformed tar size field silently applies a partial theme.**
      `admin/src/backend/theme.ts:54` — `readOctal` returns `NaN`, `off` becomes
      `NaN`, the loop exits, and `untar` returns what it parsed so far. `parseTheme`
      only rejects an empty file list, so a corrupt bundle applies its first two
      files as a complete theme and reports success.
- [ ] **4.7 Redirects drops unknown top-level keys.** `RedirectsView.vue:44,111` —
      takes the sha unconditionally but only populates rows if
      `data.redirects` is an array, so a differently-shaped file yields an empty
      editor whose first save writes `{redirects: []}` over it. Also writes a fresh
      object rather than merging; `brand.ts:201` uses `putJsonSafe` for exactly this
      reason.
- [ ] **4.8 Smaller items.** Links lose `target="_blank"` between editor and live
      site (TipTap sets it, `sanitize.ts` has no `ADD_ATTR` for it) and every
      internal link is `nofollow`ed; toolbar "Add" deletes the current selection
      (`Toolbar.vue:95`); heading label lies for H1/H4–H6 (`Toolbar.vue:58`); an
      image inside a `<figcaption>` is dropped (`Figure.ts:24`); a caption-only
      `<figure>` is demoted to a paragraph (`Figure.ts:28`); `listTemplates` is an
      N+1 against the gh proxy on every editor mount (`backend/templates.ts:38`);
      `cloudflare.ts:186` throws a raw `TypeError` when CF returns
      `result: null` (accounts without R2); `version.ts:154` has no fetch timeout,
      so `UpdatesView` can spin forever on a hung registry.

---

## 5. Test gaps worth closing with the fixes

- `planRevert` — no test at all: not the 300-file cap (§4.1), not the
  `tree.truncated` guard, not `status: "renamed"` (GitHub sets `filename` to the
  new path, absent from the parent tree → throws, making such a commit permanently
  un-revertable; `previous_filename` is declared in `github.ts:462` and never read).
- `theme.test.ts` — no malformed-tar case (§4.6), and neither
  `admin/src/schema.ts` nor `frontend/lib/sanitize.ts` is pinned in either
  direction (§4.3).
- `version.test.ts` — `fetchRegistry` is only stubbed with 200-and-valid-JSON;
  `setPinnedVersion`'s partial-failure ordering (lockfile deleted, version not
  bumped) is untested, and that ordering hazard is the entire subject of the
  12-line comment above it.

---

## 6. Confirmed clean — do not re-review

Recorded so the next pass does not spend time here.

- **Encoding is byte-exact.** `utf8ToB64`/`b64ToUtf8` are a proper pair; emoji,
  accents and CJK survive save → load → save.
- **The blob/tree/commit/ref sequence is race-safe** (`github.ts:333`) — the ref
  `PATCH` omits `force`, so a moved branch fails loudly with 422.
- **No swallowed write failures anywhere.** Every write propagates to `reportError`;
  the only silent catches are on advisory reads.
- **Custom nodes round-trip byte-identically** and survive `sanitizeBody`
  unchanged — verified by building the real TipTap schema and running the actual
  parse/serialize/sanitize path, not by reading.
- **No XSS in the editor or previews** — `javascript:`/`data:` are stripped on every
  side tested; both previews use `srcdoc` **without** `allow-scripts`; Toolbar's
  `v-html` is a static icon map.
- **`SaveButton`'s state machine** — re-entry guard plus a disabled-while-saving
  binding: no double-submit, no success-on-throw.
- Also clean: `menu.ts`, `parts-sections.ts` (round-trip verified by its test),
  `redirect-rules.ts` (byte-parity with `scripts/gen-redirects.mjs`), `export.ts`,
  `media.ts`, `MenuEditor.vue`, `OnboardingWizard.vue`, `fields/*` partial-write
  behaviour, and the route/`beforeunload` guards themselves — §1.3 and §1.4 are
  about `isDirty` being wrong when they fire, not about the guards being missing.
