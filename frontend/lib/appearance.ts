// Brand appearance → render inputs. The CMS (Settings → Brand) writes a `brand`
// block into frontend/data/appearance.json; Base.astro turns it into an inline
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

export interface BrandConfig {
  colors?: BrandColors;
  radius?: string; // e.g. "2px" | "10px" | "18px"
  motion?: "on" | "off";
  fonts?: { heading?: string; body?: string }; // font-catalog ids
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

/** Turn an appearance record into inline style vars + motion flag + font href. */
export function resolveBrand(appearance: Appearance | null | undefined): ResolvedBrand {
  const brand = appearance?.brand ?? {};
  const decls: string[] = [];

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
