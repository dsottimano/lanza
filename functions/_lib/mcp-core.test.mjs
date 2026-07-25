// End-to-end tests for the MCP server: the JSON-RPC dispatch (mcp-core) driving a
// real ContentClient against a FAKE GitHub (a stateful in-memory file map behind a
// mocked global fetch). Proves protocol shape + the staging/publish content flow
// without a network or real token.
// Run: node --experimental-strip-types functions/_lib/mcp-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMessage, TOOL_LIST } from "./mcp-core.ts";
import { ContentClient } from "./lanza-content.ts";

const REPO = { owner: "o", name: "n" };
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

const SITE = JSON.stringify({ defaultLocale: "en", locales: [{ code: "en" }, { code: "es" }] });
const SCHEMA = JSON.stringify({
  collections: [
    { name: "pages", folder: "content/pages", localized: true, body: "rich" },
    { name: "authors", folder: "content/authors", localized: false, body: "none" },
  ],
});

// A fresh fake GitHub per test: a Map of repo-path → file text, plus staging state.
function fakeGitHub(seed = {}) {
  const files = new Map(Object.entries(seed));
  let published = false;
  const res = (status, body) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace("/repos/o/n/", ""));
    const body = init.body ? JSON.parse(init.body) : {};

    // Branch head (ensureWorkingBranch): staging + main both exist.
    if (method === "GET" && path.startsWith("git/ref/heads/")) return res(200, { object: { sha: "base-sha" } });

    if (method === "GET" && path.startsWith("contents/")) {
      const p = path.replace(/^contents\//, "");
      if (files.has(p)) return res(200, { content: b64(files.get(p)), sha: `sha-${p}` });
      // Directory listing: any file under `p/`.
      const children = [...files.keys()].filter((k) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes("/"));
      if (children.length)
        return res(
          200,
          children.map((k) => ({ type: "file", name: k.split("/").pop(), path: k })),
        );
      return res(404, { message: "Not Found" });
    }
    if (method === "PUT" && path.startsWith("contents/")) {
      const p = path.replace(/^contents\//, "");
      files.set(p, Buffer.from(body.content, "base64").toString("utf8"));
      return res(files.has(p) ? 200 : 201, { commit: { sha: "commit-sha" } });
    }
    if (method === "DELETE" && path.startsWith("contents/")) {
      files.delete(path.replace(/^contents\//, ""));
      return res(200, { commit: { sha: "commit-sha" } });
    }
    if (method === "POST" && path === "git/refs") return res(201, {});
    if (method === "POST" && path === "merges") {
      published = true;
      return res(201, { merged: true, sha: "merge-sha" });
    }
    if (method === "GET" && path.startsWith("compare/"))
      return res(200, { files: [{ filename: "content/pages/en/hello.md", status: "added" }] });

    return res(599, { message: `unmocked ${method} ${path}` });
  };
  return {
    files,
    get published() {
      return published;
    },
  };
}

const client = () => new ContentClient(REPO, "tok");
// Parse the JSON payload a tools/call returns in its single text content block.
const toolData = (resp) => JSON.parse(resp.result.content[0].text);

test("initialize returns protocol + serverInfo", async () => {
  fakeGitHub();
  const r = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, client());
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.equal(r.result.serverInfo.name, "lanza-cms");
  assert.ok(r.result.capabilities.tools);
});

test("tools/list exposes the full surface", async () => {
  const r = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, client());
  const names = r.result.tools.map((t) => t.name);
  for (const n of ["get_site", "list_collections", "get_schema", "list_content", "read_content", "create_content", "update_content", "delete_content", "list_changes", "publish"])
    assert.ok(names.includes(n), `missing tool ${n}`);
  assert.equal(TOOL_LIST.length, names.length);
});

test("notifications get no response", async () => {
  const r = await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, client());
  assert.equal(r, null);
});

