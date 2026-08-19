# The site system

Audience: the agent that builds a Lanza site for someone, and the person reviewing what
it built. `docs/authoring-templates.md` is the syntax of one template; this is the
composition rule for a whole site — what may reference what, and why a site made of
correct-looking parts can still be wrong.

The enforcement lives in `scripts/site-system.mjs` and runs as `npm run check:site`.
This doc and that file are meant to agree; the file wins.

## The one rule

> **A layer may only reference names the layer below it declares.**

Everything else here is a consequence. The reason it needs stating at all is that
Lanza's failures in this area are **silent**: a misspelled `{{placeholder}}` renders as
empty text, a field nobody interpolates is an input the owner fills for nothing, and a
content type with no route stores entries at no URL. In every case the build passes and
the page is merely wrong — which is the worst way for a system an agent operates to
fail, because the agent has no way to notice.

## The layers

Bottom-up. Each layer declares names; the one above may use them and nothing else.

| Layer | Declares | Lives in |
|---|---|---|
| **Style** | design tokens — colour, corner, motion, type | `data/appearance.json`, variants in `data/styles.json` |
| **Chrome** | header/footer | `templates/parts/*.html` (data from `Base.astro`, no `fields.json`) |
| **Templates** | page regions + the slots that fill them | `templates/<name>/{template.html,fields.json}` |
| **Content model** | collections and their fields | `data/schema.json` |
| **Routes** | the URL a collection renders at | `data/schema.json` → generated `.astro` |
| **Content** | entries | `content/**/*.md` |

Two of these are generated and must never be hand-edited: `frontend/content.config.ts`
(from the model) and the route files (from `collection.route`). Both are regenerated on
every build and any edit is lost.

## Building a site from a brief

Someone says *"I want a simple event site."* That is a request for five artifacts that
only work if they agree. In order:

1. **Name the content types.** An event site has `events`. Anything with its own URL and
   its own fields is a type; anything that is one-off text is a page.
2. **Write the detail template** — `templates/event/`. The markup, and a `fields.json`
   declaring every editable spot. **This is where the fields are declared, once.**
3. **Write the listing template** if the type needs an index — `templates/event-index/`,
   with a `listing` block naming the collection and which item fields it prints.
4. **Declare the route** on the collection so the entries have URLs.
5. **Offer styles, don't pick one.** Put two or three variants in `data/styles.json` and
   let the owner compare them at `/style-preview/` before anything is published.

Then run the checker. Do not hand over a site you have not validated.

The worked example is `recipes/event-site/` — a real, applied, built-and-verified
version of exactly the above.

## Positions: the thing that is easiest to get wrong

A template's **position** decides what the engine puts in scope beyond its own declared
fields. The same markup is correct in one position and silently empty in another, so the
position is derived from the routes that reference the template — never guessed.

| Position | Scope is | Also gets |
|---|---|---|
| `page` | a page's freeform `slots` | `body` if `fields.json` sets `"body": true` |
| `detail` | **the entry's frontmatter** | `url`, `slug`, `indexUrl`, `body` |
| `list` | the listing's own slots | `entries` (each item + `url`/`slug`), `count`, `isEmpty` |

The generalisation worth understanding: the engine does not care where its data came
from. Handing it an entry's frontmatter instead of a page's slots is what makes a content
type renderable with no new rendering path — a content type plus a template **is** a page.

`isEmpty` exists because the engine has no `{{else}}`. An empty state needs a second,
opposite `{{#if}}` — the same reason `Base.astro` pairs `active`/`inactive` on the
language switcher.

## Declare once

A collection's fields and its detail template's `fields.json` describe the same thing.
Writing both is how they drift, so **the template declares them and the collection is
derived** (`fieldsFrom` in a recipe). If you are typing a field name for the second time,
stop — one of the two places is wrong by tomorrow.

## Recipes

A recipe is the single artifact that expands into a whole site. A directory, not a blob,
so every part stays hand-editable and diffable:

```
recipes/<name>/
  recipe.json                              content types, routes, menu, styles
  templates/<t>/{template.html,fields.json}
  styles.json                              the looks on offer
  content/<collection>/<locale>/*.md       seed entries (optional)
```

