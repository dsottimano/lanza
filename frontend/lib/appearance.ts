// Brand appearance → render inputs. The CMS (Settings → Brand) writes a `brand`
// block into data/appearance.json; Base.astro turns it into an inline
// `<html style>` (custom-property overrides that beat the base design tokens in
// site.css :root), a `data-motion` flag, and a Google-Fonts <link>. Everything
// here is pure data — no Astro/DOM — so it stays trivially testable and static-safe.
//
// The whole `brand` block is OPTIONAL: an absent/empty brand renders as the base
// design (site.css :root — the Freehold look), so this is backward compatible
// with sites that never opened the Brand editor.
//
// ⚠️  MIRROR: admin/src/backend/brand.ts keeps a matching FONT_CATALOG (id → CSS
// stack) so the editor's live preview and dropdowns line up with what ships.
// The Google-family fragments live ONLY here (the render side). Edit both when
// adding a font.

export interface BrandColors {
  bg?: string;
  surface?: string;
  ink?: string;
  muted?: string;
  accent?: string;
  border?: string;
}

/** "auto" follows the visitor's OS preference (the default); the others pin it. */
export type ColorScheme = "auto" | "light" | "dark";

export interface BrandConfig {
  colors?: BrandColors;
  radius?: string; // e.g. "2px" | "10px" | "18px"
  motion?: "on" | "off";
  fonts?: { heading?: string; body?: string }; // font-catalog ids
  scheme?: ColorScheme;
}

export interface Appearance {
  theme?: string;
  logo?: string;
  brand?: BrandConfig;
}

