// Branch model for the CMS. Reads/writes target the WORKING branch (`staging`) — a
// shared drafts branch, served at the Access-gated staging domain. Publishing merges
// it into `productionBranch` (`main`), the branch Astro builds the public site from.
// The proxy allowlist (functions/_lib/gh-proxy.ts) MUST list both branches.
//
// Repo IDENTITY (owner/name) is deliberately NOT here: the SPA sends repo-relative
// paths and the SERVER proxy prepends repos/<owner>/<name>/ from the tenant's
// committed lanza.config.json (so a prebuilt, tenant-agnostic SPA can't address any
// other repo). The content model lives in admin/src/schema.ts.
export const REPO = {
  branch: "staging",
  productionBranch: "main",
} as const;

export const POSTS_DIR = "content/posts";

// A locale is its short code. The actual set is data-driven and loaded at runtime
// from data/site.json — see backend/site.ts (`site`, loadSiteConfig).
// Localized collections (schema `localized: true`) store one subfolder per
// locale, e.g. content/posts/es/<slug>.md. Authors and media are shared.
export type Locale = string;

// Media: uploaded images are committed under MEDIA.dir and served as static
// assets at MEDIA.publicPrefix. Images ship straight from the static build —
// never through a Worker (see CLAUDE.md Rule 3).
export const MEDIA = {
  dir: "public/images/uploads",
  publicPrefix: "/images/uploads",
} as const;
