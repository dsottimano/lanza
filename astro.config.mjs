import { defineConfig } from "astro/config";
import { readFileSync } from "node:fs";

// Locale set is data-driven — single source of truth is data/site.json
// (also read by frontend/lib/i18n.ts). Read it here so Astro's i18n routing and
// the app agree on which languages exist.
const site = JSON.parse(
  readFileSync(new URL("./data/site.json", import.meta.url), "utf8"),
);
const locales = site.locales.map((l) => l.code);

// Pure static output (default) — deployable straight to Cloudflare Pages.
// `draft: true` entries are filtered out of the production build (see frontend/pages).
// When the real-estate listings need on-demand routes, add @astrojs/cloudflare
// here and set `export const prerender = false` on those routes only.
export default defineConfig({
  site: "https://example.com",
  // The Astro front-end source lives in frontend/ (not the default src/), paired
  // with the CMS in admin/. Astro reads pages/content/layouts/etc. from here.
  srcDir: "./frontend",
  // Multilingual: the default locale stays at the root (`/posts/x/`); others are
  // prefixed (`/es/...`, `/fr/...`). `prefixDefaultLocale: false` keeps the
  // default-language URLs unprefixed. Locale set comes from site.json (above).
  i18n: {
    defaultLocale: site.defaultLocale,
    locales,
    routing: { prefixDefaultLocale: false },
  },
});
