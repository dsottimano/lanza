// lanza-site — the Astro config factory a tenant repo consumes.
//
// The tenant's astro.config.mjs is a two-liner:
//   import { lanzaConfig } from "lanza-site/astro";
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

// A tenant's `site.json.url` → a valid absolute origin for Astro's `site`, or null
// if unset/garbage (so the caller falls through). Astro throws on an invalid `site`,
// so a bad committed value must never reach it.
function resolveSiteUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin; // normalized, no trailing slash/path
  } catch {
    return null;
  }
}

// The first custom domain the tenant declares in lanza.config.json, as an origin.
//
// This exists because CF_PAGES_URL is NOT the site's address: on Cloudflare Pages it
// is the immutable per-DEPLOYMENT host (`https://<hash>.<project>.pages.dev`), a new
// one every build. A custom-domain tenant that never set `site.json.url` therefore
// shipped every canonical, og:url, hreflang and schema.org @id pointing at a hash
// host — off-domain, and different on each deploy. lanzacms.com was doing exactly
// that. The domain was already declared for the broker's audience check, so reading
// it here keeps one source of truth rather than asking the owner to type it twice.
//
// Bare hostnames are the committed form ("lanzacms.com"); https is assumed. Missing
// or malformed file is not an error — a tenant repo predating `domains` just falls
// through to the old behaviour.
function resolveDeclaredDomain(root) {
  let config;
  try {
    config = JSON.parse(readFileSync(join(root, "lanza.config.json"), "utf8"));
  } catch {
    return null;
  }
  const first = Array.isArray(config?.domains) ? config.domains[0] : null;
  if (typeof first !== "string" || !first.trim()) return null;
  const raw = first.trim();
  return resolveSiteUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
}

export function lanzaConfig() {
  // Locale set is tenant data — the single source of truth is <tenant>/data/site.json
  // (also read by frontend/lib/i18n.ts). Read it from the project root (cwd) so
  // Astro's i18n routing and the app agree on which languages exist.
  const root = process.cwd();
  const site = JSON.parse(
    readFileSync(join(root, "data/site.json"), "utf8"),
  );
  const locales = site.locales.map((l) => l.code);

  return defineConfig({
    // Public origin for canonical/OG/hreflang. Precedence: the tenant's committed
    // `url` (set explicitly via the CMS — Site Health → Set site URL) → the first
    // custom domain declared in lanza.config.json → `CF_PAGES_URL` (a fresh site
    // with neither still gets a real, if per-deployment, host) → localhost for a
    // bare local build.
    //
    // The declared domain sits AHEAD of CF_PAGES_URL deliberately: a tenant who has
    // told us their domain has said everything we need, and preferring a hash host
    // over it is never right. See resolveDeclaredDomain.
    site:
      resolveSiteUrl(site.url) ||
      resolveDeclaredDomain(root) ||
      process.env.CF_PAGES_URL ||
      "http://localhost:4321",
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
