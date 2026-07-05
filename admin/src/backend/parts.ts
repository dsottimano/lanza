// The site PARTS the front-end renders around every page — header/footer template
// parts (see frontend/lib/parts.ts + templates/parts/*.html). This list mirrors what
// Base.astro actually renders: a part here that Base doesn't render wouldn't appear
// on the site, so keep the two in sync. Edited in the CMS via ui/HeaderFooterView.vue
// (the "Edit HTML (advanced)" section) with GitHubClient.loadText / saveText (raw HTML).

export const PARTS = [
  { name: "header", label: "Header" },
  { name: "footer", label: "Footer" },
] as const;

export type PartName = (typeof PARTS)[number]["name"];

/** Repo path of a part's HTML template. */
export function partPath(name: string): string {
  return `templates/parts/${name}.html`;
}
