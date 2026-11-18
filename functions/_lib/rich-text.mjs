// Rich-text template fields (widget "richtext"): basic formatting only. This is the one
// allowlist shared by the site checker, the sanitizer (frontend/lib/sanitize.ts), the
// CMS editor and the preview, so what the owner can apply is exactly what survives.
// Sizes and fonts are fixed CLASSES, never free-form style attributes, and fonts are
// the site's own theme fonts. Lives under functions/ so the checker can use it: no
// dependencies, no node builtins.

export const RICH_TEXT_WIDGET = "richtext";
export const RICH_TEXT_TAGS = ["p", "br", "strong", "em", "u", "span"];
export const RICH_TEXT_SIZES = [
  { value: "sm", label: "Small", css: "font-size:.875em" },
  { value: "lg", label: "Large", css: "font-size:1.25em" },
  { value: "xl", label: "Extra large", css: "font-size:1.5em" },
];
export const RICH_TEXT_FONTS = [
  { value: "heading", label: "Heading font", css: "font-family:var(--font-heading)" },
  { value: "body", label: "Body font", css: "font-family:var(--font-prose)" },
];
export const richTextClass = (kind, value) => `lz-${kind}-${value}`;
export const RICH_TEXT_CLASSES = new Set([
  ...RICH_TEXT_SIZES.map((s) => richTextClass("size", s.value)),
  ...RICH_TEXT_FONTS.map((f) => richTextClass("font", f.value)),
]);
export const RICH_TEXT_CSS = [
  ...RICH_TEXT_SIZES.map((s) => `.${richTextClass("size", s.value)}{${s.css}}`),
  ...RICH_TEXT_FONTS.map((f) => `.${richTextClass("font", f.value)}{${f.css}}`),
].join("");

/** Top-level richtext field names: the only ones rendered as {{{ name }}}. */
export function richTextFields(fields) {
  return (Array.isArray(fields) ? fields : [])
    .filter((f) => f && f.widget === RICH_TEXT_WIDGET && typeof f.name === "string")
    .map((f) => f.name);
}
