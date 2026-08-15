// Adversarial tests for the REAL gh proxy route (functions/admin/api/gh/[[path]].ts),
// driven end to end with a stubbed fetch. gh-proxy.test.mjs and roles.test.mjs cover
// the pure decisions; this covers the file that WIRES them together and attaches a
// credential — the place where a policy that is correct in isolation can still be
// applied too late, or not at all.
//
// It matters more after phase 3 (docs/security-todo.md §10.4). The token is no longer
// an installation token minted for ONE repo: it is the signed-in person's own GitHub
// token, which reaches every repository they can touch. If a request escapes this
// proxy's confinement it lands on their other repos with their full access. So
// "nothing was written" here means the stub fetch was never called at all — every
// refusal below asserts that, not just the status code.
// Run: node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs functions/_lib/gh-proxy-route.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../admin/api/gh/[[path]].ts";
import repo from "../../lanza.config.json" with { type: "json" };

const HOST = "https://lanzacms.com";
const TOKEN = "ghu_the_signed_in_persons_own_token";

// Drive the route the way Pages does: `data` comes from the gate, `params.path` is
// the catch-all split into segments.
async function proxy(method, subPath, { role = "owner", token = TOKEN, login, body, origin } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "4999",
        "cache-control": "private, max-age=60",
      },
    });
  };
  const [path, search = ""] = subPath.split("?");
  const headers = origin ? { origin } : {};
  const res = await onRequest({
    request: new Request(`${HOST}/admin/api/gh/${subPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env: {},
    params: { path: path.split("/") },
    data: { role, token, login },
  });
  void search;
  return { res, calls };
}

// ── The phase-3 change: the token is the person's, and there is no other one ──

test("the gate's token is what gets attached — no mint, no standing PAT", async () => {
  const { res, calls } = await proxy("GET", "contents/content/posts/hello.md");
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.get("Authorization"), `Bearer ${TOKEN}`);
  assert.equal(
    calls[0].url,
    `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/content/posts/hello.md`,
  );
});

test("no token from the gate → 401 sign in, and GitHub is never called", async () => {
  // The old RS256 session admits a browser but is a credential for OUR broker, not
  // for GitHub. Before phase 3 this fell back to a broker mint or a standing PAT;
  // now there is nothing to fall back TO, and that must read as "sign in", not 500.
  const { res, calls } = await proxy("GET", "contents/x.md", { token: null });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
  assert.match((await res.json()).message, /Sign in with GitHub/);
});

test("GET /user is answered from the gate's identity, without spending a round-trip", async () => {
  const { res, calls } = await proxy("GET", "user", { login: "dsottimano" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { login: "dsottimano" });
  assert.equal(calls.length, 0);
});

// ── Confinement: a user token reaches other repos, this proxy must not ──

test("the allowlist refuses an endpoint the CMS never calls, before any token is attached", async () => {
  for (const [method, path] of [
    ["GET", "orgs/anything"],
    ["DELETE", "git/refs/heads/main"],
    ["POST", "actions/workflows/x/dispatches"],
    ["PUT", "collaborators/someone"],
  ]) {
    const { res, calls } = await proxy(method, path, { body: method === "GET" ? undefined : {} });
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.equal(calls.length, 0, `${method} ${path} must not reach GitHub`);
  }
});

test("traversal out of this repository is refused in every encoding, and nothing is fetched", async () => {
  for (const path of [
    "contents/../../../orgs/evil",
    "contents/..%2f..%2f..%2forgs/evil",
    "contents/%252e%252e%252f%252e%252e%252forgs/evil",
    "contents/..\\..\\orgs/evil",
  ]) {
    const { res, calls } = await proxy("GET", path);
    assert.equal(res.status, 403, path);
    assert.equal(calls.length, 0, path);
  }
});

// ── Roles: the same rules, now applied to a token that could do more ──

test("a viewer writes nothing, anywhere", async () => {
  const { res, calls } = await proxy("PUT", "contents/content/posts/hello.md", {
    role: "viewer",
    body: { message: "x", content: "eA==", branch: "staging" },
  });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
  // A viewer still reads.
  const read = await proxy("GET", "contents/content/posts/hello.md", { role: "viewer" });
  assert.equal(read.res.status, 200);
});

test("an editor cannot publish — POST /merges is the publish, and it is refused", async () => {
  const { res, calls } = await proxy("POST", "merges", {
    role: "editor",
    body: { base: "main", head: "staging" },
  });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
  // The owner may.
  const owner = await proxy("POST", "merges", {
    role: "owner",
    body: { base: "main", head: "staging" },
  });
  assert.equal(owner.res.status, 200);
  assert.equal(owner.calls.length, 1);
});

test("an editor cannot write outside content, nor onto the production branch", async () => {
  const outside = await proxy("PUT", "contents/lanza.config.json", {
    role: "editor",
    body: { message: "x", content: "eA==", branch: "staging" },
  });
  assert.equal(outside.res.status, 403);
  assert.equal(outside.calls.length, 0);

  const onMain = await proxy("PUT", "contents/content/posts/hello.md", {
    role: "editor",
    body: { message: "x", content: "eA==", branch: "main" },
  });
  assert.equal(onMain.res.status, 403);
  assert.equal(onMain.calls.length, 0);
});

test("a missing role is treated as an editor, never as an owner", async () => {
  const { res, calls } = await proxy("POST", "merges", {
    role: null, // the gate set no role claim at all
    body: { base: "main", head: "staging" },
  });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test("an unreadable body on an editor write is refused rather than checked as nothing", async () => {
  globalThis.fetch = async () => {
    throw new Error("must not be called");
  };
  const res = await onRequest({
    request: new Request(`${HOST}/admin/api/gh/contents/content/posts/hello.md`, {
      method: "PUT",
      body: "{not json",
    }),
    env: {},
    params: { path: ["contents", "content", "posts", "hello.md"] },
    data: { role: "editor", token: TOKEN },
  });
  assert.equal(res.status, 403);
});

// ── The rest of the proxy's job, unchanged by phase 3 but easy to break ──

test("a cross-origin write is rejected before the token is attached", async () => {
  const { res, calls } = await proxy("PUT", "contents/content/posts/hello.md", {
    origin: "https://evil.example",
    body: { message: "x", content: "eA==", branch: "staging" },
  });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test("the response is never cached, and GitHub's rate-limit headers are not relayed", async () => {
  const { res } = await proxy("GET", "contents/content/posts/hello.md");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-ratelimit-remaining"), null);
});
