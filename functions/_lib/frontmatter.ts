// Frontmatter parse/serialize for the Functions runtime (Workers). MIRROR of
// admin/src/backend/frontmatter.ts — kept byte-compatible so a file written by the
// MCP server round-trips identically through the Vue CMS and vice-versa. The two
// live in separate bundles (admin = Vite/Vue, functions = Pages/Workers) with
// separate dep trees, so the ~15 lines are duplicated rather than cross-imported.
import { load, dump } from "js-yaml";

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
