// Runtime half of GENERIC COLLECTION ROUTING.
//
// The gap this closes: `data/schema.json` could always declare a new content type
// (gen-content-config.mjs turns it into an Astro collection, and the CMS edits it
// happily) — but every public URL was a hand-written .astro file, so a content type
// invented in the CMS rendered at NO URL. You could create events all day and no one
// could read one. Tenants cannot ship .astro, so they could not fix it either.
//
// A collection now declares where it lives, and scripts/gen-routes.mjs emits the
// route files. This module is what those generated files call.
//
// The generalisation that makes it work: the template engine does not care that its
// data came from a page's freeform `slots`. Give it an ENTRY'S FRONTMATTER as the
// scope and the same templates/<name>/ machinery renders a content type — so a
// content type plus a template is a rendered page, with no new rendering path.
import { getCollection, type CollectionEntry } from "astro:content";
import { splitId, localeUrl, type Locale } from "./i18n";
import { isPublished } from "./routing";

/** How a collection reaches the public web. Mirrored in scripts/gen-routes.mjs. */
export interface CollectionRoute {
  /** First URL segment: "events" → /events/… (and /<locale>/events/…). */
  base: string;
  /** templates/<name>/ rendered for a single entry. */
  template: string;
  /** Optional listing at /<base>/. Omit for detail-only collections. */
  list?: {
    template: string;
    /** Frontmatter field to order by (default "title"). */
    sortBy?: string;
    order?: "asc" | "desc";
    /**
     * The listing page's own editable text (heading, intro, empty state). A listing
     * has no entry of its own to carry frontmatter, so its slots live here — in
     * schema.json, which the CMS content-type editor already writes.
     */
    slots?: Record<string, unknown>;
  };
}

type AnyEntry = CollectionEntry<"posts">;

/** Published entries of a collection, draft-gated. Name is validated by the generator. */
export async function routeEntries(collection: string): Promise<AnyEntry[]> {
  return (await getCollection(collection as "posts", ({ data }) => isPublished(data))) as AnyEntry[];
}

/** The public URL of one entry. */
export function entryUrl(base: string, locale: Locale, slug: string): string {
  return localeUrl(locale, `${base}/${slug}/`);
}

// Frontmatter values the template engine can print. Dates become ISO strings (the
// engine only renders leaf values; a Date would stringify unhelpfully or not at all),
// and everything else passes through for {{#each}} / dotted access.
function renderable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(renderable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, renderable(v)]));
  }
  return value;
}

/**
 * The data scope for a DETAIL template: the entry's frontmatter, plus `url` and
 * `slug`, plus the reserved `body` slot (already sanitized by the caller).
 */
export function detailScope(entry: AnyEntry, base: string, locale: Locale, body: string): Record<string, unknown> {
  const { slug } = splitId(entry.id);
  return {
    ...(renderable(entry.data) as Record<string, unknown>),
    slug,
    url: entryUrl(base, locale, slug),
    // The listing this entry belongs to. Derived, so a detail template can link back
    // without every entry carrying a hand-typed URL that goes stale on a route change.
    indexUrl: localeUrl(locale, `${base}/`),
    body,
  };
}

/**
 * The data scope for a LIST template: `{{#each entries}}` over each entry's
 * frontmatter plus `url`/`slug`. Sorted by the declared field.
 */
export function listScope(
  entries: AnyEntry[],
  base: string,
  locale: Locale,
  list: NonNullable<CollectionRoute["list"]>,
): Record<string, unknown> {
  const key = list.sortBy || "title";
  const dir = list.order === "desc" ? -1 : 1;

  const rows = entries
    .map((entry) => {
      const { slug } = splitId(entry.id);
      const data = entry.data as unknown as Record<string, unknown>;
      return {
        raw: data[key],
        item: {
          ...(renderable(data) as Record<string, unknown>),
          slug,
          url: entryUrl(base, locale, slug),
        },
      };
    })
    .sort((a, b) => {
      const x = a.raw;
      const y = b.raw;
      if (x instanceof Date && y instanceof Date) return (x.valueOf() - y.valueOf()) * dir;
      return String(x ?? "").localeCompare(String(y ?? "")) * dir;
    });

  // `isEmpty` exists because the engine has no {{else}}: a template that wants an
  // empty state has to guard it with a second, opposite {{#if}}. Same reason
  // Base.astro pairs `active`/`inactive` on the locale switcher.
  return {
    ...(list.slots ?? {}),
    entries: rows.map((r) => r.item),
    count: rows.length,
    isEmpty: rows.length === 0,
  };
}
