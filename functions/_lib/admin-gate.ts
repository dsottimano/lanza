// Pure decisions for the /admin auth gate (functions/admin/_middleware.ts), split
// out so the adversarial cases can be tested without booting a Worker. The
// middleware itself imports lanza.config.json and does crypto; these don't.

// The ONLY endpoints under /admin that must be reachable without a session: the
// login round-trip (login → broker → handoff) and logout. This is an exact set,
// deliberately not a prefix.
//
// It used to be `pathname.startsWith("/admin/api/auth/")`, and a prefix test on a
// pathname is not the same test the router runs. `new URL().pathname` leaves `%2f`
// ENCODED and does not treat `..%2f` as a dot segment, so
// `/admin/api/auth/..%2fcf/accounts/…` passed the prefix test and skipped
// verifySession/isAllowedLogin entirely. /admin/api/cf/* performs no session check
// of its own and attaches an account-scoped Cloudflare API token (I1) — so whether
// the router then decodes `%2f` and delivers that request to the CF proxy decided
// whether this was an account takeover. The fix does not depend on knowing which:
// an exact set can't desync from routing, because a bypass path is never equal to
// one of these three strings.
const AUTH_EXEMPT = new Set([
  "/admin/api/auth/login",
  "/admin/api/auth/handoff",
  "/admin/api/auth/logout",
  // The device-flow sign-in (docs/security-todo.md §10.1). Unauthenticated by
  // necessity — they ARE how you authenticate. Neither grants anything on its own:
  // /start asks GitHub for a code, and /poll can only ever return a token for the
  // person who just approved one at github.com with their own GitHub credentials.
  "/admin/api/auth/device/start",
  "/admin/api/auth/device/poll",
]);

/** May this exact /admin path be served without a session? */
export function isAuthExempt(pathname: string): boolean {
  // Tolerate one trailing slash so a stray `/admin/api/auth/login/` still starts a
  // login rather than bouncing; nothing else is normalized.
  const p = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return AUTH_EXEMPT.has(p);
}

// `%2f` / `%5c` (path separators) and `%2e` (a dot segment) — any case. No
// legitimate /admin URL carries one: the SPA routes are literal paths and the two
// proxies take their targets as ordinary path segments. Anything that does is
// trying to make the gate and the router read the same string differently (I3), so
// it is refused before the exemption test rather than reasoned about.
const ENCODED_SEPARATOR = /%(?:2f|5c|2e)/i;

export function hasEncodedSeparator(pathname: string): boolean {
  return ENCODED_SEPARATOR.test(pathname);
}

// ── Security headers ─────────────────────────────────────────────────────────
// These CANNOT live in public/_headers: Cloudflare does not apply _headers to
// responses produced by Pages Functions, and this middleware wraps EVERY /admin
// response (it calls next() and returns its result). So the CMS would have shipped
// with no CSP at all. public/_headers still covers the static public site.
//
// Derived from what the built SPA actually loads (public/admin/), not guessed:
//  • script-src 'self'   — the Vite build emits no inline script; index.html only
//                          references /admin/assets/*.js.
//  • style-src 'unsafe-inline' — Vue writes inline style attributes (:style
//                          bindings in BrandView, PreviewPane), and the preview
//                          iframe's srcdoc document inherits this policy.
//  • fonts.googleapis/gstatic — Brand webfonts (admin/src/backend/brand.ts).
//  • registry.npmjs.org  — the Settings version check (admin/src/backend/version.ts).
//  • img-src https:      — media comes from the repo and possibly an R2 public domain.
//  • frame-ancestors DENY — /admin has one-click destructive actions (publish is a
//                          staging→main merge with no confirm), so it must not be
//                          framable. X-Frame-Options is the same rule for anything
//                          that ignores frame-ancestors.
const ADMIN_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  // Without this, `default-src 'self'` governs <video>/<audio>, which blocks media
  // served from an R2 public domain inside the live preview iframe.
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https://registry.npmjs.org",
  // The live preview is an <iframe srcdoc> (admin/src/ui/PreviewPane.vue); embeds
  // inside a previewed body are arbitrary third-party https frames by design.
  "frame-src 'self' blob: data: https:",
  "worker-src 'self' blob:",
].join("; ");

export const ADMIN_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": ADMIN_CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  // The CMS URL names the repo being edited — don't leak it to third parties.
  "Referrer-Policy": "same-origin",
};

/**
 * Re-emit a response with the /admin security headers attached. A Response from
 * next() has immutable headers, so it has to be rebuilt; 204/304 carry a null body
 * and are safe to pass through the same constructor.
 *
 * `scriptNonce` widens `script-src` for THIS response only, and exists for exactly
 * one caller: the sign-in page, which the gate generates itself and which therefore
 * cannot load a bundled asset (the whole of /admin/ is behind the gate it is trying
 * to get you through). A nonce is per-response by construction — signin-page.ts
 * mints a fresh one with the HTML it belongs to — so it cannot become a standing
 * hole the way `'unsafe-inline'` would.
 */
export function withAdminSecurityHeaders(res: Response, scriptNonce?: string): Response {
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(ADMIN_SECURITY_HEADERS)) out.headers.set(name, value);
  if (scriptNonce) {
    out.headers.set(
      "Content-Security-Policy",
      ADMIN_CSP.replace("script-src 'self'", `script-src 'self' 'nonce-${scriptNonce}'`),
    );
  }
  return out;
}
