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
 * A field's path inside its parent's. The ONE place a path is composed — object keys and
 * list indices are the same operation, so they are the same function, and no component
 * builds a path with `+`.
 *
 *   childPath(undefined, "cards") === "cards"        a top-level field
 *   childPath("cards", 0)         === "cards.0"      a list item
 *   childPath("cards.0", "title") === "cards.0.title"
 */
export function childPath(parent: string | undefined, key: string | number): string {
  return parent ? `${parent}.${key}` : String(key);
}

/**
 * The innermost field path at a DOM target — for one delegated focus listener instead of
 * a handler per input. `closest` means a nested field reports its own path and not its
 * container's, which is the whole reason the listener can be delegated.
 *
 * Duck-typed rather than `instanceof Element`: a target may come from another realm, and
 * an instanceof guard would silently reject every event.
 */
export function fieldPathOfTarget(target: EventTarget | null): string | null {
  const el = (target as Element | null)?.closest?.("[data-field-path]") ?? null;
  return el?.getAttribute("data-field-path") || null;
}

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
/**
 * A slot path back to an entry path — the exact inverse of `toSlotPaths`, for the other
 * direction of the same conversation: the review tells the form what changed, the form
 * tells the preview where the person is working.
 *
 * (PreviewPane has its own `toEntryPath` for MARKER paths. Same shape, different source:
 * that one also has to account for the reserved `body` key, which is not a slot.)
 */
export function toEntryPath(slotPath: string): string {
  return slotPath ? `${SLOTS_PREFIX}.${slotPath}` : SLOTS_PREFIX;
}

export function toSlotPaths(entryPaths: readonly string[]): string[] {
  const out: string[] = [];
  for (const path of entryPaths) {
    if (path === SLOTS_PREFIX) out.push("");
    else if (path.startsWith(`${SLOTS_PREFIX}.`)) out.push(path.slice(SLOTS_PREFIX.length + 1));
  }
  return out;
}
