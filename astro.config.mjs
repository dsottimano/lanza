import { defineConfig } from "astro/config";

// Pure static output (default) — deployable straight to Cloudflare Pages.
// `draft: true` entries are filtered out of the production build (see frontend/pages).
// When the real-estate listings need on-demand routes, add @astrojs/cloudflare
// here and set `export const prerender = false` on those routes only.
export default defineConfig({
  site: "https://example.com",
  // The Astro front-end source lives in frontend/ (not the default src/), paired
  // with the CMS in admin/. Astro reads pages/content/layouts/etc. from here.
  srcDir: "./frontend",
  // Multilingual: English is the default and stays at the root (`/posts/x/`);
  // Spanish and French are prefixed (`/es/...`, `/fr/...`). `prefixDefaultLocale:
  // false` keeps existing EN URLs unchanged. Locale list mirrors frontend/lib/i18n.ts.
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es", "fr"],
    routing: { prefixDefaultLocale: false },
  },
});
