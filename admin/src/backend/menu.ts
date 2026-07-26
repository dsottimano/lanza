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

// MIRROR of frontend/lib/url.ts. Menu items become `<a href="{{ url }}">` in
// templates/parts/header.html and footer.html, so a `javascript:` URL here runs on
// the site's own origin — the origin that carries the /admin session cookie. The
// render side is authoritative (the template engine applies the same policy), but
// the CMS must not WRITE a link it knows the site will refuse to render.
//
// Separate build roots (Vite/TS here, Astro/TS there) mean no shared import — the
// same arrangement as scripts/gen-redirects.mjs ↔ redirect-rules.ts. Keep in sync.
export function isSafeUrl(url: string): boolean {
  if (!url.trim()) return true; // a half-filled row is not yet a link
  // TAB/LF/CR are stripped by the URL parser wherever they appear, and `\` is a path
  // separator to it — so `/<TAB>/evil.example` and `/\evil.example` both resolve to
  // another host despite looking root-relative. See frontend/lib/url.ts.
  const u = url.replace(/[\t\n\r]/g, "");
  if (/^(https?:|mailto:|tel:)/i.test(u)) return true;
  if (u.startsWith("#")) return true;
  return /^\/(?![/\\])/.test(u);
}

function unsafeUrls(model: SiteMenu): string[] {
  const lists: (MenuItem[] | null)[] = [];
  for (const loc of [model.header, model.footer]) lists.push(loc.desktop, loc.tablet, loc.mobile);
  return lists
    .flatMap((l) => l ?? [])
    .map((i) => i.url)
    .filter((u) => !isSafeUrl(u));
}

/** The JSON we persist to data/menu.json — the shape frontend/lib/site.ts reads. */
export function serializeMenu(model: SiteMenu): { locations: { header: LocationMenu; footer: LocationMenu } } {
  // Reject, don't warn: this is the one choke point every menu save goes through,
  // and the caller (HeaderFooterView's SaveButton) surfaces the throw as a save
  // error, so nothing is committed.
  const bad = unsafeUrls(model);
  if (bad.length) {
    throw new Error(
      `Unsafe menu link${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}. ` +
        "Use a path (/about), a full https:// URL, mailto:/tel:, or an #anchor.",
    );
  }
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
