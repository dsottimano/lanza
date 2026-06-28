// Repo coordinates — must match public/admin/config.yml (backend.repo/branch)
// and the posts folder Astro reads. We are NOT moving the folder.
export const REPO = {
  owner: "dsottimano",
  name: "lanza",
  branch: "main",
} as const;

export const POSTS_DIR = "frontend/content/posts";

// A locale is its short code. The actual set is data-driven and loaded at runtime
// from frontend/data/site.json — see backend/site.ts (`site`, loadSiteConfig).
// Localized collections (schema `localized: true`) store one subfolder per
// locale, e.g. frontend/content/posts/es/<slug>.md. Authors and media are shared.
export type Locale = string;

// Media: uploaded images are committed under MEDIA.dir and served as static
// assets at MEDIA.publicPrefix. Must match public/admin/config.yml
// (media_folder / public_folder). Images ship straight from the static build —
// never through a Worker (see CLAUDE.md Rule 3).
export const MEDIA = {
  dir: "public/images/uploads",
  publicPrefix: "/images/uploads",
} as const;
