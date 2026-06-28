// Cross-locale links for a page: which languages it exists in and the URL of
// each. Powers both the header language switcher and the <link rel="alternate"
// hreflang> tags. Translations share a filename stem (see i18n.ts), so an entry's
// alternates are the same stem found under other locale folders.
import { getCollection } from "astro:content";
import { LOCALES, splitId, localeUrl, type Locale } from "./i18n";

export interface Alternate {
  locale: Locale;
  url: string;
}

type LocalizedCollection = "posts" | "pages" | "categories" | "tags";

/**
 * Locales in which `stem` exists for a localized collection, each with its URL.
 * `prefix` is the path segment before the stem ("posts", "category", "tag", or
 * "" for pages).
 */
export async function entryAlternates(
  collection: LocalizedCollection,
  stem: string,
  prefix: string,
): Promise<Alternate[]> {
  const entries = await getCollection(collection);
  const have = new Set(
    entries
      .map((e) => splitId(e.id))
      .filter((s) => s.slug === stem)
      .map((s) => s.locale),
  );
  return LOCALES.filter((l) => have.has(l)).map((l) => ({
    locale: l,
    url: localeUrl(l, prefix ? `${prefix}/${stem}/` : `${stem}/`),
  }));
}

/** Every locale points at `path` — for pages that exist in all (home, authors). */
export function allLocaleAlternates(path: string): Alternate[] {
  return LOCALES.map((l) => ({ locale: l, url: localeUrl(l, path) }));
}
