# Authoring HTML templates

Audience: the coding agent that operates a Lanza tenant repo (and the curious dev).
This is the convention for turning a web design into a Lanza **template** the site
owner can then fill from the CMS. It is piece 3 of template authoring — the engine
(`frontend/lib/template-render.ts`) and the CMS are pieces 1 and 2; this doc is the
contract you follow.

## The loop

The user finds (or asks you to build) a design → you reproduce it as plain HTML/CSS →
you convert that HTML into a **template** (`template.html` with `{{placeholders}}` +
`fields.json` describing the editable fields) → the user just fills those fields in
the CMS and publishes. Templates live in the **tenant repo** at `templates/<name>/`,
not in the `@lanza/site` package: they are agent-authored, hand-editable, and survive
package updates (the package never overwrites the tenant's `templates/`).

## Anatomy of a template

```
templates/<name>/
  template.html   # the design: HTML + CSS with {{placeholders}}
  fields.json     # the editable-field schema (mirrors the CMS Field model)
```

- **`template.html`** — the design's markup. It owns the whole page region and is
  emitted **verbatim**. A leading `<style>` block is fine and is emitted **globally**
  (it is not scoped), so **namespace every class** — the manifesto prefixes all of
  its with `.lz` / `.lz-*`. Editable spots are `{{placeholders}}` (see syntax below).
- **`fields.json`** — declares the fields the CMS shows for this template:
  `{ "name", "label", "description", "fields": [ … ] }`. Each entry in `fields`
  mirrors the CMS `Field` shape (`admin/src/schema.ts`): `name`, `label`, `widget`,
  optional `required` (default true — set `false` for optional), and for `list`/
  `object` widgets a nested `fields: [ … ]`.

Only `template.html` and the page's `slots` reach the render engine. `fields.json` is
the authoring/CMS side — it tells the editor what to collect. Keep the field `name`s
identical to the `{{placeholders}}` in `template.html`; the engine matches by name.

## The engine — authoritative syntax

The engine is a small Handlebars-ish **subset**. It supports exactly the following and
nothing else. Anything not on this list is treated as literal text or silently renders
empty — do **not** reach for Handlebars features that aren't here.

| Syntax | Meaning |
| --- | --- |
| `{{ name }}` | Interpolate a value. The value is **HTML-escaped**. Whitespace inside the braces is ignored. |
| `{{ a.b.c }}` | Dotted path — resolves `a`, then walks into `.b.c`. Missing → empty string. |
| `{{#each list}} … {{/each}}` | Repeat the body once per array item. Inside, the item's own fields resolve **by bare name**. Non-array or empty → renders nothing. |
| `{{#if cond}} … {{/if}}` | Render the body only if `cond` is truthy. |
| `{{ @index }}` | Inside `{{#each}}`: 0-based item position, as a number (`0`, `1`, …). |
| `{{ @number }}` | Inside `{{#each}}`: 1-based position, zero-padded to width 2 (`01`, `02`, … `10`). |

Resolution rule: bare names resolve from the **innermost `{{#each}}` item outward** to
the page's top-level slots — the first scope that owns the name wins. So inside a loop
you can still reference an outer slot if the item doesn't define that name.

Truthiness for `{{#if}}`: a **non-empty array** is truthy; an **empty array** is falsy;
otherwise standard JS `Boolean()` (so `""`, `0`, `null`, `undefined`, `false` are
falsy). A missing slot is falsy — the idiomatic way to make a region optional.

Trust model: the **template is author-trusted and emitted verbatim** — your markup,
`<style>`, everything passes through unchanged. Only the interpolated **values** (the
page's slot data, which is user-entered) are HTML-escaped. The engine escapes values;
it does not sanitize your template.

### Not supported — will fail silently

- **No `{{else}}`.** Write two `{{#if}}` blocks (e.g. `{{#if x}}…{{/if}}` and a second
  guarded region) if you need an alternative.
- **No `{{this}}` / no `../` parent path / no block params (`as |x|`).** An `{{#each}}`
  item must therefore be an **object** whose sub-fields you print by name — you cannot
  print a bare string item (a plain string list has no name to reference).
- **No partials (`{{> …}}`), no helpers, no inline expressions/operators, no comments
  (`{{! …}}`).**
- **No triple-mustache (`{{{ … }}}`).** All values are escaped; there is no raw-HTML
  interpolation. If a field must carry markup, that is a design change, not a syntax one.
- Interpolating an **object or array** with `{{ x }}` yields an empty string (it will not
  print `[object Object]`). Only render leaf values.

## The conversion recipe

1. **Get the design working as static HTML/CSS first.** Namespace your CSS classes.
2. **Find the editable regions.** Any text/URL the owner would change is a field.
   Repeating structures (cards, steps, tiles, nav items) are lists. Regions that may
   be absent are `{{#if}}` blocks.
3. **Replace in `template.html`:**
   - editable text/attribute → `{{ fieldName }}` (works in text and in `href="…"`).
   - a repeating block → wrap one instance in `{{#each listName}} … {{/each}}` and
     reference each item's fields by bare name; use `{{ @number }}` for a 1-based
     counter (step numbers), `{{ @index }}` for a 0-based one.
   - an optional block → `{{#if fieldName}} … {{/if}}`.
4. **Write `fields.json`** to match. Pick widgets:
   - `string` — short single-line text (headline, label, URL, button text).
   - `text` — multi-line prose (subheading, body copy).
   - `list` with nested `fields` — a repeater; the sub-`fields` are the item's bare
     names used inside `{{#each}}`.
   - Other CMS widgets exist (`image`, `boolean`, `number`, `select`, …) — see the
     `Widget` union in `admin/src/schema.ts`.
5. **Seed a page.** Create/point a page's frontmatter `slots:` at real content, keys
   matching your field names (lists as YAML arrays of objects).
6. **Wire the page:** set `preset: "<name>"` in the page frontmatter. `PageArticle`
   renders `templates/<preset>/template.html` with that page's `slots`.

The **manifesto** template (`templates/manifesto/`) is the worked example: it uses
`{{#each steps}}` with `{{ @number }}` for the spine's step numbers, and `{{#each
cards}}` / `{{#each tiles}}` for the audience doors and cost tiles — each a `list`
widget with sub-`fields` in `fields.json`, filled by the `slots:` array in
`content/pages/es/home.md`.

## Richer templates: fields & post types

If a template needs data the content model doesn't have yet — new frontmatter fields,
or a whole new content type — that lives in the **content model**, which is the single
source of truth in `admin/src/schema.ts` / `data/schema.json` (edited via the CMS
content-type editor). Add it there; don't duplicate the model inside a template. The
per-template `fields.json` only describes that template's own `slots`.

## Minimal end-to-end example

A two-field hero: an escaped `{{ headline }}` and a `{{#each buttons}}` loop.

`templates/hero/template.html`
```html
<style>
  .hero { padding: 4rem 1.5rem; text-align: center; }
  .hero__h { font-size: 2.5rem; margin: 0 0 1.5rem; }
  .hero__btn { display: inline-block; margin: 0 .4rem; padding: .8rem 1.4rem;
               border: 1px solid currentColor; border-radius: 6px; text-decoration: none; }
</style>
<section class="hero">
  <h1 class="hero__h">{{ headline }}</h1>
  {{#if buttons}}
    <div class="hero__btns">
      {{#each buttons}}
        <a class="hero__btn" href="{{ url }}">{{ label }}</a>
      {{/each}}
    </div>
  {{/if}}
</section>
```

`templates/hero/fields.json`
```json
{
  "name": "hero",
  "label": "Hero",
  "description": "A centered headline with a row of buttons.",
  "fields": [
    { "name": "headline", "label": "Headline", "widget": "string" },
    {
      "name": "buttons",
      "label": "Buttons",
      "widget": "list",
      "required": false,
      "fields": [
        { "name": "label", "label": "Button text", "widget": "string" },
        { "name": "url", "label": "Button URL", "widget": "string" }
      ]
    }
  ]
}
```

Page frontmatter (`content/pages/<locale>/<slug>.md`)
```yaml
---
title: "Home"
draft: false
preset: "hero"
slots:
  headline: "Launch a site that's really yours."
  buttons:
    - label: "Get started"
      url: "/start"
    - label: "How it works"
      url: "/how-it-works"
---
```

The `{{#if buttons}}` guard drops the whole button row if the owner clears the list;
`{{ headline }}` and each button's `{{ label }}` / `{{ url }}` are HTML-escaped on the
way out.
