// Tests for the secretless device-flow module (functions/_lib/device-flow.ts).
//
// Two things are worth testing here and they are not the happy path:
//
//   1. NO REQUEST EVER CARRIES A SECRET. That is the entire claim of the
//      migration, so it is asserted on every outbound call rather than trusted —
//      a future edit that "just adds client_secret to make refresh work" has to
//      fail a test, not pass review.
//   2. `authorization_pending` is not a failure and `access_denied` is not a
//      retry. GitHub answers both with HTTP 200 and an `error` in the body, so a
//      reader that goes by status code alone either spins forever on a refusal or
//      gives up on a slow typist.
//
// Run: node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs functions/_lib/device-flow.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startDeviceFlow,
  pollDeviceFlow,
  refreshTokens,
  authCookies,
  clearAuthCookies,
  deviceCookie,
  readCookie,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  DEVICE_COOKIE,
  DEVICE_CODE_URL,
  ACCESS_TOKEN_URL,
} from "./device-flow.ts";

const CLIENT_ID = "Iv23ct5fK2N5QtDUbzyx";

/** A fetch stub that records every call and replays a canned JSON body. */
function stubFetch(body, { status = 200, json = true } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      fields: Object.fromEntries(new URLSearchParams(init.body)),
    });
    return {
      status,
      json: async () => {
        if (!json) throw new SyntaxError("not json");
        return body;
      },
    };
  };
  impl.calls = calls;
  return impl;
}

const START_OK = {
  device_code: "dc-abc",
  user_code: "9F66-99DE",
  verification_uri: "https://github.com/login/device",
  expires_in: 899,
  interval: 5,
};

const TOKENS_OK = {
  access_token: "ghu_test",
  token_type: "bearer",
  expires_in: 28800,
  refresh_token: "ghr_test",
  refresh_token_expires_in: 15897600,
  scope: "",
};

// ── the claim: no secret, ever ───────────────────────────────────────────────

test("start sends client_id and NOTHING else", async () => {
  const fetchImpl = stubFetch(START_OK);
  await startDeviceFlow(CLIENT_ID, fetchImpl);
  assert.equal(fetchImpl.calls[0].url, DEVICE_CODE_URL);
  assert.deepEqual(fetchImpl.calls[0].fields, { client_id: CLIENT_ID });
});

test("poll sends no client_secret", async () => {
  const fetchImpl = stubFetch(TOKENS_OK);
  await pollDeviceFlow(CLIENT_ID, "dc-abc", fetchImpl);
  const { fields, url } = fetchImpl.calls[0];
  assert.equal(url, ACCESS_TOKEN_URL);
  assert.deepEqual(Object.keys(fields).sort(), ["client_id", "device_code", "grant_type"]);
});

test("refresh sends no client_secret — the finding this whole design rests on", async () => {
  const fetchImpl = stubFetch(TOKENS_OK);
  await refreshTokens(CLIENT_ID, "ghr_test", fetchImpl);
  const { fields } = fetchImpl.calls[0];
  assert.deepEqual(Object.keys(fields).sort(), ["client_id", "grant_type", "refresh_token"]);
  assert.equal(fields.grant_type, "refresh_token");
});

test("no outbound request carries anything secret-shaped", async () => {
  for (const [call, run] of [
    [stubFetch(START_OK), (f) => startDeviceFlow(CLIENT_ID, f)],
    [stubFetch(TOKENS_OK), (f) => pollDeviceFlow(CLIENT_ID, "dc", f)],
    [stubFetch(TOKENS_OK), (f) => refreshTokens(CLIENT_ID, "ghr", f)],
  ]) {
    await run(call);
    for (const sent of call.calls) {
      assert.equal(Object.keys(sent.fields).some((k) => /secret|password|assertion/i.test(k)), false);
      assert.equal("Authorization" in sent.headers, false);
    }
  }
});

// ── start ────────────────────────────────────────────────────────────────────

test("start returns the user-facing view and keeps the device code separate", async () => {
  const result = await startDeviceFlow(CLIENT_ID, stubFetch(START_OK));
  assert.equal(result.ok, true);
  assert.equal(result.deviceCode, "dc-abc");
  assert.deepEqual(result.view, {
    userCode: "9F66-99DE",
    verificationUri: "https://github.com/login/device",
    expiresIn: 899,
    interval: 5,
  });
  // The device code must NOT be part of what the page is handed.
  assert.equal("deviceCode" in result.view, false);
});

test("a disabled Device Flow toggle surfaces GitHub's reason, not a generic failure", async () => {
  const result = await startDeviceFlow(
    CLIENT_ID,
    stubFetch({ error: "device_flow_disabled" }, { status: 400 }),
  );
  assert.deepEqual(result, { ok: false, error: "device_flow_disabled" });
});