```sh
node scripts/apply-recipe.mjs recipes/event-site --dry-run   # see it first
node scripts/apply-recipe.mjs recipes/event-site
```

**Nothing is written until every check passes.** A half-applied recipe leaves a content
type whose template does not exist — broken in a way neither the owner nor the agent can
see, which is worse than the apply having failed outright.

## Style, before it is live

Setting the brand shows one look at a time and asks the owner to imagine the others.
`data/styles.json` holds named variants; `/style-preview/` renders them side by side
using the exact tokens (`resolveBrand`) the live site would use.

The route exists **only** when that file does — no file, no pages, and a site that never
asked for it is byte-identical. Choosing a variant writes `brand` into
`data/appearance.json`: an ordinary reviewable, revertable change per
`docs/review-surface.md`.

The specimens are honest about being specimens — one card, not a fake screenshot of the
real page — so the comparison is truthful about type, colour, corner and contrast without
pretending to be a page it is not.

## The checker

```sh
npm run check:site          # errors fail; warnings print
npm run check:site -- --strict
```

It mirrors the engine's grammar and scope resolution (`frontend/lib/template-render.ts`)
rather than approximating them, because **a checker that disagrees with the engine is
worse than no checker** — it either blesses a broken page or blocks a working one.
`scripts/site-system.test.mjs` pins this both ways: the real manifesto template must come
back clean, and for each failure it reports, the same markup is rendered through the real
engine and asserted to actually misbehave.

What it catches, all of it otherwise silent:

| Code | The failure |
|---|---|
| `undeclared-slot` | a placeholder no enclosing scope declares — renders as empty text |
| `each-over-scalar` | `{{#each}}` over a non-list — renders nothing |
| `unclosed-block` | the engine drops the rest of the page |
| `body-used-undeclared` | `{{{ body }}}` without `"body": true` — canvas hidden, so always empty |
| `body-declared-unused` | `"body": true` with no `{{{ body }}}` — a writing canvas that goes nowhere |
| `raw-non-body` | `{{{ x }}}` on anything but `body` — emits user input unescaped |
| `unused-field` | an input the owner fills that appears nowhere |
| `listing-unknown-field` | a listing prints a field its collection does not have |
| `route-template-missing` | a live URL rendering "Unknown template" |

Publishing fields (`draft`, `seo`, `template`, `preset`, `slots`) are exempt from
`unused-field` — they control publishing rather than being printed, and a warning that
fires forever is a warning nobody reads.

## Traps

- **`template` and `preset` are different things.** `template` is the layout variant
  (`default` / `full-width` / `landing`, see `frontend/lib/templates.ts`); `preset` names
  the folder under `templates/`. The names are near-synonyms and an agent reliably guesses
  wrong. A page's `preset` names the **folder**, and `fields.json`'s `name` must match it.
- **A template's `<style>` is emitted globally, not scoped.** Namespace every class.
- **Parts have no `fields.json`.** Their contract is `partData` in `Base.astro`, mirrored
  in `site-system.mjs` as `PART_DATA`. `docs/authoring-templates.md` advertises
  `{{#if showNav}}`, which **does not exist** — the real name is `showSwitcher`. The
  checker catches this now; the doc is still wrong.
- **`docs/authoring-templates.md`'s "not supported" list says there is no triple-brace.**
  There is: `{{{ body }}}`, and the syntax table two sections earlier documents it. The
  engine is the authority.
- **Route bases are validated, not trusted.** `data/schema.json` is untrusted input that
  reaches file paths and generated code, so `gen-routes.mjs` enforces a strict segment
  pattern and refuses reserved bases — same posture as `gen-content-config.mjs`.

## Not covered yet

Honest list of what this does **not** do, so nobody assumes otherwise:

- The CMS does not yet expose the `route` block or `/style-preview/` in its UI — both are
  edited as data (`data/schema.json`, `data/styles.json`) or written by a recipe.
- There is no MCP tool for any of this. An agent connected over MCP can still only edit
  content, not create a content type, a template or a route. That is the biggest remaining
  gap between this system and the pitch.
- Taxonomy-style routes for a custom type (an `/events/tag/<x>/` archive) are not
  generated; only the listing and the detail page are.
- Recipes never delete. Applying one twice refuses rather than merging.
