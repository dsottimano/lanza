// Settings → Brand. Reads/writes the `brand` block in appearance.json — the
// same file the theme picker uses — so the CMS can restyle the PUBLIC site's
// palette, corner style, motion, and fonts without touching CSS. The render
// side (frontend/lib/appearance.ts → Base.astro) turns this block into inline
// custom-property overrides that beat the selected theme's own tokens.
//
// ⚠️  MIRROR: FONT_CATALOG here (id → label + CSS stack + Google family, for the
// live preview + dropdowns) mirrors frontend/lib/appearance.ts. The ids and
// Google fragments MUST stay identical in both — edit both when adding a font.
import type { GitHubClient } from "./github";
import { GitHubError } from "./github";
import { putJsonSafe } from "./site";

export const APPEARANCE_PATH = "data/appearance.json";

export interface BrandColors {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  border: string;
}

export interface BrandConfig {
  colors: BrandColors;
  radius: string;
  motion: "on" | "off";
  fonts: { heading: string; body: string };
}

// The six palette swatches, in render order, with a short "what it paints" hint.
export const COLOR_TOKENS: { key: keyof BrandColors; label: string; hint: string }[] = [
  { key: "bg", label: "Background", hint: "Page background" },
  { key: "surface", label: "Surface", hint: "Cards, code, callouts" },
  { key: "ink", label: "Text", hint: "Body + headings" },
  { key: "muted", label: "Muted", hint: "Meta, captions, nav" },
  { key: "accent", label: "Accent", hint: "Links, buttons, marks" },
  { key: "border", label: "Border", hint: "Rules + dividers" },
];

export const RADIUS_OPTIONS: { label: string; value: string }[] = [
  { label: "Sharp", value: "2px" },
  { label: "Soft", value: "10px" },
  { label: "Round", value: "18px" },
];

