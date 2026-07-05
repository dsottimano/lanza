import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import HeaderFooterView from "./HeaderFooterView.vue";
import SaveButton from "./SaveButton.vue";
import type { FileEntry } from "../schema";
import headerHtml from "../../../templates/parts/header.html?raw";
import footerHtml from "../../../templates/parts/footer.html?raw";

const menuFile: FileEntry = {
  name: "menu",
  label: "Menu",
  file: "data/menu.json",
  localized: true,
  view: "menu",
  fields: [],
};

const menuData = {
  locations: {
    header: { desktop: [{ label: "Blog", url: "/posts" }], tablet: null, mobile: null },
    footer: { desktop: [], tablet: null, mobile: null },
  },
};

// A client that serves the real parts + a menu, and records writes.
function makeClient() {
  const saves: { path: string; text: string }[] = [];
  const client = {
    async loadText(path: string) {
      if (path.endsWith("header.html")) return { text: headerHtml, sha: "h1" };
      if (path.endsWith("footer.html")) return { text: footerHtml, sha: "f1" };
      return { text: "", sha: "css" }; // site.css for the preview
    },
    async loadJson() {
      return { data: menuData, sha: "m1" };
    },
    async saveText(path: string, text: string) {
      saves.push({ path, text });
      return "new-sha";
    },
    async saveJson() {
      return "new-menu-sha";
    },
  };
  return { client: client as never, saves };
}

async function mountView() {
  const { client, saves } = makeClient();
  const w = mount(HeaderFooterView, { props: { client, menuFile, locale: "en" } });
  await flushPromises();
  return { w, saves };
}

describe("HeaderFooterView — visual builder", () => {
  it("renders friendly cards for the recognized sections", async () => {
    const { w } = await mountView();
    const text = w.text();
    expect(text).toContain("Brand / logo");
    expect(text).toContain("Menu links");
    expect(text).toContain("Language switcher");
  });

  it("shows the loaded menu link in the friendly editor", async () => {
    const { w } = await mountView();
    const values = w.findAll("input").map((i) => (i.element as HTMLInputElement).value);
    expect(values).toContain("Blog");
    expect(values).toContain("/posts");
  });

  it("saves an edited block as lossless serialized HTML (menu loop + brand intact)", async () => {
    const { w, saves } = await mountView();

    // Edit the first source textarea (the brand block) and save.
    const ta = w.find("textarea");
    const edited = (ta.element as HTMLTextAreaElement).value + "<!--edited-->";
    await ta.setValue(edited);
    await w.findComponent(SaveButton).find("button").trigger("click");
    await flushPromises();

    const header = saves.find((s) => s.path.endsWith("header.html"));
    expect(header).toBeTruthy();
    // The edit landed…
    expect(header!.text).toContain("<!--edited-->");
    // …and nothing else was harmed: the menu loop, switcher and brand survive verbatim.
    expect(header!.text).toContain("{{#each menuHeader}}");
    expect(header!.text).toContain("{{#if showSwitcher}}");
    expect(header!.text).toContain('class="brand"');
    // The untouched footer is never rewritten.
    expect(saves.some((s) => s.path.endsWith("footer.html"))).toBe(false);
  });

  it("does not rewrite a part when only the menu changed", async () => {
    const { w, saves } = await mountView();
    // Type into the menu link label → menu dirty, parts clean.
    const label = w.findAll("input").find((i) => (i.element as HTMLInputElement).value === "Blog")!;
    await label.setValue("Journal");
    await w.findComponent(SaveButton).find("button").trigger("click");
    await flushPromises();
    expect(saves.some((s) => s.path.endsWith(".html"))).toBe(false); // no part touched
  });
});
