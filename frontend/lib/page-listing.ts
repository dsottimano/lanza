// Page presets may declare a listing using the same fields.json contract as
// routed collection indexes. Copy stays in the page; entries remain in their
// schema collection and use the shared publish gate and public URL resolver.
// The optional `date` / `latest` keys are functions/_lib/listing-scope.mjs.
import { fieldRecords } from "./provenance/text.mjs";
import { getCollection } from "astro:content";
import { splitId, type Locale } from "./i18n";
import { isPublished } from "./routing";
import { contentUrl, POSTS_BASE } from "./public-urls";
import { listingOptionErrors, listingItem, listingParts } from "../../functions/_lib/listing-scope.mjs";
import schema from "/data/schema.json";

const declarations = import.meta.glob<{ listing?: {
  of: string; item: string[]; sortBy?: string; order?: "asc" | "desc"; date?: string; latest?: number;
} }>("/templates/*/fields.json", { eager: true, import: "default" });

export async function pageListingScope(name: string, locale: Locale, slots: Record<string, unknown>) {
  const listing = declarations[`/templates/${name}/fields.json`]?.listing;
  if (!listing) return slots;
  const collection = schema.find((c) => c.kind === "folder" && c.name === listing.of);
  if (!collection) throw new Error(`Template ${name}: unknown listing collection ${listing.of}`);
  const invalid = listingOptionErrors(listing);
  if (invalid.length) throw new Error(`templates/${name}/fields.json: ${invalid.join(" ")}`);
  // Posts carry a `route` too, but theirs is not a generated base: POSTS_BASE is the
  // validated answer ("posts", or "" at the root).
  const base = listing.of === "posts" ? POSTS_BASE
    : (collection as { route?: { base: string } }).route?.base ?? (listing.of === "pages" ? "" : listing.of);
  const key = listing.sortBy ?? "title";
  const direction = listing.order === "desc" ? -1 : 1;
  const entries = (await getCollection(listing.of as "posts", ({ data }) => isPublished(data)))
    .filter((entry) => !collection.localized || splitId(entry.id).locale === locale)
    .sort((a, b) => {
      const left = (a.data as Record<string, unknown>)[key];
      const right = (b.data as Record<string, unknown>)[key];
      return direction * (left instanceof Date && right instanceof Date
        ? +left - +right : String(left ?? "").localeCompare(String(right ?? "")));
    })
    .map((entry) => ({
      ...listingItem(entry.data as Record<string, unknown>, listing, locale),
      lanzaProvenance: (entry.data as Record<string, unknown>).lanzaProvenance,
      slug: splitId(entry.id).slug,
      url: contentUrl(listing.of, entry.id, base),
    }));
  const { scope, fields } = listingParts(entries, listing, fieldRecords);
  return { ...slots, lanzaProvenance: { version: 1, fields: { ...fieldRecords(slots), ...fields } }, ...scope };
}
