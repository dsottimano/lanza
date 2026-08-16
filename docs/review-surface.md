# The review surface

**Written 2026-08-15, the day it shipped.** How the CMS answers *"what would
publishing this change, and where is it on the page?"* — and why that question,
rather than a better edit form, is the shape of the product.

Companions: `authoring-templates.md` (how a template declares its slots),
`security-model.md` (who may write at all), `todos.md` (what is still open here).

---

## Why this exists

Lanza is heading toward a dashboard where an **agent does the work** and the owner
keeps control. That inverts what an editing screen is for. A form is an input
device for humans; when a machine fills the fields, the human's job becomes
**judging changes**, and the product's job becomes **routing attention**.

One primitive covers content, settings, translations, and eventually ad spend:

> A change is a proposal. It has an author, a rendered before/after, a blast
> radius, and a one-click revert.

Git already provides the hard half. Every change is a commit; the CMS writes to
`staging` and publishes by merging into `main`, so there is already an approval
gate with an immutable history behind it. This subsystem makes that legible.

## The pieces

| Layer | File | Answers |
|---|---|---|
| Comparison | `admin/src/backend/entry-diff.ts` | which FIELDS differ between staging and live |
| Site-wide | `admin/src/backend/pending-changes.ts` | which FILES differ, classified |
| Addressing | `frontend/lib/template-render.ts` | which rendered region came from which slot |
| Preview | `admin/src/ui/PreviewPane.vue` | highlight a region, scroll to it, report clicks |
| Panel | `admin/src/ui/ChangeList.vue` | list the changed fields, offer a revert |
| State | `admin/src/ui/useEntryReview.ts` | load the diff, put one field back |
| Screen | `admin/src/ui/PendingView.vue` | everything waiting, grouped by blast radius |

### The hinge: one path shape

The whole feature depends on two independent path builders agreeing. The FORM
walks the content schema (`field-paths.ts`, stamping `data-field-path`); the
ENGINE walks the template (`renderNodes`, emitting `data-lanza-field`). Neither
knows about the other. They both produce **dot paths with numeric array
segments** — `slots.cards.0.heading` — and `entry-diff` reports the same shape.

A test in `FieldForm.test.ts` asserts they land on the same string, using the real
`templates/manifesto/` template and its real `fields.json`. If either composition
rule drifts, that fails instead of shipping a preview that scrolls to the wrong
section.

Two conversions exist, each in exactly one line of one file:

- **Marker paths are relative to the render root** — the engine renders
  `{ ...slots, body }`, so `heading` there is `slots.heading` to the CMS, while
  `body` stands alone (`PreviewPane.vue`, `toEntryPath`/`toMarkerPath`).
- **Form paths are relative to the data handed to the form** — `TemplateEditor`
  converts entry paths to slot-relative ones once, at the top.

Do not add a third. Any `startsWith("slots.")` outside those two places is a bug
waiting to happen.

## Rules that are load-bearing

**Markers are preview-only.** `render(src, data, { markers: true })` is set in one
place, `PreviewPane.renderBody()`. Production output is byte-identical with the
option off, asserted against pinned literals — not against another `render()`
call, because two runs of a broken engine agree with each other.

**Only text-position slots are marked.** Narrower than "not inside a tag":
`<title>`/`<script>`/`<style>`/`<textarea>` raw text, comments, bogus comments and
SVG foreign content are all outside a tag and would each break a `<span>` in their
own way. Attribute slots (`href="{{url}}"`) get no marker at all — stamping the
enclosing element needs an open-element stack the engine deliberately lacks.
`{{{raw}}}` is never marked: nothing escaped it, so an unbalanced `</span>` inside
would close the wrapper.

**Highlights live in the frame's `<head>`, never on the spans.** The preview
assigns `body.innerHTML` on a 180ms debounce, destroying every span on each
keystroke. A stylesheet rule keyed on an attribute selector survives that with
nothing to re-apply; the click listener is delegated to the body ELEMENT, which
outlives its own innerHTML.

**A revert does not write to GitHub.** It restores the value into the editor and
leaves the entry dirty. Undoing what an agent did must not itself be
irreversible.

**Revert is only offered when the entry exists on both branches.** On a page that
was never published there is no live value to return to — that action is "delete
the page". On a deleted one there is no staged file to write into.

**Container paths.** An added or removed subtree reports the CONTAINER (`slots`),
not its leaves — an absent side gives nothing to walk against. Matching is
therefore prefix-aware and segment-wise: `slots` matches `slots.cards.0.heading`
and never `slotsomething`.

## Traps already paid for

Each of these was found by building it, and each would have shipped silently:

- **`structuredClone` throws on the editor's data.** It is a Vue `reactive()`, i.e.
  a Proxy. The usual fallback, `JSON.parse(JSON.stringify(…))`, flattens `Date` to
  a string.
- **`js-yaml` loads a date field as a `Date`**, which has no own keys — walking it
  as an object makes every date compare equal and date changes vanish.
- **`instanceof Element` is wrong across realms.** A click target inside the
  preview iframe belongs to the frame's realm, so the listener silently never
  fires in a real browser while passing under happy-dom, which shares a realm.
- **`{{ body }}` is a real field name** in the shipped manifesto template (a card's
  text, double-brace and escaped). Wrapping the body unconditionally would print
  the wrapper as visible text on the page.
- **happy-dom does not deliver a click from inside an `<a href>`** to a delegated
  listener. The decision was extracted into a pure function and tested there
  rather than the case being dropped.
- **A localized collection does not mean every file has a locale.** The home page
  sits at the collection root, so `content/pages/home.md` has `locale: null`.

## Behaviour worth knowing before changing it

- Opening an entry lights **every** pending change; picking a row narrows to one.
  An entry an agent edited shows its edits without a click.
- Focusing a field scrolls the preview to its region — unless the region is
  already comfortably in view (judged by how much of it sits inside the viewport,
  not whether its top edge peeks in), or the template does not place that field at
  all, in which case nothing moves rather than jumping to the top.
- Tabbing across a fieldset collapses to one scroll, for where you land.
- Focusing a list item's ↑/↓/✕ buttons reports the ITEM path, so the preview goes
  to that item. A choice, not an accident.
- Saving re-takes the diff. A stale report would offer to revert to a value that is
  no longer live, and it is what keeps array paths valid across two reverts.
