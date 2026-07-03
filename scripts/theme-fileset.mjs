// Canonical definition of "what constitutes the Lanza design" — the file set a
// theme bundle ships. Used by scripts/pack-default-theme.mjs to package the
// stock design.
//
// ⚠️  MIRROR: admin/src/backend/theme-fileset.ts holds the identical definition
// for the in-browser exporter (ThemeExport.vue → backend/export.ts). Admin (Vite)
// can't import scripts/*.mjs cleanly, so the two files are kept byte-equivalent
// by hand — edit BOTH together. Keep the constants and isDesignPath() in sync.

// The design: every file under these directory prefixes …
export const DESIGN_DIR_PREFIXES = [
  "frontend/pages/",
  "frontend/components/",
  "frontend/layouts/",
  "frontend/lib/",
  "frontend/styles/",
];

// … plus these two individual files (the content model + Astro collection config).
export const DESIGN_EXPLICIT_FILES = ["frontend/content.config.ts", "admin/src/schema.ts"];

// … plus the design's data defaults (top-level files in frontend/data/ only).
// Selective on purpose: appearance/site + every seo.<locale>.json / menu.<locale>.json,
// but NOT generated files like redirects.json.
export const DATA_DIR = "frontend/data/";

function isDesignDataFile(path) {
  if (!path.startsWith(DATA_DIR)) return false;
  const name = path.slice(DATA_DIR.length);
  if (name.includes("/")) return false; // top-level data files only
  return (
    name === "appearance.json" ||
    name === "site.json" ||
    /^seo\..+\.json$/.test(name) ||
    /^menu\..+\.json$/.test(name)
  );
}

/** Is this repo-relative path part of the stock design bundle? */
export function isDesignPath(path) {
  if (DESIGN_DIR_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (DESIGN_EXPLICIT_FILES.includes(path)) return true;
  return isDesignDataFile(path);
}

// Export options beyond the design (used by the in-browser exporter). Content and
// media are opt-in "site dump" additions, never part of the base design bundle.
export const CONTENT_PREFIX = "frontend/content/";
export const MEDIA_PREFIX = "public/images/uploads/";
