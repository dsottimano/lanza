// Adversarial tests for the /admin auth gate. Two layers:
//   1. the pure decisions (functions/_lib/admin-gate.ts)
//   2. the REAL middleware (functions/admin/_middleware.ts), driven end to end with
//      a `next` that records whether it was ever reached — so every refusal below
//      asserts BOTH the response AND that nothing downstream ran. Downstream is
//      /admin/api/cf/*, which does no session check of its own and attaches an
//      account-scoped Cloudflare API token (docs/security-model.md I1), so "next()
//      was not called" is this gate's version of "nothing was written".
// Run: node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs functions/_lib/admin-gate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthExempt, hasEncodedSeparator, ADMIN_SECURITY_HEADERS } from "./admin-gate.ts";
import { onRequest } from "../admin/_middleware.ts";

// A production-looking host: productionOriginIfPreview() must return null, or the
// preview redirect would short-circuit before the checks under test.
const HOST = "https://lanzacms.com";

// Drive the real middleware with no session cookie. Returns the response plus
// whether the downstream Function was reached.
async function gate(path, { cookie } = {}) {
  let reached = false;
  const headers = cookie ? { Cookie: cookie } : {};
  const res = await onRequest({
    request: new Request(`${HOST}${path}`, { headers }),
    env: {},
    next: async () => {
      reached = true;
      return new Response("downstream", { status: 200 });
    },
  });
  return { res, reached };
}

test("the auth exemption is an exact set, not a prefix", () => {
  assert.ok(isAuthExempt("/admin/api/auth/login"));
  assert.ok(isAuthExempt("/admin/api/auth/handoff"));
  assert.ok(isAuthExempt("/admin/api/auth/logout"));
  // One trailing slash is tolerated so a stray link still starts a login.
  assert.ok(isAuthExempt("/admin/api/auth/login/"));

  // Everything that merely LOOKS like it lives under the auth prefix.
  assert.ok(!isAuthExempt("/admin/api/auth/"));
  assert.ok(!isAuthExempt("/admin/api/auth/anything-else"));
  assert.ok(!isAuthExempt("/admin/api/auth/login/../cf/accounts"));
  assert.ok(!isAuthExempt("/admin/api/authx/login"));
  assert.ok(!isAuthExempt("/admin/api/cf/accounts"));
  assert.ok(!isAuthExempt("/admin/api/gh/contents/x"));
});

test("encoded separators and dot segments are detected in any case", () => {
  for (const p of [
    "/admin/api/auth/..%2fcf/accounts/x",
    "/admin/api/auth/..%2Fcf/accounts/x",
    "/admin/api/auth/..%5ccf/accounts/x",
    "/admin/api/auth/%2e%2e/cf/accounts/x",
    "/admin/api/auth/%2E%2E/cf/accounts/x",
  ]) {
    assert.ok(hasEncodedSeparator(p), p);
  }
  assert.ok(!hasEncodedSeparator("/admin/api/gh/contents/content/posts/hello.md"));
  assert.ok(!hasEncodedSeparator("/admin/api/auth/login"));
  // %20 is an ordinary encoded character, not a separator — don't over-refuse.
  assert.ok(!hasEncodedSeparator("/admin/api/gh/contents/my%20file.md"));
});

// THE BYPASS. `new URL().pathname` leaves %2f encoded and does not treat `..%2f` as
// a dot segment, so the old `startsWith("/admin/api/auth/")` prefix test matched and
// the request skipped verifySession + isAllowedLogin entirely. Whether Cloudflare's
// router then decoded %2f and delivered it to /admin/api/cf/* was never determined —
// the fix does not depend on the answer.
test("bypass: /admin/api/auth/..%2fcf/… is refused and never reaches downstream", async () => {
  const { res, reached } = await gate("/admin/api/auth/..%2fcf/accounts/abc/pages/projects");
  assert.equal(res.status, 401);
  assert.equal(reached, false, "the CF proxy must not run — it attaches an account-scoped token");
  assert.match(await res.text(), /Malformed path/);
});

test("bypass variants: backslash, %2e%2e, mixed case — all refused, none reach downstream", async () => {
  for (const path of [
    "/admin/api/auth/..%5ccf/accounts/abc",
    "/admin/api/auth/%2e%2e/cf/accounts/abc",
    "/admin/api/auth/..%2Fgh/contents/lanza.config.json",
    "/admin/api/auth/login%2f..%2fcf/accounts",
  ]) {
    const { res, reached } = await gate(path);
    assert.equal(reached, false, path);
    assert.equal(res.status, 401, path);
  }
});

test("an unauthenticated non-exempt path is still refused (identity check intact)", async () => {
  const api = await gate("/admin/api/cf/accounts");
  assert.equal(api.res.status, 401);
  assert.equal(api.reached, false);

  const page = await gate("/admin/");
  assert.equal(page.res.status, 302);
  assert.equal(page.reached, false);
  assert.match(page.res.headers.get("Location"), /\/admin\/api\/auth\/login$/);
});

test("a garbage session cookie is refused — a bearer is not a session", async () => {
  const { res, reached } = await gate("/admin/api/gh/contents/x.md", {
    cookie: "lanza_session=not.a.jwt",
  });
  assert.equal(res.status, 401);
  assert.equal(reached, false);
});

test("the three login endpoints still pass through unauthenticated", async () => {
  for (const path of ["/admin/api/auth/login", "/admin/api/auth/handoff", "/admin/api/auth/logout"]) {
    const { res, reached } = await gate(path);
    assert.equal(reached, true, path);
    assert.equal(res.status, 200, path);
  }
});

test("every /admin response carries the security headers, refusals included", async () => {
  const cases = [
    await gate("/admin/api/auth/login"), // exempt pass-through
    await gate("/admin/api/cf/accounts"), // 401
    await gate("/admin/"), // 302 to login
    await gate("/admin/api/auth/..%2fcf/x"), // malformed
  ];
  for (const { res } of cases) {
    for (const [name, value] of Object.entries(ADMIN_SECURITY_HEADERS)) {
      assert.equal(res.headers.get(name), value, name);
    }
  }
});

test("the CSP is the one the built SPA actually needs, and denies framing", () => {
  const csp = ADMIN_SECURITY_HEADERS["Content-Security-Policy"];
  // Clickjacking a one-click publish (staging→main merge, no confirm dialog).
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(ADMIN_SECURITY_HEADERS["X-Frame-Options"], "DENY");
  // No inline script in public/admin/index.html — keep it that way.
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.ok(!csp.includes("unsafe-eval"));
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /object-src 'none'/);
  // The two external origins the CMS genuinely uses.
  assert.match(csp, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/registry\.npmjs\.org/);
});
