// The one safe-URL policy for every place tenant/agent-supplied data becomes a
// link or asset URL in the built site.
//
// Why it exists: a `javascript:` value that reaches an `href` runs on the SITE'S
// OWN ORIGIN — the same origin as /admin, where the `Path=/admin` session cookie
// is sent on same-origin fetches and /admin/api/gh/* is whole-repo write. So one
// unchecked URL in a page's frontmatter is a repo-write primitive, and frontmatter
// is writable by an MCP agent (`create_content` merges arbitrary `slots`) and by
// the Telegram bot. HTML-escaping does NOT help here: the parser decodes entities
// before the URL is parsed, so `javascript&#58;…` still runs.
//
// Callers: frontend/components/Blocks.astro (block frontmatter) and
// frontend/lib/template-render.ts (any placeholder emitted inside href/src/…).
// MIRRORED in admin/src/backend/menu.ts so the CMS refuses to SAVE an unsafe menu
// URL — separate build roots (Astro/TS here, Vite/TS there) mean no shared import,
// the same arrangement as scripts/gen-redirects.mjs ↔ admin/src/backend/redirect-rules.ts.

/**
 * Schemes a URL in tenant data may use. Everything else — `javascript:`,
 * `data:`, `vbscript:`, and any scheme invented later — is refused by omission,
 * which is why this is an allowlist and not a `javascript:` blocklist.
 *
 * Also allowed: a root-relative path (`/about`) but NOT a protocol-relative one
 * (`//evil.com`, which is an absolute URL to another host), and a same-document
 * fragment (`#pricing`) — an anchor CTA is ordinary tenant content and carries no
 * scheme to execute.
 */
export function isSafeUrl(url: string): boolean {
  // Strip the characters a URL parser strips before it parses. WHATWG removes TAB,
  // LF and CR ANYWHERE in a URL, so `/<TAB>/evil.example` is parsed as `//evil.example`
  // — a protocol-relative URL to another host — while a naive `startsWith("//")` test
  // on the raw string sees a safe root-relative path.
  const u = url.replace(/[\t\n\r]/g, "");
  if (/^(https?:|mailto:|tel:)/i.test(u)) return true;
  if (u.startsWith("#")) return true;
  // Root-relative, but NOT protocol-relative. `\` counts as a separator to the parser
  // exactly like `/` does, so `/\evil.example` resolves to `https://evil.example/` —
  // the same off-site jump `//` would make. Both slashes must be excluded.
  return /^\/(?![/\\])/.test(u);
}

/** The value to emit for a URL attribute: the URL itself, or an inert `#`. */
export function safeHref(url: string): string {
  return isSafeUrl(url) ? url : "#";
}
