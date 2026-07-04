// Renders the site chrome (header/footer) from HTML templates, so the layout
// follows the same HTML-to-CMS spec as page bodies: the markup is human-editable
// HTML with {{placeholders}} + {{#each}} loops (menu + language switcher), not
// hardcoded Astro. Templates live in the TENANT repo at templates/chrome/*.html
// (leading-slash glob → project root, portable to installed tenants). Base.astro
// feeds the data (menu, brand, locales) and set:html's the result around <slot>.
//
// The chrome has no fields.json: its data isn't free-form page slots but computed
// system data — the menu (Settings → Menu), site name/brand (Settings), and the
// derived locale switcher. The template.html is the editable surface.
import { render } from "./template-render";

// Eager, raw glob so the chrome map resolves at build time (static site).
const chrome = import.meta.glob<string>("/templates/chrome/*.html", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Render a chrome part (header/footer) with `data`, or "" if the tenant has none. */
export function renderChrome(part: "header" | "footer", data: Record<string, unknown>): string {
  const src = chrome[`/templates/chrome/${part}.html`];
  return src ? render(src, data) : "";
}
