// Repo coordinates. The CMS reads and writes the WORKING branch (`staging`) — a
// shared drafts branch, served at the Access-gated staging domain. Publishing
// merges it into `productionBranch` (`main`), the branch Astro builds the public
// site from. `branch` is the working branch so every existing read/write path
// targets staging automatically. The proxy allowlist (functions/_lib/gh-proxy.ts)
// MUST list both branches. The content model itself lives in admin/src/schema.ts.
export const REPO = {
  owner: "dsottimano",
  name: "lanza",
  branch: "staging",
  productionBranch: "main",
} as const;

export const POSTS_DIR = "frontend/content/posts";

// A locale is its short code. The actual set is data-driven and loaded at runtime
// from frontend/data/site.json — see backend/site.ts (`site`, loadSiteConfig).
// Localized collections (schema `localized: true`) store one subfolder per
// locale, e.g. frontend/content/posts/es/<slug>.md. Authors and media are shared.
export type Locale = string;

// Media: uploaded images are committed under MEDIA.dir and served as static
// assets at MEDIA.publicPrefix. Images ship straight from the static build —
// never through a Worker (see CLAUDE.md Rule 3).
export const MEDIA = {
  dir: "public/images/uploads",
  publicPrefix: "/images/uploads",
} as const;
