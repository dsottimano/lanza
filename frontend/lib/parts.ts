// Renders the site's PARTS (header/footer — "template parts", the WordPress term)
// from HTML templates, so the layout follows the same HTML-to-CMS spec as page
// bodies: the markup is human-editable HTML with {{placeholders}} + {{#each}} loops
// (menu + language switcher), not hardcoded Astro. Parts live in the TENANT repo at
// templates/parts/*.html (leading-slash glob → project root, portable to installed
// tenants). Base.astro feeds the data (menu, brand, locales) and set:html's the
// result around <slot>.
//
// A part has no fields.json: its data isn't free-form page slots but computed
// system data — the menu (Settings → Menu), site name/brand (Settings), and the
// derived locale switcher. The template.html is the editable surface.
import { render } from "./template-render";

// Eager, raw glob so the parts map resolves at build time (static site).
const parts = import.meta.glob<string>("/templates/parts/*.html", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Render a part (header/footer) with `data`, or "" if the tenant has none. */
export function renderPart(name: "header" | "footer", data: Record<string, unknown>): string {
  const src = parts[`/templates/parts/${name}.html`];
  return src ? render(src, data) : "";
}
