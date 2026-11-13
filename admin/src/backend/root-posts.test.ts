// Posts served at the site root (posts `route.base: ""`, functions/_lib/post-route.mjs):
// the CMS's View links and URL changes must follow the same rule the build does, and a
// root-level post shares the page URL space, so neither may take the other's slug.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLLECTIONS, setCollections, type FolderCollection } from "../schema";
import { entryPath, entryPathFrame } from "./site-urls";
import { saveUrlChange, type UrlSave } from "./url-changes";
import type { GitHubClient } from "./github";
import { site } from "./site";

const original = JSON.parse(JSON.stringify(COLLECTIONS));
const savedSite = { defaultLocale: site.defaultLocale, locales: site.locales, urls: site.urls };
const withPostsRoute = (route: unknown) =>
  setCollections(original.map((c: FolderCollection) => (c.name === "posts" ? { ...c, route } : c)));

beforeEach(() => {
  site.defaultLocale = "en";
  site.locales = [{ code: "en", label: "English" }, { code: "es", label: "Español" }];
  site.urls = {};
});
afterEach(() => {
  setCollections(original);
  Object.assign(site, savedSite);
});

describe("View links", () => {
  it("keep /posts/ by default and with only a template", () => {
    expect(entryPath("posts", "hello", "en")).toBe("/posts/hello/");
    withPostsRoute({ template: "article" });
    expect(entryPath("posts", "hello", "es")).toBe("/es/posts/hello/");
  });
  it("move to the root, per locale, honouring the urls map", () => {
    withPostsRoute({ base: "", template: "article" });
    site.urls = { "posts/es/hello": "hola" };
    expect(entryPath("posts", "hello", "en")).toBe("/hello/");
    expect(entryPath("posts", "hello", "es")).toBe("/es/hola/");
    expect(entryPathFrame("posts", "hello", "es")).toEqual({ prefix: "/es/", suffix: "/" });
  });
  it("fall back to /posts/ on a route the build would refuse", () => {
    withPostsRoute({ base: "blog" });
    expect(entryPath("posts", "hello", "en")).toBe("/posts/hello/");
  });
});

function fixture(change: Partial<UrlSave>, { postsRoute, tree }: { postsRoute?: unknown; tree: string[] }) {
  const full: UrlSave = {
    collection: "posts", locale: "en", stem: "hello", slug: "new-hello", previousSlug: "hello",
    path: "content/posts/en/hello.md", sha: "entry", data: { title: "Hello" }, body: "<p>Hi</p>", ...change,
  };
  const schema = original.map((c: FolderCollection) => (c.name === "posts" && postsRoute ? { ...c, route: postsRoute } : c));
  const client = {
    workingHead: vi.fn().mockResolvedValue("head"),
    loadJson: vi.fn(async (path: string) => ({
      sha: path,
      data: path === "data/site.json" ? { defaultLocale: "en", locales: [{ code: "en" }, { code: "es" }] }
        : path === "data/schema.json" ? [...schema, { kind: "folder", name: "events", route: { base: "events" } }]
        : { redirects: [] },
    })),
    getTree: vi.fn().mockResolvedValue({ tree: [full.path, ...tree].map((path) => ({ path })), truncated: false }),
    commitChecked: vi.fn().mockResolvedValue({ [full.path]: "new-entry" }),
  };
  return { client, save: () => saveUrlChange(client as unknown as GitHubClient, full) };
}

describe("URL changes", () => {
  it("redirect a root-level post from its root address", async () => {
    const { client, save } = fixture({}, { postsRoute: { base: "" }, tree: [] });
    await save();
    const files = client.commitChecked.mock.calls[0][1] as { path: string; text: string }[];
    const redirects = JSON.parse(files.find((f) => f.path === "data/redirects.json")!.text).redirects;
    expect(redirects).toContainEqual({ from: "/hello/", to: "/new-hello/", status: 301 });
    expect(client.commitChecked.mock.calls[0][2]).toContain("/new-hello/");
  });

  it("refuse a root-level post slug a page, a reserved route or a content type owns", async () => {
    for (const slug of ["about", "category", "posts", "events", "es"]) {
      const { client, save } = fixture({ slug }, { postsRoute: { base: "" }, tree: ["content/pages/en/about.md"] });
      await expect(save()).rejects.toThrow();
      expect(client.commitChecked).not.toHaveBeenCalled();
    }
  });

  it("refuse a page slug a root-level post owns, in the same language only", async () => {
    const page = { collection: "pages", stem: "about", slug: "launch", previousSlug: "about", path: "content/pages/en/about.md" };
    const taken = fixture(page, { postsRoute: { base: "" }, tree: ["content/posts/en/launch.md"] });
    await expect(taken.save()).rejects.toThrow("Another entry");
    const otherLanguage = fixture(page, { postsRoute: { base: "" }, tree: ["content/posts/es/launch.md"] });
    await expect(otherLanguage.save()).resolves.toBe("new-entry");
  });

  it("let posts under /posts/ share a slug with a page, as before", async () => {
    const { save } = fixture({ slug: "about" }, { tree: ["content/pages/en/about.md"] });
    await expect(save()).resolves.toBe("new-entry");
  });
});
