// Built-in page/post TEMPLATES — the WordPress-style layout variant an editor
// assigns per entry. This registry is the single source of truth; the CMS field
// mirrors it (admin/src/schema.ts `template` select — keep the option list in
// sync, the house pattern for shared shapes, see frontend/lib/site.ts ↔ MenuView.vue).
//
// Rendering: the resolved name becomes a `tpl-<name>` class on <main> (see the
// "templates" section of frontend/styles/site.css), and "landing" additionally
// drops site chrome (header nav / footer nav / page title) in Base.astro +
// PageArticle/PostArticle — structurally omitted, not display:none, so the page
// stays clean and cacheable. Unknown/absent template = "default" (never breaks
// old content).
//
// Theme extension (future, cheap): a theme ships its own templates by adding a
// `tpl-<name>` rule in its CSS block and appending an entry here (kebab-case
// name). No plugin system — just a class + a registry row. Names not in the
// registry fall back to "default".

export interface Template {
  name: string;
  label: string;
  description: string;
}

export const TEMPLATES: Template[] = [
  {
    name: "default",
    label: "Default",
    description: "The theme's normal reading column.",
  },
  {
    name: "full-width",
    label: "Full width",
    description:
      "Content breaks out to the wide measure — good for block-heavy pages (columns, logo strips).",
  },
  {
    name: "landing",
    label: "Landing",
    description:
      "Chrome-light campaign page: no page title, minimal header (just a way home), no footer nav — the body is the page.",
  },
];

export const DEFAULT_TEMPLATE = "default";
export const TEMPLATE_NAMES = TEMPLATES.map((t) => t.name);

// Legacy alias: the pre-template `layout` field named the wide variant "wide".
const ALIASES: Record<string, string> = { wide: "full-width" };

/**
 * Resolve an entry's template name. Reads `template`, falling back to the
 * legacy `layout` frontmatter key, applies aliases, and clamps anything
 * unknown to "default" so stale/invalid values can never break a render.
 */
export function resolveTemplate(data: { template?: string; layout?: string }): string {
  const raw = data.template ?? data.layout ?? DEFAULT_TEMPLATE;
  const name = ALIASES[raw] ?? raw;
  return TEMPLATE_NAMES.includes(name) ? name : DEFAULT_TEMPLATE;
}

/** The `<main>` class for a template, or undefined for the default (no class). */
export function templateClass(name: string): string | undefined {
  return name && name !== DEFAULT_TEMPLATE ? `tpl-${name}` : undefined;
}

/** Landing drops site chrome (nav/footer nav/title). Used by Base + articles. */
export function isLanding(name: string): boolean {
  return name === "landing";
}
