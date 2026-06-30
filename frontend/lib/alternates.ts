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

// Per-collection index: stem → the set of locales it exists in. Built once per
// collection and memoized for the whole build — without this, every page rebuilt
// the full stem map (O(N) per page → O(N²) over the site). The cached value is
// the in-flight promise so concurrent callers share one getCollection pass.
const localeIndexCache = new Map<LocalizedCollection, Promise<Map<string, Set<Locale>>>>();

function localeIndex(collection: LocalizedCollection): Promise<Map<string, Set<Locale>>> {
  let pending = localeIndexCache.get(collection);
  if (!pending) {
    pending = getCollection(collection).then((entries) => {
      const index = new Map<string, Set<Locale>>();
      for (const e of entries) {
        const { locale, slug } = splitId(e.id);
        let locales = index.get(slug);
        if (!locales) index.set(slug, (locales = new Set()));
        locales.add(locale);
      }
      return index;
    });
    localeIndexCache.set(collection, pending);
  }
  return pending;
}

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
  const have = (await localeIndex(collection)).get(stem) ?? new Set<Locale>();
  return LOCALES.filter((l) => have.has(l)).map((l) => ({
    locale: l,
    url: localeUrl(l, prefix ? `${prefix}/${stem}/` : `${stem}/`),
  }));
}

/** Every locale points at `path` — for pages that exist in all (home, authors). */
export function allLocaleAlternates(path: string): Alternate[] {
  return LOCALES.map((l) => ({ locale: l, url: localeUrl(l, path) }));
}
