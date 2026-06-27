import { marked } from "marked";

// Bot-created drafts have a markdown body; Studio stores HTML. On load we
// upgrade markdown → HTML so the editor shows formatted content. One-way:
// once saved from Studio the body is HTML and `looksLikeHtml` short-circuits.
export function looksLikeHtml(body: string): boolean {
  return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(body.trim());
}

export function toEditorHtml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "<p></p>";
  if (looksLikeHtml(trimmed)) return trimmed;
  return marked.parse(trimmed, { async: false, gfm: true }) as string;
}
