import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import CollectionList from "./CollectionList.vue";
import type { FolderCollection } from "../schema";
import { site } from "../backend/site";

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

function mountList(
  locale: string,
  entries: { name: string; path: string; sha: string }[],
  collection: FolderCollection = pages,
) {
  return mount(CollectionList, {
    props: { client: clientWith(entries), collection, locale },
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

// The language control moved here (and onto the entry) from the sidebar. This list is
// the ONLY way into a language with no entries yet — nothing else in the CMS links to
// /pages/es when content/pages/es is empty. If it goes missing, that locale is
// unreachable without hand-editing the URL.
describe("CollectionList — which language of this collection", () => {
  const localeLinks = (w: ReturnType<typeof mountList>) =>
    w.findAll("a.segment-btn").map((a) => [a.text(), a.attributes("href")] as const);

  beforeEach(() => {
    site.defaultLocale = "en";
    site.locales = [
      { code: "en", label: "English" },
      { code: "es", label: "Español" },
    ];
  });

  it("links this collection's list in every language the site has", async () => {
    const w = mountList("en", []);
    await flushPromises();
    expect(localeLinks(w)).toEqual([
      ["English", "/pages/en"],
      ["Español", "/pages/es"],
    ]);
  });

  it("reaches a locale with no entries at all — the point of the control", async () => {
    const w = mountList("en", []); // listDir returns [] for every locale here
    await flushPromises();
    expect(w.text()).toContain("No pages yet");
    expect(localeLinks(w).map(([, href]) => href)).toContain("/pages/es");
  });

  it("marks the language on screen", async () => {
    const w = mountList("es", []);
    await flushPromises();
    const active = w.findAll("a.segment-btn").filter((a) => a.classes("segment-btn--active"));
    expect(active).toHaveLength(1);
    expect(active[0].text()).toBe("Español");
  });

  it("stays away when there is nothing to switch", async () => {
    site.locales = [{ code: "en", label: "English" }];
    const single = mountList("en", []);
    await flushPromises();
    expect(localeLinks(single)).toEqual([]);

    site.locales = [
      { code: "en", label: "English" },
      { code: "es", label: "Español" },
    ];
    // A shared collection keeps one set of files for every language.
    const shared: FolderCollection = { ...pages, name: "authors", folder: "content/authors" };
    delete shared.localized;
    const w = mountList("en", [], shared);
    await flushPromises();
    expect(localeLinks(w)).toEqual([]);
  });
});