// Font id → { label, CSS stack, optional Google family }. Mirror of
// frontend/lib/appearance.ts FONT_CATALOG (see the MIRROR note above).
export const FONT_CATALOG: Record<string, { label: string; stack: string; google?: string }> = {
  "system-sans": {
    label: "System sans",
    stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  "system-serif": { label: "System serif", stack: 'Georgia, "Times New Roman", serif' },
  inter: { label: "Inter", stack: '"Inter", ui-sans-serif, system-ui, sans-serif', google: "Inter:wght@400;500;600;700" },
  jost: { label: "Jost (Futura-like)", stack: '"Jost", ui-sans-serif, system-ui, sans-serif', google: "Jost:wght@400;500;600" },
  "space-grotesk": {
    label: "Space Grotesk",
    stack: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
    google: "Space+Grotesk:wght@400;500;600;700",
  },
  poppins: { label: "Poppins", stack: '"Poppins", ui-sans-serif, system-ui, sans-serif', google: "Poppins:wght@400;500;600;700" },
  fraunces: {
    label: "Fraunces",
    stack: '"Fraunces", Georgia, "Times New Roman", serif',
    google: "Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400",
  },
  "playfair-display": {
    label: "Playfair Display",
    stack: '"Playfair Display", Georgia, serif',
    google: "Playfair+Display:wght@400;500;600;700",
  },
  lora: { label: "Lora", stack: '"Lora", Georgia, serif', google: "Lora:ital,wght@0,400..600;1,400..600" },
};

export const FONT_IDS = Object.keys(FONT_CATALOG);

/** Google-Fonts href to load the chosen heading+body fonts (for live preview). */
export function previewFontHref(fonts: { heading: string; body: string }): string | null {
  const families = [FONT_CATALOG[fonts.heading]?.google, FONT_CATALOG[fonts.body]?.google].filter(
    (g): g is string => !!g,
  );
  const uniq = [...new Set(families)];
  return uniq.length
    ? `https://fonts.googleapis.com/css2?${uniq.map((f) => `family=${f}`).join("&")}&display=swap`
    : null;
}

// The base design's brand values — the Freehold look baked into site.css :root.
// When a site has no `brand` block yet, the editor opens pre-filled with this,
// so the first save is a visual no-op and every field starts somewhere sensible.
// Mirrors the :root token block in frontend/styles/site.css: the wordmark
// identity — Ink #201d1b on Paper #f3f1ea, Jost, sharp corners, one hot launch
// accent (#e4431b). "reset to defaults" now lands on this base look.
export const LANZA_DEFAULTS: BrandConfig = {
  colors: { bg: "#f3f1ea", surface: "#eae7dd", ink: "#201d1b", muted: "#6b655e", accent: "#e4431b", border: "#ddd8cc" },
  radius: "2px",
  motion: "on",
  fonts: { heading: "jost", body: "jost" },
};

export function defaultBrand(): BrandConfig {
  return structuredClone(LANZA_DEFAULTS);
}

// One-click palettes. The first IS the Lanza wordmark and now equals the base
// (LANZA_DEFAULTS) — Ink #201d1b on Paper #f3f1ea, Jost, sharp corners, the hot
// launch accent #e4431b (the ↗ arrow); see /home/…/lanza-brand.
export const PRESETS: { name: string; brand: BrandConfig }[] = [
  {
    name: "Lanza brand",
    brand: {
      colors: { bg: "#f3f1ea", surface: "#eae7dd", ink: "#201d1b", muted: "#6b655e", accent: "#e4431b", border: "#ddd8cc" },
      radius: "2px",
      motion: "on",
      fonts: { heading: "jost", body: "jost" },
    },
  },
  {
    name: "Deed green",
    brand: {
      colors: { bg: "#f2ede1", surface: "#ebe4d3", ink: "#17241f", muted: "#5f6d63", accent: "#123128", border: "#ddd6c5" },
      radius: "2px",
      motion: "on",
      fonts: { heading: "fraunces", body: "space-grotesk" },
    },
  },
  {
    name: "Midnight",
    brand: {
      colors: { bg: "#0f1115", surface: "#191c22", ink: "#e8eaed", muted: "#9aa0ab", accent: "#7c9cff", border: "#2a2e37" },
      radius: "12px",
      motion: "on",
      fonts: { heading: "space-grotesk", body: "inter" },
    },
  },
  {
    name: "Editorial",
    brand: {
      colors: { bg: "#ffffff", surface: "#faf9f7", ink: "#1a1a1a", muted: "#6b6b6b", accent: "#1a1a1a", border: "#e7e5e1" },
      radius: "10px",
      motion: "off",
      fonts: { heading: "playfair-display", body: "system-serif" },
    },
  },
];

export interface LoadedAppearance {
  brand: BrandConfig;
  /** True when the file had no `brand` block yet (seeded from the base design). */
  seeded: boolean;
}

/** Read appearance.json; return a fully-populated brand (base defaults + saved). */
export async function loadAppearance(client: GitHubClient): Promise<LoadedAppearance> {
  let data: Record<string, unknown> = {};
  try {
    data = (await client.loadJson(APPEARANCE_PATH)).data;
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 404)) throw e;
  }
  const seed = defaultBrand();
  const raw = (data.brand ?? {}) as Partial<BrandConfig>;
  return {
    seeded: !data.brand,
    brand: {
      colors: { ...seed.colors, ...(raw.colors ?? {}) },
      radius: raw.radius ?? seed.radius,
      motion: raw.motion === "on" ? "on" : raw.motion === "off" ? "off" : seed.motion,
      fonts: {
        heading: raw.fonts?.heading && FONT_CATALOG[raw.fonts.heading] ? raw.fonts.heading : seed.fonts.heading,
        body: raw.fonts?.body && FONT_CATALOG[raw.fonts.body] ? raw.fonts.body : seed.fonts.body,
      },
    },
  };
}

/** Merge the brand block into appearance.json (preserving theme/logo/etc.). */
export async function saveBrand(client: GitHubClient, brand: BrandConfig): Promise<void> {
  await putJsonSafe(client, APPEARANCE_PATH, (cur) => ({ ...cur, brand }), "lanza: update brand");
}
