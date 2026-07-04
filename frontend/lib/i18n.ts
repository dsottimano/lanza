// Locale model for the public site. Which languages exist is data-driven —
// edited in the CMS and stored in frontend/data/site.json (read here and by
// astro.config.mjs). This module derives the runtime helpers from it and defines
// how a content `id` maps to a locale + slug.
//
// Storage convention: localized collections keep one subfolder per locale, e.g.
// `frontend/content/posts/en/about.md`. The Astro glob loader turns that into
// `id = "en/about"`, so the locale is the first path segment. Legacy flat files
// (`posts/about.md`, no locale folder) are treated as the default locale.
//
// Translations share a filename (the *stem*): `posts/en/about.md` and
// `posts/es/about.md` are the same entry in two languages.

import { getRelativeLocaleUrl } from "astro:i18n";
import site from "/data/site.json";

// A locale is just its short code. The set comes from site.json, so `Locale` is
// a string rather than a fixed union.
export type Locale = string;

export const LOCALES: readonly Locale[] = site.locales.map((l) => l.code);

export const DEFAULT_LOCALE: Locale = site.defaultLocale;

/** og:locale tags (BCP-47-ish) keyed by our short codes. */
export const OG_LOCALE: Record<Locale, string> = Object.fromEntries(
  site.locales.map((l) => [l.code, l.ogLocale]),
);

/** Human label for each locale (used by the language switcher UI). */
export const LOCALE_LABEL: Record<Locale, string> = Object.fromEntries(
  site.locales.map((l) => [l.code, l.label]),
);

// Every locale code the platform knows about (mirrors the CMS language catalog in
// admin/src/backend/site.ts). Used to RECOGNISE a content subfolder as a locale —
// even one currently disabled in site.json — so its content is excluded from the
// build rather than mis-read as a default-locale slug (e.g. a leftover
// `pages/es/about.md` after Spanish is turned off must NOT render at /es/about).
const KNOWN_LOCALE_CODES = new Set([
  "en", "es", "fr", "de", "it", "pt", "nl", "ja",
]);

/** True if `v` is a currently-ENABLED locale (in site.json). */
export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}

/**
 * Split a content collection `id` into its locale and stem.
 * `"es/about"` → `{ locale: "es", slug: "about" }` (es recognised as a locale
 * folder even if disabled — callers filter on isLocale/DEFAULT_LOCALE).
 * `"about"` (legacy, no locale folder) → `{ locale: "en", slug: "about" }`.
 */
export function splitId(id: string): { locale: Locale; slug: string } {
  const idx = id.indexOf("/");
  if (idx > 0) {
    const head = id.slice(0, idx);
    if (KNOWN_LOCALE_CODES.has(head)) return { locale: head, slug: id.slice(idx + 1) };
  }
  return { locale: DEFAULT_LOCALE, slug: id };
}

/**
 * Build a site-relative URL for `path` in `locale`. The default locale stays at
 * the root (no prefix); others get a `/es`, `/fr` prefix. Thin wrapper over
 * Astro's i18n helper so every internal link prefixes consistently.
 * `localeUrl("es", "posts/about/")` → `/es/posts/about/`.
 */
export function localeUrl(locale: Locale, path: string): string {
  return getRelativeLocaleUrl(locale, path);
}
