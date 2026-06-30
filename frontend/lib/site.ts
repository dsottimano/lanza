// Per-locale site data (menu + SEO defaults). Each locale has its own
// frontend/data/menu.<locale>.json and seo.<locale>.json, edited in the CMS settings
// for the active language. Falls back to the default locale if one is missing.
import { DEFAULT_LOCALE, type Locale } from "./i18n";

interface MenuData {
  items: { label: string; url: string }[];
}

export interface SeoDefaults {
  siteName: string;
  titleTemplate: string;
  defaultTitle: string;
  defaultDescription: string;
  defaultOgImage: string;
  twitter: string;
  twitterCreator: string;
  organization: { name: string; logo: string; sameAs: string[] };
}

const menus = import.meta.glob<{ default: MenuData }>("../data/menu.*.json", {
  eager: true,
});
const seos = import.meta.glob<{ default: SeoDefaults }>("../data/seo.*.json", {
  eager: true,
});

// Index a glob map ("../data/menu.es.json" → data) by the locale in the filename.
// Allow letters + hyphen so region codes (e.g. pt-BR) match the splitId convention.
function byLocale<T>(map: Record<string, { default: T }>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [path, mod] of Object.entries(map)) {
    const m = path.match(/\.([a-z-]+)\.json$/);
    if (m) out[m[1]] = mod.default;
  }
  return out;
}

const MENU = byLocale(menus);
const SEO = byLocale(seos);

export function getMenu(locale: Locale): MenuData {
  return MENU[locale] ?? MENU[DEFAULT_LOCALE];
}

export function getSeoDefaults(locale: Locale): SeoDefaults {
  return SEO[locale] ?? SEO[DEFAULT_LOCALE];
}
