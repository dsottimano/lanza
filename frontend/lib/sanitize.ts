import DOMPurify from "isomorphic-dompurify";

// Post/page bodies are HTML (Lanza is the source of truth). We render them with
// `set:html`, so sanitize at build time as defense-in-depth: the Telegram bot
// can commit raw HTML in a draft, and an editor might publish it without first
// opening it in Lanza (which would have sanitized it on load).
//
// DOMPurify drops <script>, inline event handlers, and javascript:/data: URLs
// by default, and keeps class + data-* attributes — which the cards rely on
// (data-callout/data-emoji, data-embed/data-src). We only need to re-allow the
// <iframe> embed and a few of its presentational attributes.

// Embeds are arbitrary third-party http(s) iframes by design (the editor accepts
// any URL). DOMPurify already blocks javascript:/data: in `src`, but a plain
// iframe can still navigate or pop windows over the host page. Force a `sandbox`
// that lets video embeds run (scripts, their own origin, fullscreen) while
// withholding `allow-top-navigation` — so an embed can't redirect the visitor.
// Registered once at module load; the hook fires for every sanitize() call.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "IFRAME") {
    node.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation allow-popups",
    );
  }
});

export function sanitizeBody(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allowfullscreen", "frameborder", "loading", "sandbox"],
  });
}
