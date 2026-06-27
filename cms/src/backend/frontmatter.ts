import { load, dump } from "js-yaml";

// No stdlib YAML in JS — js-yaml is the standard, browser-safe parser.
// We split the `---` block manually and round-trip the rest verbatim so we
// never drop frontmatter fields we don't yet edit (seo, categories, …).

export interface ParsedFile {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(raw: string): ParsedFile {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: raw };
  const data = (load(match[1]) as Record<string, unknown>) ?? {};
  return { data, body: match[2] };
}

export function serializeFrontmatter(
  data: Record<string, unknown>,
  body: string,
): string {
  const yaml = dump(data, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}
