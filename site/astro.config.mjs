import { defineConfig } from "astro/config";

// Pure static output (default) — deployable straight to Cloudflare Pages.
// `draft: true` entries are filtered out of the production build (see src/pages).
// When the real-estate listings need on-demand routes, add @astrojs/cloudflare
// here and set `export const prerender = false` on those routes only.
export default defineConfig({
  site: "https://example.com",
});
