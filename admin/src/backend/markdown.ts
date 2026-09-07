import { marked } from "marked";

// Bot-created drafts have a markdown body; Lanza stores HTML. On load we
// upgrade markdown → HTML so the editor shows formatted content. One-way:
// once saved from Lanza the body is HTML and `looksLikeHtml` short-circuits.
export function looksLikeHtml(body: string): boolean {
  return /^<(?:p|h[1-6]|div|section|article|blockquote|ul|ol|pre|table|figure|details|iframe|video|audio|hr)\b[^>]*>/i.test(body.trim());
}

export function toEditorHtml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "<p></p>";
  if (looksLikeHtml(trimmed)) return trimmed;
  return marked.parse(trimmed, { async: false, gfm: true }) as string;
}
