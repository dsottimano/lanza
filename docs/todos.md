# TODOs

The running work list. Older, deeper lists live in their own files and are linked
from here rather than copied — `security-todo.md` (the auth migration, phase by
phase) and `cms-review-todo.md` (~25 verified defects in `admin/`).

**Started 2026-08-15.** Newest section first.

---

## Next session — start here

1. **Phase 4 of the zero-secret auth migration.** `security-todo.md` §0 is written
   to start cold. First step is not a code change: **sign in on the live site and
   confirm the CMS works end to end**, because phase 4 deletes the fallback and
   should not be done while unable to use its replacement.
2. **Look at the review surface on a real page** (below) and decide whether the
   focus-follow behaviour is right before more is built on it.
3. **Publish `0.1.12`** — but read "Before publishing" below first. Tenants are on
   `0.1.11` and get none of today's work until a release.

---

## Shipped today (2026-08-15), for context

**Auth** — phases 1–3 of `security-todo.md`, live: device-flow sign-in screen,
the gate reading GitHub `permissions`, and the proxy attaching the signed-in
person's own token. No broker mint, no standing PAT, zero secrets on the tenant.

**The review surface** — the product spine from the first-principles session: a
change is a proposal with a diff, a rendered before/after and a one-click revert.
`entry-diff.ts` (field-level staging↔live), preview markers in the render engine,
`ChangeList.vue`, `useEntryReview.ts`, and `PendingView.vue` (the site-wide
"Waiting to publish").

**Editor fixes** — labelled title, resolved URL with locale prefix, per-entry and
per-list language bars, grouped/collapsed template slots, a sticky preview, and
focus-follow.

---

## Open — the review surface

- [ ] **Clicking a preview region does not focus the field.** Selection highlights
      and lists it, but the cursor does not move. This is the step toward editing
      IN the preview and needs a focus-by-path API the form does not have — the
      path plumbing now exists (`field-paths.ts`, `data-field-path` stamps), so the
      missing piece is scroll-and-focus by path, not the addressing.
- [ ] **Click-to-edit in the preview**, the actual goal. Blocked on the preview's
      180ms `innerHTML` swap, which destroys DOM identity on every keystroke: an
      inline editable region needs re-render suppression while it holds focus.
- [ ] **`{{{ body }}}` has no sub-region markers.** The body is one marker, whole.
      Per-paragraph mapping needs the editor's own node positions, not the template
      engine. Fine until someone wants to click a paragraph in the preview.
- [ ] A slot placed directly in `<table>`/`<tr>` content gets foster-parented by
      the browser along with its marker. The raw text already is, marker or not.
- [ ] **`PendingView` has no count badge in the nav.** `pendingCount` (ui/staging.ts)
      only refreshes on editor mount/save, so it would read stale on a fresh load.
      Wire a refresh, then add the badge.
- [ ] Per-row publish does not exist and must not be faked: publishing is a
      staging→main merge, all or nothing. If per-row is wanted it is a real feature
      (cherry-pick or per-path merge), not a UI change.

## Open — settings, and "every possible option"

The inventory is done. Three tiers, in order:

- [ ] **Declare more field-driven screens.** `Field[]` → `FieldForm` already
      renders any declared field set, and exactly one screen uses it (SEO defaults).
      Anything form-shaped costs a JSON entry and no Vue.
- [ ] **Collapse the duplicated catalogs into data** — this is what actually makes
      the CMS configurable, and it is the DRY fix regardless:
      - `FONT_CATALOG` is **triplicated** (`admin/src/backend/brand.ts`,
        `frontend/lib/appearance.ts`, `frontend/styles/site.css`), each with a
        "⚠️ MIRROR" comment.
      - The locale catalog is duplicated: `LANG_CATALOG` (`admin/src/backend/site.ts`)
        vs `KNOWN_LOCALE_CODES` (`frontend/lib/i18n.ts`). Note the second one must
        keep recognising DISABLED locales, so it cannot derive from `site.json` —
        derive both from one catalog instead.
      - `COLOR_TOKENS`, `RADIUS_OPTIONS`, `PRESETS` (`brand.ts`) are fixed enums; a
        seventh colour token needs a code change.
- [ ] **Dead config**: `data/appearance.json`'s `theme` and `logo` are unreachable
      from the UI — `schema.json` still declares them but the sidebar filters that
      entry out. Either wire them or delete the declaration.
- [ ] **Do NOT expose**: the gh-proxy allowlist, `adminLogin`/`owner` (self-promotion),
      branch names (they live in two files with no shared source), media paths
      (changing them breaks every existing image reference).

## Open — the dashboard direction

- [ ] **Global to-do beyond publishing.** `PendingView` answers "what is waiting to
      go out". The dashboard also wants "what needs a decision" — broken links,
      missing translations, a page no one has touched in a year.
- [ ] **Connectors, read-only first** (Search Console). Anything that SPENDS money
      (Meta ads) reintroduces the standing-secret blast radius the auth migration
      just removed, and needs a spend gate that a typo fix does not.
- [ ] **Agent attribution.** Every change is already a commit with an author, and
      nothing in the UI shows who made it. "The agent changed this" vs "you changed
      this" is the difference between reviewing and re-reading.

## Open — smaller, and unrelated

- [ ] `cms-review-todo.md` — ~25 verified defects in `admin/`, none fixed.
- [ ] Rotate the credentials `keys-and-secrets.md` §7 lists as owed.
- [ ] Point the bot's `GITHUB_TOKEN` at `staging`, not `main`.
- [ ] `vue-tsc` segfaulted once during this session (clean on re-run, exit 0). If it
      recurs, it is the toolchain, not the types.

---

## Before publishing `0.1.12`

`functions/` ships inside the `lanza-site` package and `bin/lanza.mjs` copies it
into the tenant repo at build time, so **a release replaces every tenant's auth
gate and both proxies at once**. Two things to settle first:

- [ ] **Finish phase 4.** Mid-migration, `editors` in `lanza.config.json` controls
      nothing (roles come from GitHub collaborators) while `PeopleView` still edits
      that list — a tenant owner would "invite" someone and nothing would happen,
      silently. Phase 4 replaces that panel with a link to GitHub's collaborator
      settings.
- [ ] **Verify against a datadefine-owned tenant** (`dmg` / `mcp-test`), never a
      customer. A `ghu_` token is bounded by *App installation ∩ the user's own
      permission*, and today's work is only proven on `dsottimano/lanza`, where the
      App is installed. If a tenant repo lacks the installation, device-flow tokens
      may not see it and everyone there is locked out of their own CMS.
- [ ] Every tenant editor is signed out at once by the release and needs one device
      code. That should land with working invite UI, not before it.
