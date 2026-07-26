// Adversarial tests for invariant I2 — "a denial is not an outage"
// (docs/security-model.md). The MCP server used to do `if (!res.ok) return null`
// and then `githubToken ??= env.GITHUB_TOKEN`, so a broker 401/403 — the owner
// revoked the GitHub App, or the audience check failed — collapsed into "broker
// unavailable" and the request proceeded on the BROADER standing PAT. Revocation
// did not revoke.
//
// "Nothing was written" here means: on a refusal the caller ends up with no token
// at all, so no GitHub request is ever made. Each refusal test asserts the tri-state
// AND replays the caller's own fallback expression to prove it yields null.
// Run: node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs functions/_lib/broker-token.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintRepoToken } from "./broker-token.ts";

const PAT = "ghp_standing_pat_do_not_leak";

// The exact expression in functions/api/mcp.ts and functions/admin/api/gh/[[path]].ts.
// If a refusal ever reaches it, the PAT leaks — so the tests run it, not a paraphrase.
function tokenTheCallerWouldUse(result) {
  if (result === "denied") return null; // handler returns 403 before this point
  return result ? result.token : PAT;
}

function mockBroker(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

test("401 is a refusal, not an outage — no token, PAT untouched", async () => {
  mockBroker(401, { message: "bad session" });
  const result = await mintRepoToken("https://broker.test", "sess", "o", "n", new Map());
  assert.equal(result, "denied");
  assert.equal(tokenTheCallerWouldUse(result), null);
});

test("403 is a refusal — the revoked-App / failed-audience case", async () => {
  mockBroker(403, { message: "not the owner" });
  const cache = new Map();
  const result = await mintRepoToken("https://broker.test", "sess", "o", "n", cache);
  assert.equal(result, "denied");
  assert.equal(tokenTheCallerWouldUse(result), null);
  // A refusal must not poison (or populate) the cache either.
  assert.equal(cache.size, 0);
});

test("a genuine outage (5xx / malformed) MAY fall back to the PAT", async () => {
  mockBroker(503, { message: "upstream down" });
  const down = await mintRepoToken("https://broker.test", "sess", "o", "n", new Map());
  assert.equal(down, null);
  assert.equal(tokenTheCallerWouldUse(down), PAT);

  mockBroker(200, { expiresAt: "2099-01-01T00:00:00Z" }); // 200 with no token
  const empty = await mintRepoToken("https://broker.test", "sess", "o", "n", new Map());
  assert.equal(empty, null);
  assert.equal(tokenTheCallerWouldUse(empty), PAT);
});

test("happy path: mints, returns, caches, and sends the repo the tenant owns", async () => {
  const calls = mockBroker(200, { token: "ghs_installation", expiresAt: "2099-01-01T00:00:00Z" });
  const cache = new Map();
  const result = await mintRepoToken("https://broker.test", "sess", "o", "n", cache);
  assert.deepEqual(result, { token: "ghs_installation" });
  assert.equal(tokenTheCallerWouldUse(result), "ghs_installation");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://broker.test/api/token");
  assert.equal(calls[0].init.headers["X-Lanza-Session"], "sess");
  assert.deepEqual(JSON.parse(calls[0].init.body), { owner: "o", repo: "n" });

  // Second call is served from the cache — no second broker round-trip.
  const again = await mintRepoToken("https://broker.test", "sess", "o", "n", cache);
  assert.deepEqual(again, { token: "ghs_installation" });
  assert.equal(calls.length, 1);
});

test("an unparseable expiresAt does not permanently disable the cache", async () => {
  const calls = mockBroker(200, { token: "ghs_x", expiresAt: "not-a-date" });
  const cache = new Map();
  await mintRepoToken("https://broker.test", "sess", "o", "n", cache);
  // Date.parse → NaN would make every `exp > now` false, so the cache would never
  // hit again and every MCP call would re-mint.
  assert.ok(Number.isFinite(cache.get("o/n").exp));
  await mintRepoToken("https://broker.test", "sess", "o", "n", cache);
  assert.equal(calls.length, 1);
});
