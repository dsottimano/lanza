// Tests for asking GitHub who someone is (functions/_lib/gh-identity.ts).
//
// The interesting cases are the four outcomes, because collapsing any two of them
// is a real bug with a user-visible cost:
//
//   ok / denied      — the answer, and the answer is cached for 60s
//   expired          — the TOKEN is dead, not the person. Collapse it into `denied`
//                      and everyone is signed out every 8 hours instead of refreshed
//   unavailable      — GitHub is down. Collapse it into `denied` and an outage tells
//                      people they were removed from their own repository
//
// Run: node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs functions/_lib/gh-identity.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { identityFor, resetIdentityCache } from "./gh-identity.ts";

const OWNER = "dsottimano";
const NAME = "dave-test";

/** A fetch stub that answers /repos and /user independently and records calls. */
function stubFetch({ repo, user }) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const spec = url.includes("/repos/") ? repo : user;
    if (typeof spec === "function") return spec();
    const { status = 200, body = {} } = spec;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  impl.calls = calls;
  return impl;
}

const withPermissions = (permissions) => ({
  repo: { body: { permissions } },
  user: { body: { login: "dsottimano" } },
});

test.beforeEach(() => resetIdentityCache());

test("admin:true is the owner role", async () => {
  const fetchImpl = stubFetch(
    withPermissions({ admin: true, maintain: true, push: true, triage: true, pull: true }),
  );
  const result = await identityFor("ghu_a", OWNER, NAME, fetchImpl);
  assert.deepEqual(result, { status: "ok", identity: { login: "dsottimano", role: "owner" } });
});

test("push without admin is an editor", async () => {
  const fetchImpl = stubFetch(withPermissions({ admin: false, push: true, pull: true }));
  const result = await identityFor("ghu_b", OWNER, NAME, fetchImpl);
  assert.equal(result.identity.role, "editor");
});

test("pull only is a viewer", async () => {
  const fetchImpl = stubFetch(withPermissions({ admin: false, push: false, pull: true }));
  const result = await identityFor("ghu_c", OWNER, NAME, fetchImpl);
  assert.equal(result.identity.role, "viewer");
});

test("every boolean false is denied, not a role", async () => {
  const fetchImpl = stubFetch(withPermissions({ admin: false, push: false, pull: false }));
  assert.deepEqual(await identityFor("ghu_d", OWNER, NAME, fetchImpl), { status: "denied" });
});

test("a missing permissions object never invents a role", async () => {
  const fetchImpl = stubFetch({ repo: { body: {} }, user: { body: { login: "x" } } });
  assert.deepEqual(await identityFor("ghu_e", OWNER, NAME, fetchImpl), { status: "denied" });
});

test("401 is `expired` — the token, not the person", async () => {
  const fetchImpl = stubFetch({ repo: { status: 401, body: {} }, user: { status: 401, body: {} } });
  assert.deepEqual(await identityFor("ghu_f", OWNER, NAME, fetchImpl), { status: "expired" });
});

test("404 on a private repo means no access, same as 403", async () => {
  for (const status of [403, 404]) {
    resetIdentityCache();
    const fetchImpl = stubFetch({
      repo: { status, body: { message: "Not Found" } },
      user: { body: { login: "someone-else" } },
    });
    assert.deepEqual(await identityFor("ghu_g", OWNER, NAME, fetchImpl), { status: "denied" });
  }
});

test("a network failure is `unavailable`, never `denied`", async () => {
  const fetchImpl = stubFetch({
    repo: () => {
      throw new Error("ECONNRESET");
    },
    user: { body: { login: "x" } },
  });
  assert.deepEqual(await identityFor("ghu_h", OWNER, NAME, fetchImpl), { status: "unavailable" });
});

test("a 500 from GitHub is `unavailable`, never `denied`", async () => {
  const fetchImpl = stubFetch({
    repo: { status: 500, body: {} },
    user: { body: { login: "x" } },
  });
  assert.deepEqual(await identityFor("ghu_i", OWNER, NAME, fetchImpl), { status: "unavailable" });
});

test("the answer is cached per token, and a different token is asked afresh", async () => {
  const fetchImpl = stubFetch(withPermissions({ admin: true }));
  await identityFor("ghu_same", OWNER, NAME, fetchImpl);
  await identityFor("ghu_same", OWNER, NAME, fetchImpl);
  assert.equal(fetchImpl.calls.length, 2, "two calls (repo + user) for the first ask only");
  await identityFor("ghu_other", OWNER, NAME, fetchImpl);
  assert.equal(fetchImpl.calls.length, 4, "a second token cannot ride the first one's answer");
});

test("`unavailable` is not cached — an outage must not become a sticky answer", async () => {
  let down = true;
  const fetchImpl = stubFetch({
    repo: () =>
      down
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify({ permissions: { admin: true } }), { status: 200 }),
    user: { body: { login: "dsottimano" } },
  });
  assert.equal((await identityFor("ghu_flap", OWNER, NAME, fetchImpl)).status, "unavailable");
  down = false;
  assert.equal((await identityFor("ghu_flap", OWNER, NAME, fetchImpl)).status, "ok");
});

test("the token travels as a Bearer header and only to api.github.com", async () => {
  const fetchImpl = stubFetch(withPermissions({ admin: true }));
  await identityFor("ghu_secret", OWNER, NAME, fetchImpl);
  for (const call of fetchImpl.calls) {
    assert.ok(call.url.startsWith("https://api.github.com/"), call.url);
    assert.equal(call.headers.Authorization, "Bearer ghu_secret");
  }
  assert.ok(fetchImpl.calls.some((c) => c.url === `https://api.github.com/repos/${OWNER}/${NAME}`));
  assert.ok(fetchImpl.calls.some((c) => c.url === "https://api.github.com/user"));
});
