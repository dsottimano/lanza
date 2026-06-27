import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Studio CMS — builds to ../public/studio/ during development so it lives
// alongside the existing Sveltia install at ../public/admin/. At cutover the
// outDir/base flip to /admin/. Served as a static SPA by Astro/Pages.
export default defineConfig({
  base: "/studio/",
  plugins: [vue()],
  build: {
    outDir: "../public/studio",
    emptyOutDir: true,
  },
});
