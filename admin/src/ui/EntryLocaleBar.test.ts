import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import EntryLocaleBar from "./EntryLocaleBar.vue";
import type { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
import { site } from "../backend/site";
import { takeTranslationSeed } from "../backend/translations";

// The bar is the only route from an entry to its other languages, and the only place
// that offers to START one. What it must never do is carry the words across: an
// English page sitting under /es looks translated, so nobody reports it.

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

function client(tree: Record<string, string[]>): GitHubClient {
  return {
    listDir: async (dir: string) =>
      (tree[dir] ?? []).map((name) => ({ name, path: `${dir}/${name}`, sha: "x" })),
  } as unknown as GitHubClient;
}

const Blank = { render: () => null };
function testRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: Blank },
      { path: "/:collection/:locale/:slug", component: Blank },
    ],
  });
}

async function bar(props: Record<string, unknown>) {
  const router = testRouter();
  await router.push("/");
  const wrapper = mount(EntryLocaleBar, {
    props: {
      client: client({ "content/pages/en": ["about.md"] }),
      collection: pages,
      locale: "en",
      slug: "about",
      data: {},
      ...props,
    },
    global: { plugins: [router] },
  });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  site.defaultLocale = "en";
  site.locales = [
    { code: "en", label: "English" },
    { code: "es", label: "Español" },
  ];
});

describe("EntryLocaleBar", () => {
  it("lists the site's locales — never a hardcoded pair", async () => {
    site.locales = [
      { code: "en", label: "English" },
      { code: "fr", label: "Français" },
      { code: "ja", label: "日本語" },
    ];
    const { wrapper } = await bar({});
    expect(wrapper.findAll("button").map((b) => b.text())).toEqual([
      "English",
      "Français+",
      "日本語+",
    ]);
  });

  it("hides itself on a single-language site, and on a shared collection", async () => {
    site.locales = [{ code: "en", label: "English" }];
    expect((await bar({})).wrapper.find("button").exists()).toBe(false);

    site.locales = [
      { code: "en", label: "English" },
      { code: "es", label: "Español" },
    ];
    const shared: FolderCollection = { ...pages, name: "authors", folder: "content/authors" };
    delete shared.localized;
    expect((await bar({ collection: shared })).wrapper.find("button").exists()).toBe(false);
  });

  it("marks the language that has no translation yet", async () => {
    const { wrapper } = await bar({});
    const [en, es] = wrapper.findAll("button");
    expect(en.classes()).toContain("segment-btn--active");
    expect(es.text()).toBe("Español+");
    expect(es.attributes("title")).toContain("no text copied over");
  });

  it("opens an existing translation at the same slug", async () => {
    const { wrapper, router } = await bar({
      client: client({ "content/pages/en": ["about.md"], "content/pages/es": ["about.md"] }),
    });
    const es = wrapper.findAll("button")[1];
    expect(es.text()).toBe("Español"); // no "+" — it exists
    await es.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/pages/es/about");
  });

  it("starting a translation carries the slug and the layout, and none of the prose", async () => {
    const { wrapper, router } = await bar({
      data: {
        title: "About us",
        description: "Who we are",
        preset: "about",
        slots: { heading: "About us", cards: [{ body: "Founded in 1998" }] },
      },
    });
    await wrapper.findAll("button")[1].trigger("click");
    await flushPromises();

    // Same stem — that IS the link between the two files — on a NEW entry.
    expect(router.currentRoute.value.fullPath).toBe("/pages/es/new?slug=about");

    const seed = takeTranslationSeed("pages", "es", "about")!;
    expect(seed.preset).toBe("about");
    expect(seed.slots).toEqual({ heading: "", cards: [{ body: "" }] });
    expect(seed.draft).toBe(true);
    expect(JSON.stringify(seed)).not.toMatch(/About us|Who we are|1998/);
  });

  it("does nothing when you click the language you are already in", async () => {
    const { wrapper, router } = await bar({});
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/");
  });
});
