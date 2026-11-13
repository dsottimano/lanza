// Posts at the site root and through a tenant template (functions/_lib/post-route.mjs).
//
// One rule read by five places: gen-routes.mjs (the build gate), gen-redirects.mjs
// (301s for the old /posts/ addresses), the site checker, the public site and the CMS.
// These pin the rule itself, the generators that die on it, and the checker problem,
// with schema.json/site.json treated as the untrusted input they are.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  postsRoute,
  rootPostCollisions,
  rootPostRedirects,
  ROOT_RESERVED_SLUGS,
} from "../functions/_lib/post-route.mjs";
import { checkSite, RESERVED_ROUTE_BASES, CHECKS } from "../functions/_lib/site-system.mjs";

const posts = (route) => [{ kind: "folder", name: "posts", folder: "content/posts", fields: [], ...(route === undefined ? {} : { route }) }];

describe("postsRoute", () => {
  test("no route keeps /posts/ and the built-in layout", () => {
    assert.deepEqual(postsRoute(posts()), { base: "posts", template: null, errors: [] });
    assert.deepEqual(postsRoute([]), { base: "posts", template: null, errors: [] });
    assert.deepEqual(postsRoute(null), { base: "posts", template: null, errors: [] });
  });

  test("base \"\" serves posts at the root; template is optional", () => {
    assert.deepEqual(postsRoute(posts({ base: "" })), { base: "", template: null, errors: [] });
    assert.deepEqual(postsRoute(posts({ base: "", template: "article" })), { base: "", template: "article", errors: [] });
    assert.deepEqual(postsRoute(posts({ template: "article" })), { base: "posts", template: "article", errors: [] });
  });

  test("a non-folder collection named posts is not the posts collection", () => {
    assert.deepEqual(postsRoute([{ kind: "files", name: "posts", route: { base: "x" } }]).errors, []);
  });

  // Every refusal falls back to the DEFAULT route, so a caller that forgets to check
  // errors keeps today's URLs instead of rendering something half-configured.
  const REFUSE = [
    ["another base", { base: "blog" }, /route\.base "blog"/],
    ["a base with a slash", { base: "a/b" }, /route\.base/],
    ["a non-string base", { base: 7 }, /route\.base 7/],
    ["a list block", { base: "", list: { template: "x" } }, /cannot declare route\.list/],
    ["an unknown key", { base: "", sortBy: "title" }, /unknown key "sortBy"/],
    ["a template with traversal", { template: "../x" }, /route\.template/],
    ["an uppercase template", { template: "Article" }, /route\.template/],
    ["a non-object route", "root", /must be an object/],
    ["an array route", [], /must be an object/],
  ];
  for (const [name, route, message] of REFUSE) {
    test(`refuses ${name}`, () => {
      const r = postsRoute(posts(route));
      assert.match(r.errors.join(" "), message);
      assert.equal(r.base, "posts");
      assert.equal(r.template, null);
    });
  }
});

describe("rootPostCollisions", () => {
  const ok = { posts: [{ id: "en/hello", slug: "hello" }], pages: [{ id: "en/about", slug: "about" }, { id: "en/home", slug: "" }] };

  test("a free slug passes", () => {
    assert.deepEqual(rootPostCollisions(ok), []);
  });

  const CASES = [
    ["a page slug", { pages: [{ id: "en/about", slug: "about" }] }, "about", /page "en\/about"/],
    ["a fixed page", { fixed: ["archive"] }, "archive", /reserved/],
    ["the posts archive", {}, "posts", /reserved/],
    ["a system route", {}, "style-preview", /reserved/],
    ["a locale prefix", { locales: ["en", "es"] }, "es", /language prefix/],
    ["a content-type base", { routes: [{ name: "events", base: "events" }] }, "events", /"events" content type/],
    ["an empty slug (the home URL)", {}, "", /one lowercase kebab-case segment/],
    ["a nested slug from site.json urls", {}, "category/x", /one lowercase kebab-case segment/],
    ["a slug with a dot", {}, "llms.txt", /one lowercase kebab-case segment/],
  ];
  for (const [name, extra, slug, message] of CASES) {
    test(`refuses ${name}`, () => {
      const errors = rootPostCollisions({ posts: [{ id: "en/x", slug }], pages: [], ...extra });
      assert.equal(errors.length, 1, errors.join("\n"));
      assert.match(errors[0], message);
      assert.match(errors[0], /post "en\/x"/);
    });
  }

  test("refuses two posts mapped to one slug", () => {
    const errors = rootPostCollisions({ posts: [{ id: "en/a", slug: "same" }, { id: "en/b", slug: "same" }], pages: [] });
    assert.deepEqual(errors.length, 1);
    assert.match(errors[0], /post "en\/b".*post "en\/a"/);
  });

  test("reserves every base the built-in routes own", () => {
    for (const base of RESERVED_ROUTE_BASES) assert.ok(ROOT_RESERVED_SLUGS.has(base), base);
  });
});

describe("rootPostRedirects", () => {
  test("one-segment placeholders per locale, so /posts/ itself still serves", () => {
    assert.deepEqual(rootPostRedirects("en", ["en", "es"]), [
      "/posts/:slug /:slug/ 301",
      "/posts/:slug/ /:slug/ 301",
      "/es/posts/:slug /es/:slug/ 301",
      "/es/posts/:slug/ /es/:slug/ 301",
    ]);
  });

  test("a locale code that could inject a rule is dropped", () => {
    const lines = rootPostRedirects("en", ["en", "es /admin/* 200\n/x", "../", 5]);
    assert.equal(lines.length, 2);
    for (const l of lines) assert.doesNotMatch(l, /admin|\n/);
  });
});