// Font id → { display stack, optional Google Fonts `family=` fragment }.
// System fonts have no google fragment (nothing to load). Keep this list short
// and curated — every entry is a real, deliberate pairing option.
export const FONT_CATALOG: Record<string, { stack: string; google?: string }> = {
  "system-sans": {
    stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  "system-serif": { stack: 'Georgia, "Times New Roman", serif' },
  inter: { stack: '"Inter", ui-sans-serif, system-ui, sans-serif', google: "Inter:wght@400;500;600;700" },
  jost: { stack: '"Jost", ui-sans-serif, system-ui, sans-serif', google: "Jost:wght@400;500;600" },
  "space-grotesk": {
    stack: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
    google: "Space+Grotesk:wght@400;500;600;700",
  },
  poppins: { stack: '"Poppins", ui-sans-serif, system-ui, sans-serif', google: "Poppins:wght@400;500;600;700" },
  fraunces: {
    stack: '"Fraunces", Georgia, "Times New Roman", serif',
    google: "Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400",
  },
  "playfair-display": {
    stack: '"Playfair Display", Georgia, serif',
    google: "Playfair+Display:wght@400;500;600;700",
  },
  lora: { stack: '"Lora", Georgia, serif', google: "Lora:ital,wght@0,400..600;1,400..600" },
};

const COLOR_VAR: Record<keyof BrandColors, string> = {
  bg: "--bg",
  surface: "--surface",
  ink: "--ink",
  muted: "--muted",
  accent: "--accent",
  border: "--border",
};

// The tokens that DIFFER between site.css's `:root` and its
// `@media (prefers-color-scheme: dark)` block — i.e. everything a pinned scheme
// has to state outright. The rest of the palette is either mode-independent or
// derived from these (`--bg: var(--paper)`, the back-compat alias block), so it
// follows for free. Pinning only a subset is the trap: the unpinned half would
// still flip, landing e.g. dark-mode --text-secondary on a light page.
//
// ⚠️  MIRROR: these values are frontend/styles/site.css's two token blocks,
// repeated here because an inline style is the only thing that beats a media
// query without a theme attribute. Edit both files together.
const SCHEME_TOKENS: Record<Exclude<ColorScheme, "auto">, Record<string, string>> = {
  light: {
    "--paper": "#f3f1ea",
    "--paper-card": "#fbf9f3",
    "--ink": "#201d1b",
    "--ink-deep": "#17140f",
    "--accent": "#e4431b",
    "--accent-bright": "#ff5a2c",
    "--surface": "#eae7dd",
    "--muted": "#6b655e",
    "--border": "#ddd8cc",
    "--rule": "#ddd8cc",
    "--text-secondary": "#4a453f",
    "--deed-green": "#17140f", // :root aliases this one to --ink-deep
    "--deed-green-deep": "#0f0d0a",
    "--on-accent": "#ffffff",
  },
  dark: {
    "--paper": "#17140f",
    "--paper-card": "#221e19",
    "--ink": "#f3f1ea",
    "--ink-deep": "#0f0d0a",
    "--accent": "#ff5a2c",
    "--accent-bright": "#ff7a4d",
    "--surface": "#221e19",
    "--muted": "#a49d92",
    "--border": "#34302a",
    "--rule": "#34302a",
    "--text-secondary": "#cfc9bd",
    "--deed-green": "#26201b",
    "--deed-green-deep": "#1c1813",
    "--on-accent": "#17140f",
  },
};

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LEN = /^[0-9.]+(?:px|rem|em|%)$/; // radius: a plain length only

export interface ResolvedBrand {
  /** Custom-property overrides for the `<html style>` attribute ("" when none). */
  styleVars: string;
  /** "on" enables the site.css [data-motion="on"] hover/press feedback. */
  motion: "on" | "off";
  /** Google-Fonts stylesheet href for the chosen fonts, or null. */
  fontHref: string | null;
}

/**
 * Everything wrong with a brand block, as human-readable reasons ("" list = fine).
 *
 * `resolveBrand` below DROPS anything it does not recognise, which is right at render
 * time — an older site with a field this version stopped supporting must still build.
 * It is exactly wrong for a WRITER: an agent that sets `accent: "burnt orange"` and is
 * told nothing has changed the site in its own head and not on the page. So a writer
 * (the MCP `set_brand` tool) calls this and refuses; the renderer keeps forgiving.
 *
 * Same constants as resolveBrand — the two cannot disagree about what a colour is.
 */
export function validateBrand(brand: BrandConfig): string[] {
  const bad: string[] = [];
  const colors = brand.colors ?? {};
  for (const [key, v] of Object.entries(colors)) {
    if (!(key in COLOR_VAR)) {
      bad.push(`colors.${key} is not a brand colour — use ${Object.keys(COLOR_VAR).join(", ")}.`);
    } else if (typeof v !== "string" || !HEX.test(v)) {
      bad.push(`colors.${key} must be a hex colour like "#e4431b", not ${JSON.stringify(v)}.`);
    }
  }
  if (brand.radius !== undefined && !LEN.test(String(brand.radius))) {
    bad.push(`radius must be a plain length like "2px" or "1rem", not ${JSON.stringify(brand.radius)}.`);
  }
  if (brand.motion !== undefined && brand.motion !== "on" && brand.motion !== "off") {
    bad.push(`motion must be "on" or "off".`);
  }
  if (brand.scheme !== undefined && !["auto", "light", "dark"].includes(brand.scheme)) {
    bad.push(`scheme must be "auto", "light" or "dark".`);
  }
  for (const slot of ["heading", "body"] as const) {
    const id = brand.fonts?.[slot];
    if (id !== undefined && !(id in FONT_CATALOG)) {
      bad.push(`fonts.${slot} "${id}" is not a font in the catalog. Available: ${Object.keys(FONT_CATALOG).join(", ")}.`);
    }
  }
  return bad;
}

/** Turn an appearance record into inline style vars + motion flag + font href. */
export function resolveBrand(appearance: Appearance | null | undefined): ResolvedBrand {
  const brand = appearance?.brand ?? {};
  const decls: string[] = [];

  // A pinned scheme opts out of the automatic light↔dark flip by stating that
  // mode's whole token set inline, which beats site.css's media query (inline
  // style > stylesheet). Emitted FIRST so an explicit brand colour still wins.
  // "auto" — the default, and what every site predating this field has — emits
  // nothing, so those sites render exactly as they did before.
  if (brand.scheme === "light" || brand.scheme === "dark") {
    for (const [v, hex] of Object.entries(SCHEME_TOKENS[brand.scheme])) decls.push(`${v}:${hex}`);
  }

  const colors = brand.colors ?? {};
  for (const key of Object.keys(COLOR_VAR) as (keyof BrandColors)[]) {
    const v = colors[key];
    if (v && HEX.test(v)) decls.push(`${COLOR_VAR[key]}:${v}`);
  }
  if (brand.radius && LEN.test(brand.radius)) decls.push(`--radius:${brand.radius}`);

  const heading = brand.fonts?.heading ? FONT_CATALOG[brand.fonts.heading] : undefined;
  const body = brand.fonts?.body ? FONT_CATALOG[brand.fonts.body] : undefined;
  if (heading) decls.push(`--font-heading:${heading.stack}`);
  if (body) {
    // Body font drives both the prose column and the generic UI stack, so a
    // pairing reads as "display face vs. everything else".
    decls.push(`--font-prose:${body.stack}`, `--font-ui:${body.stack}`);
  }

  // One combined Google-Fonts request for whichever chosen fonts need loading.
  const families = [heading?.google, body?.google].filter((g): g is string => !!g);
  const uniq = [...new Set(families)];
  const fontHref = uniq.length
    ? `https://fonts.googleapis.com/css2?${uniq.map((f) => `family=${f}`).join("&")}&display=swap`
    : null;

  return {
    styleVars: decls.join(";"),
    motion: brand.motion === "on" ? "on" : "off",
    fontHref,
  };
}