test("unknown method → -32601", async () => {
  const r = await handleMessage({ jsonrpc: "2.0", id: 3, method: "bogus" }, client());
  assert.equal(r.error.code, -32601);
});

test("get_site reads locales from data/site.json", async () => {
  fakeGitHub({ "data/site.json": SITE });
  const r = await handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_site" } }, client());
  assert.deepEqual(toolData(r), { defaultLocale: "en", locales: ["en", "es"] });
});

test("create_content stages a new page with draft:false + derived slug", async () => {
  const gh = fakeGitHub({ "data/site.json": SITE, "data/schema.json": SCHEMA });
  const r = await handleMessage(
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "create_content", arguments: { collection: "pages", title: "Hello World", body_html: "<p>Hi</p>" } },
    },
    client(),
  );
  const data = toolData(r);
  assert.equal(data.created, "content/pages/en/hello-world.md");
  const written = gh.files.get("content/pages/en/hello-world.md");
  assert.match(written, /title: Hello World/);
  assert.match(written, /draft: false/);
  assert.match(written, /<p>Hi<\/p>/);
});

test("read_content round-trips frontmatter + body", async () => {
  // schema.json is required: entry paths are confined to a collection's folder.
  fakeGitHub({
    "data/schema.json": SCHEMA,
    "content/pages/en/about.md": "---\ntitle: About\ndraft: false\n---\n\n<p>About us</p>\n",
  });
  const r = await handleMessage(
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "read_content", arguments: { path: "content/pages/en/about.md" } } },
    client(),
  );
  const data = toolData(r);
  assert.equal(data.frontmatter.title, "About");
  assert.match(data.body_html, /About us/);
});

test("update_content merges frontmatter and preserves untouched keys", async () => {
  const gh = fakeGitHub({
    "data/schema.json": SCHEMA,
    "content/pages/en/about.md": "---\ntitle: About\ndraft: true\ndescription: keep me\n---\n\n<p>Body</p>\n",
  });
  await handleMessage(
    {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "update_content", arguments: { path: "content/pages/en/about.md", frontmatter: { draft: false } } },
    },
    client(),
  );
  const written = gh.files.get("content/pages/en/about.md");
  assert.match(written, /draft: false/);
  assert.match(written, /description: keep me/); // preserved
  assert.match(written, /<p>Body<\/p>/); // body preserved (not passed)
});

test("list_content lists a localized folder", async () => {
  fakeGitHub({
    "data/site.json": SITE,
    "data/schema.json": SCHEMA,
    "content/pages/en/a.md": "---\ntitle: A\n---\n",
    "content/pages/en/b.md": "---\ntitle: B\n---\n",
  });
  const r = await handleMessage(
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "list_content", arguments: { collection: "pages", locale: "en" } } },
    client(),
  );
  const data = toolData(r);
  assert.equal(data.count, 2);
  assert.deepEqual(data.paths.sort(), ["content/pages/en/a.md", "content/pages/en/b.md"]);
});

test("publish merges staging into main", async () => {
  const gh = fakeGitHub();
  const r = await handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "publish" } }, client());
  assert.equal(toolData(r).published, true);
  assert.equal(gh.published, true);
});

test("tool errors surface as isError results, not JSON-RPC errors", async () => {
  fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  const r = await handleMessage(
    { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "list_content", arguments: { collection: "nope" } } },
    client(),
  );
  assert.ok(r.result.isError);
  assert.match(r.result.content[0].text, /Unknown collection/);
});

// ---------------------------------------------------------------------------
// Path confinement. Each case below WROTE OUTSIDE THE CONTENT TREE before the
// guards landed — `encodeURIComponent` does not escape dots, so `..` survived
// encodePath and fetch() normalized it away. Keep these adversarial.
// ---------------------------------------------------------------------------

