// The single home of the "which locale renders where" rule for the route pairs.
// Default locale lives at the root (/posts/x/); other ENABLED locales live under
// a prefix (/es/posts/x/). Known-but-disabled locale folders are excluded from
// the build (never mis-rendered as default-locale slugs). Each root vs [locale]
// route pair partitions its collection through here so the rule lives once.
import { splitId, isLocale, DEFAULT_LOCALE, LOCALES, type Locale } from "./i18n";

export interface TaggedEntry<E> {
  entry: E;
  locale: Locale;
  slug: string;
}

/** Split localized entries into the default-locale (root) and other-locale groups. */
export function splitEntries<E extends { id: string }>(
  entries: E[],
): { root: TaggedEntry<E>[]; localized: TaggedEntry<E>[] } {
  const tagged = entries.map((entry) => ({ entry, ...splitId(entry.id) }));
  return {
    root: tagged.filter(({ locale }) => locale === DEFAULT_LOCALE),
    localized: tagged.filter(({ locale }) => locale !== DEFAULT_LOCALE && isLocale(locale)),
  };
}

/** Enabled non-default locales — for routes emitted once per locale (home, authors). */
export function otherLocales(): Locale[] {
  return LOCALES.filter((l) => l !== DEFAULT_LOCALE);
}
