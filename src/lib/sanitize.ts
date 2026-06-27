import DOMPurify from "isomorphic-dompurify";

// Post/page bodies are HTML (Studio is the source of truth). We render them with
// `set:html`, so sanitize at build time as defense-in-depth: the Telegram bot
// can commit raw HTML in a draft, and an editor might publish it without first
// opening it in Studio (which would have sanitized it on load).
//
// DOMPurify drops <script>, inline event handlers, and javascript:/data: URLs
// by default, and keeps class + data-* attributes — which the cards rely on
// (data-callout/data-emoji, data-embed/data-src). We only need to re-allow the
// <iframe> embed and a few of its presentational attributes.
export function sanitizeBody(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allowfullscreen", "frameborder", "loading"],
  });
}
