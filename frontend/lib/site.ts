// Per-locale site data (menu + SEO defaults). Each locale has its own
// frontend/data/menu.<locale>.json and seo.<locale>.json, edited in the CMS settings
// for the active language. Falls back to the default locale if one is missing.
import { DEFAULT_LOCALE, type Locale } from "./i18n";

// ── Menu shape ────────────────────────────────────────────────────────────
// WordPress-style menu locations, one menu per device. Two locations (header,
// footer) × three devices (desktop, tablet, mobile). tablet/mobile default to
// `null` = inherit the desktop menu, so a small-business user only maintains
// what they customize. The admin editor (admin/src/ui/MenuView.vue) writes this
// shape and MUST stay in sync with the normalizer below — the two mirror each
// other deliberately (separate build roots, so not a shared import).
export interface MenuItem {
  label: string;
  url: string;
}
export interface LocationMenu {
  desktop: MenuItem[];
  tablet: MenuItem[] | null; // null => inherit desktop
  mobile: MenuItem[] | null; // null => inherit desktop
}
export interface SiteMenu {
  header: LocationMenu;
  footer: LocationMenu;
}

export const DEVICES = ["desktop", "tablet", "mobile"] as const;
export type Device = (typeof DEVICES)[number];

function coerceItems(v: unknown): MenuItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (i): i is MenuItem =>
        !!i &&
        typeof i === "object" &&
        typeof (i as MenuItem).label === "string" &&
        typeof (i as MenuItem).url === "string",
    )
    .map((i) => ({ label: i.label, url: i.url }));
}
function coerceDevice(v: unknown): MenuItem[] | null {
  return v == null ? null : coerceItems(v);
}
function coerceLocation(v: unknown): LocationMenu {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    desktop: coerceItems(o.desktop),
    tablet: coerceDevice(o.tablet),
    mobile: coerceDevice(o.mobile),
  };
}

// Parse either the current shape ({ locations: { header, footer } }) or the
// legacy shape ({ items: [...] } → header.desktop). Never throws; unknown data
// normalizes to empty menus.
function normalizeMenu(raw: unknown): SiteMenu {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.locations && typeof o.locations === "object") {
    const loc = o.locations as Record<string, unknown>;
    return { header: coerceLocation(loc.header), footer: coerceLocation(loc.footer) };
  }
  return {
    header: { desktop: coerceItems(o.items), tablet: null, mobile: null },
    footer: { desktop: [], tablet: null, mobile: null },
  };
}

/** Resolve device inheritance: tablet/mobile fall back to the desktop list. */
export function resolveDevices(loc: LocationMenu): Record<Device, MenuItem[]> {
  return {
    desktop: loc.desktop,
    tablet: loc.tablet ?? loc.desktop,
    mobile: loc.mobile ?? loc.desktop,
  };
}

/** True when a location has no items on any device (used for the header fallback). */
export function menuIsEmpty(loc: LocationMenu): boolean {
  const r = resolveDevices(loc);
  return DEVICES.every((d) => r[d].length === 0);
}

/**
 * Group devices that resolve to the same list, so inherited devices share one
 * rendered nav instead of duplicating markup. Returns one entry per distinct
 * list, tagged with which devices it serves (in desktop→mobile order).
 */
export function groupByDevice(loc: LocationMenu): { devices: Device[]; items: MenuItem[] }[] {
  const resolved = resolveDevices(loc);
  const groups: { key: string; devices: Device[]; items: MenuItem[] }[] = [];
  for (const d of DEVICES) {
    const key = JSON.stringify(resolved[d]);
    const g = groups.find((x) => x.key === key);
    if (g) g.devices.push(d);
    else groups.push({ key, devices: [d], items: resolved[d] });
  }
  return groups.map(({ devices, items }) => ({ devices, items }));
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

const menus = import.meta.glob<{ default: unknown }>("../data/menu.*.json", {
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

export function getMenu(locale: Locale): SiteMenu {
  return normalizeMenu(MENU[locale] ?? MENU[DEFAULT_LOCALE]);
}

export function getSeoDefaults(locale: Locale): SeoDefaults {
  return SEO[locale] ?? SEO[DEFAULT_LOCALE];
}
