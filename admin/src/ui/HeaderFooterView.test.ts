import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import HeaderFooterView from "./HeaderFooterView.vue";
import SaveButton from "./SaveButton.vue";
import { site } from "../backend/site";
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
  const menuSaves: { path: string; data: unknown }[] = [];
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
    async saveJson(path: string, data: unknown) {
      menuSaves.push({ path, data: JSON.parse(JSON.stringify(data)) });
      return "new-menu-sha";
    },
  };
  return { client: client as never, saves, menuSaves };
}

async function mountView() {
  const { client, saves, menuSaves } = makeClient();
  const w = mount(HeaderFooterView, { props: { client, menuFile, locale: "en" } });
  await flushPromises();
  return { w, saves, menuSaves };
}

describe("HeaderFooterView — visual builder", () => {
  it("requests a language switch without changing the loaded language before navigation", async () => {
    const previous = site.locales;
    site.locales = [{ code: "en", label: "English" }, { code: "es", label: "Español" }];
    try {
      const { w } = await mountView();
      await w.find("select").setValue("es");
      expect(w.emitted("locale")).toEqual([["es"]]);
      expect((w.find("select").element as HTMLSelectElement).value).toBe("en");
      w.unmount();
    } finally { site.locales = previous; }
  });

  it("saves translated links only to the selected language file", async () => {
    const { client, menuSaves, saves } = makeClient();
    const w = mount(HeaderFooterView, { props: { client, menuFile, locale: "es" } });
    await flushPromises();
    const label = w.findAll("input").find(i => (i.element as HTMLInputElement).value === "Blog")!;
    await label.setValue("Noticias");
    await w.findComponent(SaveButton).find("button").trigger("click");
    await flushPromises();
    expect(menuSaves.map(s => s.path)).toEqual(["data/menu.es.json"]);
    expect(saves).toHaveLength(0);
    w.unmount();
  });

  it("renders friendly cards for the recognized sections", async () => {
    const { w } = await mountView();
    const text = w.text();
    expect(text).toContain("Brand / logo");
    expect(text).toContain("Navigation links");
    expect(w.find("details").attributes("open")).toBeUndefined();
    expect(text).not.toContain("HTML block");
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

    // Advanced editing works on the complete source, including its wrappers.
    const ta = w.find("textarea");
    const edited = (ta.element as HTMLTextAreaElement).value + "<!--edited-->";
    await ta.setValue(edited);
    await w.findComponent(SaveButton).find("button").trigger("click");
    await flushPromises();

    const header = saves.find((s) => s.path.endsWith("header.html"));
    expect(header).toBeTruthy();
    expect(header!.text).toBe(headerHtml + "<!--edited-->");
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

  it("edits the footer menu after switching areas without changing header links", async () => {
    const { w, saves, menuSaves } = await mountView();
    await w.findAll(".hf-part-picker button")[1]!.trigger("click");
    await w.findAll("button").find(b => b.text() === "+ Add link")!.trigger("click");
    const inputs = w.findAll("input");
    await inputs[0]!.setValue("Contact");
    await inputs[1]!.setValue("/contact/");
    await w.findComponent(SaveButton).find("button").trigger("click");
    await flushPromises();
    expect(menuSaves).toHaveLength(1);
    expect(menuSaves[0]!.data).toMatchObject({ locations: {
      header: { desktop: [{ label: "Blog", url: "/posts" }] },
      footer: { desktop: [{ label: "Contact", url: "/contact/" }] },
    } });
    expect(saves).toHaveLength(0);
  });
});
