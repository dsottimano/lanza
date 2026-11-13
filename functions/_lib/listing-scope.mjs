// What a PAGE listing puts in its template's scope, beyond the page's own slots.
//
// A page preset may declare in its fields.json
//
//   "listing": { "of": "posts", "item": ["title", "description", "featuredImage"],
//                "sortBy": "pubDate", "order": "desc",
//                "date": "pubDate",   // optional: adds `date` + `dateLong` per item
//                "latest": 2 }        // optional: adds `latest` / `rest` split lists
//
// and the page keeps its own URL, slots and SEO while its template loops over the
// collection's published entries (frontend/lib/page-listing.ts, and the CMS preview in
// admin/src/backend/page-listing.ts). The engine cannot format a date and has no
// {{else}}, so this module formats the date and pairs every list with an `…IsEmpty`.
//
// ONE implementation for the build, the CMS preview and the checker
// (site-system.mjs), which is why it lives under functions/: no node builtins, no
// dependencies, no import attributes. fields.json is UNTRUSTED (an MCP agent writes
// it), so the options are validated, and values only ever reach the template engine,
// which escapes them.

/** Most entries a `latest` split may take. Bounded so a typo is an error, not a page. */
export const LATEST_MAX = 50;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Item names this module adds when `listing.date` is set. */
export const LISTING_DATE_NAMES = ["date", "dateLong"];
/** Top-level names this module adds when `listing.latest` is set. */
export const LISTING_SPLIT_LISTS = ["latest", "rest"];
export const LISTING_SPLIT_FLAGS = ["latestIsEmpty", "restIsEmpty"];

/**
 * Problems with the optional `date` / `latest` keys. Empty means valid.
 * @param {unknown} listing
 * @returns {string[]}
 */
export function listingOptionErrors(listing) {
  if (!listing || typeof listing !== "object") return [];
  const errors = [];
  if (listing.date !== undefined && (typeof listing.date !== "string" || !FIELD.test(listing.date))) {
    errors.push(`listing.date ${JSON.stringify(listing.date)} is not a field name.`);
  }
  if (listing.latest !== undefined && !(Number.isInteger(listing.latest) && listing.latest >= 1 && listing.latest <= LATEST_MAX)) {
    errors.push(`listing.latest ${JSON.stringify(listing.latest)} must be a whole number from 1 to ${LATEST_MAX}.`);
  }
  return errors;
}

/** A frontmatter value as a Date: a Date, or an ISO-dated string (JSON frontmatter). */
export function dateOf(value) {
  if (value instanceof Date) return Number.isNaN(+value) ? null : value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(+d) ? null : d;
  }
  return null;
}

/** "June 9, 2026" in English, "9 de junio de 2026" in Spanish. UTC, like the ISO date. */
export function longDate(date, locale) {
  try {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * One listing item: the declared `item` fields (dates as YYYY-MM-DD), plus `date` and
 * `dateLong` when `listing.date` is set and the entry has that date. The caller adds
 * `slug`, `url` and provenance.
 */
export function listingItem(data, listing, locale) {
  const item = {};
  for (const field of listing.item) {
    const value = data[field];
    item[field] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  }
  if (listing.date) {
    const d = dateOf(data[listing.date]);
    if (d) {
      item.date = d.toISOString().slice(0, 10);
      item.dateLong = longDate(d, locale);
    }
  }
  return item;
}

/**
 * The listing's scope keys for already-sorted items: `entries`, `count`, `isEmpty`,
 * and with `listing.latest` set, `latest` (the first N), `rest` (the others) and their
 * `latestIsEmpty` / `restIsEmpty` flags. `fields` is the per-item provenance, keyed by
 * the path the engine computes inside each loop (`latest.0.title`).
 */
export function listingParts(items, listing, recordsOf) {
  const scope = { entries: items, count: items.length, isEmpty: items.length === 0 };
  const lists = { entries: items };
  if (listing.latest) {
    const latest = items.slice(0, listing.latest);
    const rest = items.slice(listing.latest);
    Object.assign(scope, { latest, rest, latestIsEmpty: latest.length === 0, restIsEmpty: rest.length === 0 });
    Object.assign(lists, { latest, rest });
  }
  const fields = {};
  for (const [name, list] of Object.entries(lists)) {
    list.forEach((item, index) => {
      for (const [path, value] of Object.entries(recordsOf(item))) fields[`${name}.${index}.${path}`] = value;
    });
  }
  return { scope, fields };
}