describe("checkSite", () => {
  const io = (schema, templates = {}) => ({
    readText: async (p) => {
      if (p === "data/schema.json") return JSON.stringify(schema);
      const m = /^templates\/([^/]+)\/(template\.html|fields\.json)$/.exec(p);
      if (m && templates[m[1]]) return m[2] === "template.html" ? templates[m[1]].html : JSON.stringify(templates[m[1]].fields);
      return null;
    },
    listTemplates: async () => Object.keys(templates),
  });

  test("reports an invalid posts route", async () => {
    const { problems } = await checkSite(io(posts({ base: "blog" })));
    assert.deepEqual(problems.map((p) => p.code), ["posts-route-invalid"]);
    assert.ok(CHECKS.some((c) => c.code === "posts-route-invalid"));
  });

  test("reports a posts template that does not exist", async () => {
    const { problems } = await checkSite(io(posts({ base: "", template: "article" })));
    assert.deepEqual(problems.map((p) => p.code), ["route-template-missing"]);
  });

  // A posts template sits in the DETAIL position, so url/slug/indexUrl and the body
  // are in scope beside the frontmatter fields its fields.json declares.
  test("checks a posts template in the detail position", async () => {
    const article = {
      html: `<article><p>{{ eyebrow }}</p><h1>{{ title }}</h1><a href="{{ indexUrl }}">All</a><link href="{{ url }}">{{{ body }}}</article>`,
      fields: { name: "article", body: true, fields: [{ name: "title", label: "Title", widget: "string" }, { name: "eyebrow", label: "Eyebrow", widget: "string" }] },
    };
    const { problems } = await checkSite(io(posts({ base: "", template: "article" }), { article }));
    assert.deepEqual(problems.filter((p) => p.level === "error"), []);
  });
});

// The generators run as the build does: cwd is the tenant, data is hostile.
describe("generators", () => {
  const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
  const SITE = { defaultLocale: "en", locales: [{ code: "en" }, { code: "es" }] };

  function tenant(schema, { templates = [], redirects = [] } = {}) {
    const cwd = mkdtempSync(join(tmpdir(), "lanza-post-route-"));
    mkdirSync(join(cwd, "data"));
    writeFileSync(join(cwd, "data/schema.json"), JSON.stringify(schema));
    writeFileSync(join(cwd, "data/site.json"), JSON.stringify(SITE));
    writeFileSync(join(cwd, "data/redirects.json"), JSON.stringify({ redirects }));
    for (const t of templates) {
      mkdirSync(join(cwd, "templates", t), { recursive: true });
      writeFileSync(join(cwd, "templates", t, "template.html"), "<p>{{ title }}</p>");
    }
    return cwd;
  }
  const run = (script, cwd) => spawnSync(process.execPath, [join(SCRIPTS, script)], { cwd, encoding: "utf8" });

  // gen-routes writes into the PACKAGE's frontend/pages, so its run must emit nothing
  // there: a posts route is never a generated route. The manifest it rewrites is
  // restored so the test leaves the checkout as it found it. It would also delete
  // routes a previous run generated, so it refuses to run over any.
  function genRoutes(cwd) {
    const manifest = join(SCRIPTS, "../frontend/pages/.generated-routes.json");
    const before = existsSync(manifest) ? readFileSync(manifest, "utf8") : null;
    assert.deepEqual(before ? JSON.parse(before).files : [], [], "frontend/pages has generated routes; run this test on a clean checkout");
    try {
      return run("gen-routes.mjs", cwd);
    } finally {
      if (before !== null) writeFileSync(manifest, before);
    }
  }

  test("gen-routes accepts a root posts route with a template and generates no route file", () => {
    const cwd = tenant(posts({ base: "", template: "article" }), { templates: ["article"] });
    try {
      const r = genRoutes(cwd);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /no collections declare a route/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  for (const [name, route, message] of [
    ["an unsupported base", { base: "blog" }, /route\.base "blog"/],
    ["a missing template", { base: "", template: "article" }, /has no templates\/article\/template\.html/],
  ]) {
    test(`gen-routes fails the build on ${name}`, () => {
      const cwd = tenant(posts(route));
      try {
        const r = genRoutes(cwd);
        assert.equal(r.status, 1);
        assert.match(r.stderr, message);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });
  }

  test("gen-redirects appends the old /posts/ 301s after the owner's rules", () => {
    const cwd = tenant(posts({ base: "" }), { redirects: [{ from: "/posts/kept/", to: "/elsewhere/", status: 301 }] });
    try {
      const r = run("gen-redirects.mjs", cwd);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        readFileSync(join(cwd, "public/_redirects"), "utf8"),
        "/posts/kept/ /elsewhere/ 301\n" +
          "/posts/:slug /:slug/ 301\n/posts/:slug/ /:slug/ 301\n" +
          "/es/posts/:slug /es/:slug/ 301\n/es/posts/:slug/ /es/:slug/ 301\n",
      );
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  test("gen-redirects adds nothing while posts keep /posts/", () => {
    const cwd = tenant(posts({ template: "article" }));
    try {
      assert.equal(run("gen-redirects.mjs", cwd).status, 0);
      assert.equal(readFileSync(join(cwd, "public/_redirects"), "utf8"), "");
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
