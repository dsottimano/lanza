// Which fields a set of changed paths touches.
//
// A review reports what an agent changed as ENTRY paths — `slots.cards.0.heading`,
// `title` — because that is how an entry's data is addressed everywhere else (the diff,
// the preview's markers, the frontmatter itself). A FieldForm, though, renders fields
// against ONE object and knows only their bare names (`cards`).
//
// So there is exactly one conversion, and it lives here: TemplateEditor calls
// `toSlotPaths` once on its way into the form, and everything below that point speaks
// paths relative to the data being edited. Nothing else does prefix arithmetic — a
// `startsWith` at each call site is how the two vocabularies quietly drift.

/** The entry key holding a template's slot values. */
export const SLOTS_PREFIX = "slots";

/**
 * Does a changed path touch this field? True when either contains the other, because a
 * report can name a path at any depth:
 *   `cards.0.heading` changed → the `cards` field is affected (the leaf is inside it)
 *   `cards` changed           → so is every part of it (the field IS the container)
 * The `.` keeps it segment-wise: `cards` must not match a field named `cardstack`.
 *
 * The empty path is "the whole object", which touches everything — it is what an entry
 * path of exactly `slots` becomes.
 */
export function touchesField(changedPath: string, fieldName: string): boolean {
  if (changedPath === "") return true;
  return (
    changedPath === fieldName ||
    changedPath.startsWith(`${fieldName}.`) ||
    fieldName.startsWith(`${changedPath}.`)
  );
}

/** Is any of these changed paths inside (or containing) this field? */
export function anyTouchesField(changedPaths: readonly string[], fieldName: string): boolean {
  return changedPaths.some((p) => touchesField(p, fieldName));
}

/**
 * Entry paths → paths relative to the entry's `slots` object.
 *
 * Paths outside `slots` (`title`, `draft`, `seo.description`) are dropped: they are not
 * fields this form renders, and keeping them would open groups for changes that are not
 * in them. `slots` on its own becomes "" — the whole object changed.
 */
export function toSlotPaths(entryPaths: readonly string[]): string[] {
  const out: string[] = [];
  for (const path of entryPaths) {
    if (path === SLOTS_PREFIX) out.push("");
    else if (path.startsWith(`${SLOTS_PREFIX}.`)) out.push(path.slice(SLOTS_PREFIX.length + 1));
  }
  return out;
}