test("a non-JSON reply is an outage, not a refusal", async () => {
  const result = await startDeviceFlow(CLIENT_ID, stubFetch(null, { json: false }));
  assert.deepEqual(result, { ok: false, error: "github_unavailable" });
});

test("a partial start reply is refused rather than half-used", async () => {
  const result = await startDeviceFlow(CLIENT_ID, stubFetch({ device_code: "dc", user_code: "X" }));
  assert.equal(result.ok, false);
});

// ── poll: pending is not failure, refusal is not pending ─────────────────────

test("authorization_pending means keep asking", async () => {
  const result = await pollDeviceFlow(CLIENT_ID, "dc", stubFetch({ error: "authorization_pending" }));
  assert.equal(result.status, "pending");
});

test("slow_down means keep asking, but slower — and carries the new interval", async () => {
  const result = await pollDeviceFlow(CLIENT_ID, "dc", stubFetch({ error: "slow_down", interval: 10 }));
  assert.deepEqual(result, { status: "pending", error: "slow_down", interval: 10 });
});

test("access_denied and expired_token are TERMINAL, not pending", async () => {
  for (const error of ["access_denied", "expired_token", "incorrect_device_code"]) {
    const result = await pollDeviceFlow(CLIENT_ID, "dc", stubFetch({ error }));
    assert.equal(result.status, "error", `${error} must not be retried forever`);
  }
});

test("a successful poll yields both tokens and both lifetimes", async () => {
  const result = await pollDeviceFlow(CLIENT_ID, "dc", stubFetch(TOKENS_OK));
  assert.deepEqual(result, {
    status: "ok",
    tokens: {
      accessToken: "ghu_test",
      expiresIn: 28800,
      refreshToken: "ghr_test",
      refreshExpiresIn: 15897600,
    },
  });
});

test("an access token with no expiry is capped, never treated as permanent", async () => {
  const result = await pollDeviceFlow(CLIENT_ID, "dc", stubFetch({ access_token: "ghu_x" }));
  assert.equal(result.tokens.expiresIn, 8 * 3600);
  assert.equal(result.tokens.refreshToken, undefined);
});

// ── cookies ──────────────────────────────────────────────────────────────────

const attrs = (setCookie) => setCookie.split("; ").slice(1);

test("every cookie is HttpOnly, Secure, SameSite=Lax and scoped to /admin", () => {
  for (const c of [...authCookies({ accessToken: "a", expiresIn: 1, refreshToken: "r", refreshExpiresIn: 2 }), deviceCookie("dc")]) {
    if (c.includes("Max-Age=0")) continue; // clearing cookies carry no attributes
    const a = attrs(c);
    assert.ok(a.includes("HttpOnly"), c);
    assert.ok(a.includes("Secure"), c);
    assert.ok(a.includes("SameSite=Lax"), c);
    assert.ok(a.includes("Path=/admin"), c);
  }
});

test("cookie lifetimes come from GitHub, not from us", () => {
  const [access, , refresh] = authCookies({
    accessToken: "a",
    expiresIn: 28800,
    refreshToken: "r",
    refreshExpiresIn: 15897600,
  });
  assert.ok(access.includes("Max-Age=28800"));
  assert.ok(refresh.includes("Max-Age=15897600"));
});

test("a reply without a refresh token does not blank out the live one", () => {
  const set = authCookies({ accessToken: "a", expiresIn: 100 });
  assert.equal(set.some((c) => c.startsWith(`${REFRESH_COOKIE}=`)), false);
});

test("a successful sign-in spends the device cookie", () => {
  const set = authCookies({ accessToken: "a", expiresIn: 100 });
  assert.ok(set.some((c) => c.startsWith(`${DEVICE_COOKIE}=;`) && c.includes("Max-Age=0")));
});

test("sign-out clears all three", () => {
  const names = clearAuthCookies().map((c) => c.split("=")[0]);
  assert.deepEqual(names.sort(), [ACCESS_COOKIE, DEVICE_COOKIE, REFRESH_COOKIE].sort());
  for (const c of clearAuthCookies()) assert.ok(c.includes("Max-Age=0"));
});

test("readCookie picks the right one out of a crowded header", () => {
  const header = `other=1; ${ACCESS_COOKIE}=ghu_abc; ${REFRESH_COOKIE}=ghr_xyz`;
  assert.equal(readCookie(header, ACCESS_COOKIE), "ghu_abc");
  assert.equal(readCookie(header, REFRESH_COOKIE), "ghr_xyz");
  assert.equal(readCookie(header, "nope"), undefined);
  assert.equal(readCookie(null, ACCESS_COOKIE), undefined);
});

// A cookie NAME that is a prefix of another must not match it — `lanza_gh` is a
// literal prefix of `lanza_gh_refresh`, so the two live one typo apart.
test("a prefix cookie name does not match the longer one", () => {
  assert.equal(readCookie(`${REFRESH_COOKIE}=ghr_only`, ACCESS_COOKIE), undefined);
});
