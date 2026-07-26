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
//
// `allow-scripts` + `allow-same-origin` together on a SAME-ORIGIN src is not a
// sandbox at all — it is the documented escape: the framed document runs with this
// site's real origin and full window.parent access, no click needed. Post bodies
// are attacker-reachable (the Telegram bot commits raw HTML; an MCP agent writes
// bodies), so `<iframe src="/images/uploads/x.html">` would be stored XSS on the
// origin that carries the Path=/admin session cookie. So `allow-same-origin` is
// granted only to a genuine third-party embed: an absolute http(s) URL on a host
// that is not this site. YouTube/Vimeo players need it; a same-origin frame never
// legitimately does.
function isThirdPartyEmbed(src: string | null): boolean {
  if (!src) return false;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false; // relative or root-relative → same origin by construction
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  // Astro's configured `site` (astro-config.mjs derives it from data/site.json).
  const site = import.meta.env?.SITE;
  if (!site) return true; // no configured origin — absolute http(s) is all we have
  try {
    return url.host !== new URL(site).host;
  } catch {
    return true;
  }
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName !== "IFRAME") return;
  node.setAttribute(
    "sandbox",
    isThirdPartyEmbed(node.getAttribute("src"))
      ? "allow-scripts allow-same-origin allow-presentation allow-popups"
      : "allow-scripts allow-presentation allow-popups",
  );
});

export function sanitizeBody(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allowfullscreen", "frameborder", "loading", "sandbox"],
  });
}
