// The site menu shape — the single source of truth on the admin side, mirroring
// frontend/lib/site.ts (normalizeMenu / SiteMenu). Two menu locations (header /
// footer), each with a desktop list plus optional tablet/mobile overrides; a null
// override means "inherit desktop", so a small-business user only maintains what
// they customize. The friendly Menu editor and the live header/footer preview both
// read this model, and it serializes back to data/menu.json verbatim.

export type MenuItem = { label: string; url: string };
export type LocationMenu = {
  desktop: MenuItem[];
  tablet: MenuItem[] | null;
  mobile: MenuItem[] | null;
};
export type SiteMenu = { header: LocationMenu; footer: LocationMenu };

export type DeviceKey = "desktop" | "tablet" | "mobile";
export type LocationKey = "header" | "footer";

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

function coerceLocation(v: unknown): LocationMenu {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    desktop: coerceItems(o.desktop),
    tablet: o.tablet == null ? null : coerceItems(o.tablet),
    mobile: o.mobile == null ? null : coerceItems(o.mobile),
  };
}

/** Read any stored menu shape (new `locations` or legacy `items`) into a SiteMenu. */
export function normalizeMenu(raw: Record<string, unknown>): SiteMenu {
  if (raw.locations && typeof raw.locations === "object") {
    const loc = raw.locations as Record<string, unknown>;
    return { header: coerceLocation(loc.header), footer: coerceLocation(loc.footer) };
  }
  // Legacy { items: [...] } → header.desktop.
  return {
    header: { desktop: coerceItems(raw.items), tablet: null, mobile: null },
    footer: { desktop: [], tablet: null, mobile: null },
  };
}

/** The JSON we persist to data/menu.json — the shape frontend/lib/site.ts reads. */
export function serializeMenu(model: SiteMenu): { locations: { header: LocationMenu; footer: LocationMenu } } {
  return { locations: { header: { ...model.header }, footer: { ...model.footer } } };
}

/** The list a given device actually shows — its own, or the desktop it inherits. */
export function resolveDevice(loc: LocationMenu, device: DeviceKey): MenuItem[] {
  return loc[device] ?? loc.desktop;
}

export function emptyMenu(): SiteMenu {
  return {
    header: { desktop: [], tablet: null, mobile: null },
    footer: { desktop: [], tablet: null, mobile: null },
  };
}
