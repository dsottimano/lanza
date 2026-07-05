import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import CollectionList from "./CollectionList.vue";
import type { FolderCollection } from "../schema";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div/>" } }],
});

const pages: FolderCollection = {
  kind: "folder",
  name: "pages",
  label: "Pages",
  labelSingular: "Page",
  folder: "content/pages",
  body: "rich",
  localized: true,
  fields: [],
};

// A client whose listDir returns the given entries — CollectionList only calls that.
function clientWith(entries: { name: string; path: string; sha: string }[]) {
  return { listDir: async () => entries } as never;
}

function mountList(locale: string, entries: { name: string; path: string; sha: string }[]) {
  return mount(CollectionList, {
    props: { client: clientWith(entries), collection: pages, locale },
    global: { plugins: [router] },
  });
}

describe("CollectionList — real links to real pages", () => {
  it("renders each entry as a link to its locale-scoped entry URL", async () => {
    const w = mountList("en", [{ name: "home.md", path: "content/pages/en/home.md", sha: "x" }]);
    await flushPromises();
    const link = w.find("li a");
    expect(link.attributes("href")).toContain("/pages/en/home");
    expect(link.text()).toContain("home");
  });

  it("links to the other locale's equivalent page when the locale changes", async () => {
    const w = mountList("es", [{ name: "home.md", path: "content/pages/es/home.md", sha: "x" }]);
    await flushPromises();
    expect(w.find("li a").attributes("href")).toContain("/pages/es/home");
  });

  it('the "new" action is a link to the new-entry URL', async () => {
    const w = mountList("en", [{ name: "home.md", path: "content/pages/en/home.md", sha: "x" }]);
    await flushPromises();
    const hrefs = w.findAll("a").map((a) => a.attributes("href"));
    expect(hrefs.some((h) => h?.includes("/pages/en/new"))).toBe(true);
  });
});
