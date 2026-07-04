// @lanza/site — the Astro config factory a tenant repo consumes.
//
// The tenant's astro.config.mjs is a two-liner:
//   import { lanzaConfig } from "@lanza/site/astro";
//   export default lanzaConfig();
// (In this monorepo, before the package is published, astro.config.mjs imports
// this file directly — it plays the tenant's role.)
//
// Split of concerns: CODE (pages/layouts/components/lib) ships in this package and
// is pointed at by `srcDir`; CONTENT + DATA live in the tenant repo (the Astro
// project ROOT = process.cwd()). Astro resolves content-collection `base` and the
// public dir against ROOT, so tenant content is reachable even though the code
// lives in node_modules. See docs/lanza-site-extraction-plan.md §4.
import { defineConfig } from "astro/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// This file sits at the package root; the render code is in ./frontend.
const PKG_ROOT = fileURLToPath(new URL(".", import.meta.url));

export function lanzaConfig() {
  // Locale set is tenant data — the single source of truth is <tenant>/data/site.json
  // (also read by frontend/lib/i18n.ts). Read it from the project root (cwd) so
  // Astro's i18n routing and the app agree on which languages exist.
  const site = JSON.parse(
    readFileSync(join(process.cwd(), "data/site.json"), "utf8"),
  );
  const locales = site.locales.map((l) => l.code);

  return defineConfig({
    site: "https://example.com",
    // The render code lives in the package (not the tenant's ./src) — an absolute
    // path so it resolves the same whether this package is the repo itself
    // (monorepo dogfood) or installed under the tenant's node_modules.
    srcDir: join(PKG_ROOT, "frontend"),
    // Platform static assets (brand, favicon, social, lanza.js, the prebuilt
    // admin SPA) ship INSIDE the package. The tenant's own public/ (their media
    // uploads + generated _redirects) is overlaid onto dist/ after the build by
    // `lanza build` — see bin/lanza.mjs. In the monorepo dogfood the two are the
    // same directory, so the overlay is a harmless no-op.
    publicDir: join(PKG_ROOT, "public"),
    // Multilingual: default locale at the root, others prefixed. Locale set from
    // the tenant's site.json (above).
    i18n: {
      defaultLocale: site.defaultLocale,
      locales,
      routing: { prefixDefaultLocale: false },
    },
  });
}
