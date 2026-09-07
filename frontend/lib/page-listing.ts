// Page presets may declare a listing using the same fields.json contract as
// routed collection indexes. Copy stays in the page; entries remain in their
// schema collection and use the shared publish gate and public URL resolver.
import { getCollection } from "astro:content";
import { splitId, type Locale } from "./i18n";
import { isPublished } from "./routing";
import { contentUrl } from "./public-urls";
import schema from "/data/schema.json";

const declarations = import.meta.glob<{ listing?: {
  of: string; item: string[]; sortBy?: string; order?: "asc" | "desc";
} }>("/templates/*/fields.json", { eager: true, import: "default" });

export async function pageListingScope(name: string, locale: Locale, slots: Record<string, unknown>) {
  const listing = declarations[`/templates/${name}/fields.json`]?.listing;
  if (!listing) return slots;
  const collection = schema.find((c) => c.kind === "folder" && c.name === listing.of);
  if (!collection) throw new Error(`Template ${name}: unknown listing collection ${listing.of}`);
  const base = (collection as { route?: { base: string } }).route?.base
    ?? (listing.of === "pages" ? "" : listing.of);
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
      ...Object.fromEntries(listing.item.map((field) => {
        const value = (entry.data as Record<string, unknown>)[field];
        return [field, value instanceof Date ? value.toISOString().slice(0, 10) : value];
      })),
      slug: splitId(entry.id).slug,
      url: contentUrl(listing.of, entry.id, base),
    }));
  return { ...slots, entries, count: entries.length, isEmpty: entries.length === 0 };
}
