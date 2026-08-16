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
  // The device-flow sign-in (docs/security-todo.md §10.1).
  assert.ok(isAuthExempt("/admin/api/auth/device/start"));
  assert.ok(isAuthExempt("/admin/api/auth/device/poll"));
  // One trailing slash is tolerated so a stray link still starts a login.
  assert.ok(isAuthExempt("/admin/api/auth/login/"));

  // Everything that merely LOOKS like it lives under the auth prefix.
  assert.ok(!isAuthExempt("/admin/api/auth/"));
  assert.ok(!isAuthExempt("/admin/api/auth/anything-else"));
  // Adding a nested pair must not admit the directory above them, nor anything
  // else hung off it — the exact-set property is the whole defence here.
  assert.ok(!isAuthExempt("/admin/api/auth/device"));
  assert.ok(!isAuthExempt("/admin/api/auth/device/"));
  assert.ok(!isAuthExempt("/admin/api/auth/device/start/../../cf/accounts"));
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

  // A navigation is answered with the sign-in screen instead (§10.1 step 1). The
  // refusal is that nothing under /admin/ ran, which is what `reached` asserts —
  // the page itself loaded, so 200 is the honest status for it.
  const page = await gate("/admin/");
  assert.equal(page.res.status, 200);
  assert.equal(page.reached, false);
  assert.match(page.res.headers.get("content-type"), /text\/html/);
});

// Device flow has nowhere to redirect to — the person reads a code off a screen and
// types it at github.com — so the gate has to RENDER one. It is served from the
// gate, not the SPA bundle, because the bundle lives behind the gate.
test("an unauthenticated navigation renders the sign-in screen, never cached", async () => {
  const { res, reached } = await gate("/admin/");
  assert.equal(reached, false);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const html = await res.text();
  assert.match(html, /Get a sign-in code/);
  // It drives the two relays, and asks for nothing else.
  assert.match(html, /\/admin\/api\/auth\/device\/start/);
  assert.match(html, /\/admin\/api\/auth\/device\/poll/);
  // It never handles a credential: the code it shows comes from /start's response
  // body, and the tokens only ever exist as HttpOnly cookies.
  assert.ok(!/ghu_|access_token|client_secret/.test(html));
});

test("the sign-in screen's inline script runs on a per-response nonce, not a standing hole", async () => {
  const first = await gate("/admin/");
  const html = await first.res.text();
  const nonce = html.match(/<script nonce="([^"]+)">/)?.[1];
  assert.ok(nonce, "the page must carry a script nonce");
  const csp = first.res.headers.get("Content-Security-Policy");
  assert.ok(csp.includes(`script-src 'self' 'nonce-${nonce}'`), csp);
  // Widened for THIS script only — everything else the policy said still holds.
  assert.ok(!csp.includes("unsafe-inline") || !/script-src[^;]*unsafe-inline/.test(csp));
  assert.match(csp, /frame-ancestors 'none'/);

  // A nonce reused across responses is the same as having none.
  const second = await gate("/admin/");
  const other = (await second.res.text()).match(/<script nonce="([^"]+)">/)[1];
  assert.notEqual(nonce, other);

  // And no other /admin response carries a nonce at all.
  const api = await gate("/admin/api/cf/accounts");
  assert.ok(!api.res.headers.get("Content-Security-Policy").includes("nonce-"));
});

test("a garbage session cookie is refused — a bearer is not a session", async () => {
  const { res, reached } = await gate("/admin/api/gh/contents/x.md", {
    cookie: "lanza_session=not.a.jwt",
  });
  assert.equal(res.status, 401);
  assert.equal(reached, false);
});

// REPORTED FROM PRODUCTION, 2026-08-15. Phase 2 accepted the broker session so that
// adding a way in did not close one; phase 3 then took the mint off the runtime
// path, and the session could no longer DO anything. The combination admitted a
// browser into a CMS where every call 401s — and an empty content list renders the
// ONBOARDING WIZARD, on a site that has content. The gate is where that is fixed:
// a credential that cannot work must be refused, because only a refusal says
// "sign in".
test("a browser holding only the broker session is not admitted, and the cookie is dropped", async () => {
  // Any lanza_session value: the gate no longer verifies one, so a real signature
  // would fare no better. That is the point of the test.
  const nav = await gate("/admin/", { cookie: "lanza_session=looks.legit.enough" });
  assert.equal(nav.reached, false, "the SPA must not load — that is the broken state");
  assert.match(await nav.res.text(), /Get a sign-in code/);
  const cleared = nav.res.headers.getSetCookie().join("; ");
  assert.match(cleared, /lanza_session=;/);
  assert.match(cleared, /Max-Age=0/);

  // Cloudflare in particular: that proxy authorizes nothing itself and attaches an
  // ACCOUNT-scoped token (I1), so until this change the 7-day unrevocable session
  // still drove it — by then the only thing it could still drive.
  const cf = await gate("/admin/api/cf/accounts", { cookie: "lanza_session=looks.legit.enough" });
  assert.equal(cf.res.status, 401);
  assert.equal(cf.reached, false);
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
    await gate("/admin/"), // the sign-in screen
    await gate("/admin/api/auth/..%2fcf/x"), // malformed
  ];
  for (const { res } of cases) {
    for (const [name, value] of Object.entries(ADMIN_SECURITY_HEADERS)) {
      // The sign-in screen's CSP differs by its script nonce and nothing else.
      if (name === "Content-Security-Policy") {
        assert.equal(res.headers.get(name).replace(/ 'nonce-[a-f0-9]+'/, ""), value, name);
      } else {
        assert.equal(res.headers.get(name), value, name);
      }
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
