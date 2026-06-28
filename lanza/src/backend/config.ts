// Repo coordinates — must match public/admin/config.yml (backend.repo/branch)
// and the posts folder Astro reads. We are NOT moving the folder.
export const REPO = {
  owner: "dsottimano",
  name: "lanza",
  branch: "main",
} as const;

export const POSTS_DIR = "src/content/posts";

// Multilingual content. Mirrors the public site's src/lib/i18n.ts: English is the
// default/source language; Spanish and French are translations. Localized
// collections (see schema `localized: true`) store one subfolder per locale,
// e.g. src/content/posts/es/<slug>.md. Authors and media are not localized.
export const LOCALES = ["en", "es", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "EN",
  es: "ES",
  fr: "FR",
};

// Media: uploaded images are committed under MEDIA.dir and served as static
// assets at MEDIA.publicPrefix. Must match public/admin/config.yml
// (media_folder / public_folder). Images ship straight from the static build —
// never through a Worker (see CLAUDE.md Rule 3).
export const MEDIA = {
  dir: "public/images/uploads",
  publicPrefix: "/images/uploads",
} as const;