// The tool call must have failed AND left the fake repo untouched — asserting on
// the error alone would pass even if the write had already happened.
const assertRefused = (resp, gh, pattern) => {
  assert.ok(resp.result.isError, "expected the tool call to be refused");
  assert.match(resp.result.content[0].text, pattern);
  assert.deepEqual(
    [...gh.files.keys()].filter((p) => !p.startsWith("data/")),
    [],
    "a refused call must not write anything",
  );
};

const call = (name, args, id = 99) =>
  handleMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, client());

test("create_content: a traversing locale cannot escape the content tree", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  const r = await call("create_content", {
    collection: "pages",
    title: "pwn",
    locale: "../../.github/workflows",
    body_html: "<p>x</p>",
  });
  assertRefused(r, gh, /Unknown locale/);
});

test("create_content: locale must be one the site declares", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  assertRefused(await call("create_content", { collection: "pages", title: "x", locale: "de" }), gh, /Unknown locale/);
});

test("update_content: cannot rewrite lanza.config.json (the /admin owner file)", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  const r = await call("update_content", {
    path: "lanza.config.json",
    frontmatter: { adminLogin: "attacker" },
  });
  assertRefused(r, gh, /outside every content collection|entries are \.md files/);
});

test("update_content: cannot stage a CI workflow via traversal", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  const r = await call("update_content", {
    path: "content/pages/../../.github/workflows/pwn.md",
    body_html: "<p>x</p>",
  });
  assertRefused(r, gh, /traversal is not allowed/);
});

test("read_content: cannot escape the repo namespace onto another API endpoint", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  assertRefused(await call("read_content", { path: "../../../../user" }), gh, /traversal is not allowed/);
});

test("read_content: percent-encoded traversal is refused too", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  assertRefused(
    await call("read_content", { path: "content/pages/%2e%2e/%2e%2e/lanza.config.json" }),
    gh,
    /percent-encoding is not allowed/,
  );
});

test("delete_content: confined to collection folders", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  assertRefused(await call("delete_content", { path: "astro.config.mjs" }), gh, /entries are \.md files/);
});

test("delete_content: a .md outside any collection is still refused", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  assertRefused(await call("delete_content", { path: "README.md" }), gh, /outside every content collection/);
});

test("create_content: refuses to silently overwrite an existing entry", async () => {
  const gh = fakeGitHub({
    "data/schema.json": SCHEMA,
    "data/site.json": SITE,
    "content/pages/en/about.md": "---\ntitle: About\n---\n\n<p>IMPORTANT</p>\n",
  });
  const r = await call("create_content", { collection: "pages", title: "About", body_html: "<p>DEFACED</p>" });
  assert.ok(r.result.isError);
  assert.match(r.result.content[0].text, /already exists/);
  assert.match(gh.files.get("content/pages/en/about.md"), /IMPORTANT/, "the existing entry must survive");
});

test("legitimate entry paths still work after the guards", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  const created = await call("create_content", { collection: "pages", title: "Hello There", body_html: "<p>Hi</p>" });
  assert.equal(toolData(created).created, "content/pages/en/hello-there.md");
  // non-localized collection, and a second locale the site declares
  assert.equal(
    toolData(await call("create_content", { collection: "authors", title: "Jo" })).created,
    "content/authors/jo.md",
  );
  assert.equal(
    toolData(await call("create_content", { collection: "pages", title: "Hola", locale: "es" })).created,
    "content/pages/es/hola.md",
  );
  assert.match(toolData(await call("read_content", { path: "content/pages/en/hello-there.md" })).body_html, /Hi/);
  assert.ok(gh.files.has("content/pages/en/hello-there.md"));
});

test("a null JSON-RPC message is -32600, not a crash", async () => {
  fakeGitHub();
  const r = await handleMessage(null, client());
  assert.equal(r.error.code, -32600);
  // and one bad element must not take down a whole batch
  const batch = await Promise.all([null, { jsonrpc: "2.0", id: 1, method: "ping" }].map((m) => handleMessage(m, client())));
  assert.equal(batch[1].result && typeof batch[1].result, "object");
});
