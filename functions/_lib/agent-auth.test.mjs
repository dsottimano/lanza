// Tests for the "Connect an agent" relays (functions/admin/api/auth/agent/*).
//
// These two endpoints are the only place in the CMS that returns a token to
// JavaScript, so the guards around them are the whole story: owner-only, bound to
// the browser that started the flow, and honest about a token that cannot actually
// reach the repository.
// Run: node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs functions/_lib/agent-auth.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest as start } from "../admin/api/auth/agent/start.ts";
import { onRequest as poll } from "../admin/api/auth/agent/poll.ts";
import { AGENT_CLIENT_ID, GITHUB_CLIENT_ID } from "./tenant-config.ts";
// No `with { type: "json" }` — ts-resolve.mjs supplies it, and Cloudflare bundles
// this file with an esbuild that cannot parse the attribute.
import repo from "../../lanza.config.json";

const HOST = "https://lanzacms.com/admin/api/auth/agent";

function req(path, { cookie, method = "POST" } = {}) {
  return new Request(`${HOST}/${path}`, {
    method,
    headers: cookie ? { cookie } : {},
  });
}

// Stub GitHub. `device` answers the device-code call, `token` the exchange, and the
// last two branches are the calls gh-identity makes to check the install.
//
// Every test that reaches the install check passes a DISTINCT access token.
// gh-identity caches its answer for 60 seconds keyed by a hash of the token, so
// reusing one would silently serve the previous test's verdict and the fetch under
// test would never happen.
function stubGitHub({ device, token, repoPermissions, repoStatus = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    // The upstream body is form-encoded, not JSON — that is what GitHub's
    // login endpoints take.
    calls.push({
      url: u,
      body: init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null,
    });
    if (u.includes("/login/device/code")) {
      return Response.json(device ?? { device_code: "dev-123", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
    }
    if (u.includes("/login/oauth/access_token")) {
      return Response.json(token ?? { access_token: "ghu_agent_token" });
    }
    if (u.endsWith("/user")) return Response.json({ login: "dsottimano" });
    if (u.includes("/repos/")) {
      if (repoStatus !== 200) return new Response("{}", { status: repoStatus });
      return Response.json({ permissions: repoPermissions ?? { admin: true, push: true, pull: true } });
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  return calls;
}

test("start is owner-only, and asks GitHub nothing when it refuses", async () => {
  for (const role of ["editor", "viewer", undefined]) {
    const calls = stubGitHub();
    const res = await start({ request: req("start"), env: {}, data: { role } });
    assert.equal(res.status, 403, String(role));
    assert.equal(calls.length, 0, "GitHub must not be called for a refused role");
  }
});

test("poll is owner-only too — the guard is on both, not just the first", async () => {
  const calls = stubGitHub();
  const res = await poll({
    request: req("poll", { cookie: "lanza_agent_device=dev-123" }),
    env: {},
    data: { role: "editor" },
  });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test("start uses the AGENT app, not the sign-in app", async () => {
  // The two client ids differ by one setting — token expiry — and sending the CMS's
  // id here would hand out an 8-hour token that silently stops working.
  assert.notEqual(AGENT_CLIENT_ID, GITHUB_CLIENT_ID);
  const calls = stubGitHub();
  const res = await start({ request: req("start"), env: {}, data: { role: "owner" } });
  assert.equal(res.status, 200);
  assert.equal(calls[0].body.client_id, AGENT_CLIENT_ID);
});

test("the device code goes into a cookie of its own and never to the page", async () => {
  stubGitHub();
  const res = await start({ request: req("start"), env: {}, data: { role: "owner" } });
  const setCookie = res.headers.get("set-cookie");
  assert.match(setCookie, /^lanza_agent_device=dev-123/);
  assert.match(setCookie, /HttpOnly/);
  // Not the sign-in cookie: starting an agent authorization must not disturb, or be
  // redeemable by, a sign-in.
  assert.ok(!setCookie.includes("lanza_gh_device"));
  const body = await res.json();
  assert.equal(body.userCode, "ABCD-1234");
  assert.ok(!JSON.stringify(body).includes("dev-123"));
});

test("poll without the cookie asks GitHub nothing and says start again", async () => {
  const calls = stubGitHub();
  const res = await poll({ request: req("poll"), env: {}, data: { role: "owner" } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).status, "restart");
  assert.equal(calls.length, 0);
});

test("a successful poll returns the token, marks it ready, and spends the cookie", async () => {
  stubGitHub();
  const res = await poll({
    request: req("poll", { cookie: "lanza_agent_device=dev-123" }),
    env: {},
    data: { role: "owner" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.token, "ghu_agent_token");
  assert.equal(body.ready, true);
  // No refresh token came back, which is what an App with expiry OFF looks like.
  assert.equal(body.expiring, false);
  assert.match(res.headers.get("set-cookie"), /lanza_agent_device=; .*Max-Age=0/);
});

test("a token that cannot reach the repository comes back ready:false, not as an error", async () => {
  // Authorized but not installed: GitHub issues the token happily and every repo
  // call 404s. Silence here becomes a 404 inside the agent, hours later.
  stubGitHub({ token: { access_token: "ghu_not_installed" }, repoStatus: 404 });
  const res = await poll({
    request: req("poll", { cookie: "lanza_agent_device=dev-123" }),
    env: {},
    data: { role: "owner" },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.token, "ghu_not_installed");
  assert.equal(body.ready, false);
});

test("a non-owner's token is not ready either, whoever asked for it", async () => {
  // The signed-in owner starts the flow, but the person who approves at github.com
  // is whoever is logged in THERE. MCP is owner-only, so a push-only approver's
  // token would be refused on first use.
  stubGitHub({
    token: { access_token: "ghu_push_only" },
    repoPermissions: { admin: false, push: true, pull: true },
  });
  const res = await poll({
    request: req("poll", { cookie: "lanza_agent_device=dev-123" }),
    env: {},
    data: { role: "owner" },
  });
  assert.equal((await res.json()).ready, false);
});

test("a pending authorization returns 200 and no token", async () => {
  stubGitHub({ token: { error: "authorization_pending", interval: 7 } });
  const res = await poll({
    request: req("poll", { cookie: "lanza_agent_device=dev-123" }),
    env: {},
    data: { role: "owner" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "pending");
  assert.equal(body.token, undefined);
});

test("the repo it checks against is this tenant's, not one from the request", async () => {
  const calls = stubGitHub({ token: { access_token: "ghu_repo_check" } });
  await poll({
    request: req("poll", { cookie: "lanza_agent_device=dev-123" }),
    env: {},
    data: { role: "owner" },
  });
  assert.ok(calls.some((c) => c.url.includes(`/repos/${repo.owner}/${repo.name}`)));
});

test("GET is refused on both", async () => {
  stubGitHub();
  for (const [name, fn] of [["start", start], ["poll", poll]]) {
    const res = await fn({
      request: req(name, { method: "GET", cookie: "lanza_agent_device=dev-123" }),
      env: {},
      data: { role: "owner" },
    });
    assert.equal(res.status, 405, name);
  }
});
