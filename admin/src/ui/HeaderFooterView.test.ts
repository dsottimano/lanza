import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import HeaderFooterView from "./HeaderFooterView.vue";
import { isDirty } from "./dirty";
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
    workingHead: vi.fn().mockResolvedValue("head"),
    commitChecked: vi.fn(async (_head: string, files: { path: string; text: string; sha?: string }[]) => {
      const result: Record<string, string> = {};
      for (const file of files) {
        if (file.path.endsWith(".json")) menuSaves.push({ path: file.path, data: JSON.parse(file.text) });
        else saves.push({ path: file.path, text: file.text });
        result[file.path] = "new-sha";
      }
      return result;
    }),
  };
  return { client, saves, menuSaves };
}

async function mountView() {
  const { client, saves, menuSaves } = makeClient();
  const w = mount(HeaderFooterView, { props: { client: client as never, menuFile, locale: "en" } });
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
    const w = mount(HeaderFooterView, { props: { client: client as never, menuFile, locale: "es" } });
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


it("submits menu and part changes atomically and preserves in-flight edits", async () => {
 const { client } = makeClient();
 let finish!: (shas: Record<string, string>) => void;
 client.commitChecked.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const w = mount(HeaderFooterView, { props: { client: client as never, menuFile, locale: "en" } }); await flushPromises();
 const label = w.findAll("input").find(i => (i.element as HTMLInputElement).value === "Blog")!;
 await label.setValue("Submitted"); await w.get("textarea").setValue(headerHtml + "<!--first-->");
 const saving = w.findComponent(SaveButton).props("action")(); await flushPromises();
 expect(client.commitChecked.mock.calls[0]![1].map(f => f.path)).toEqual(["data/menu.en.json", "templates/parts/header.html"]);
 await label.setValue("Later"); await w.get("textarea").setValue(headerHtml + "<!--later-->");
 finish({"data/menu.en.json":"new-menu", "templates/parts/header.html":"new-header"}); await saving;
 expect(isDirty.value).toBe(true);
 await w.findComponent(SaveButton).props("action")();
 expect(client.commitChecked.mock.calls[1]![1].map(f => f.sha)).toEqual(["new-menu","new-header"]);
 expect(isDirty.value).toBe(false); w.unmount();
});

it("retains all dirty changes when the atomic commit fails", async () => {
 const { client } = makeClient(); client.commitChecked.mockRejectedValueOnce(new Error("conflict"));
 const w = mount(HeaderFooterView, { props: { client: client as never, menuFile, locale: "en" } }); await flushPromises();
 await w.get("textarea").setValue(headerHtml + "<!--keep-->");
 await expect(w.findComponent(SaveButton).props("action")()).rejects.toThrow("conflict");
 expect(isDirty.value).toBe(true); expect((w.get("textarea").element as HTMLTextAreaElement).value).toContain("<!--keep-->"); w.unmount();
});

it("does not clear another editor after an unmounted save", async () => {
 const { client } = makeClient(); let finish!: (shas: Record<string,string>) => void;
 client.commitChecked.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
 const w = mount(HeaderFooterView, { props: { client: client as never, menuFile, locale: "en" } }); await flushPromises();
 await w.get("textarea").setValue(headerHtml + "<!--saved-->");
 const saving = w.findComponent(SaveButton).props("action")(); await flushPromises();
 w.unmount(); isDirty.value=true; finish({}); await saving; expect(isDirty.value).toBe(true); isDirty.value=false;
});


it("ignores a superseded locale load", async () => {
 const {client}=makeClient(); let finish!: (value: {data: typeof menuData; sha:string})=>void;
 const originalLoad=client.loadJson;
 client.loadJson=vi.fn().mockImplementation((path:string)=>path==='data/menu.en.json'
   ? new Promise(resolve=>{finish=resolve;})
   : originalLoad());
 const w=mount(HeaderFooterView,{props:{client:client as never,menuFile,locale:'en'}});
 await w.setProps({locale:'es'}); await flushPromises();
 const label=w.findAll('input').find(i=>(i.element as HTMLInputElement).value==='Blog')!;
 await label.setValue('Noticias');
 finish({data:menuData,sha:'stale'});await flushPromises();
 expect((label.element as HTMLInputElement).value).toBe('Noticias');expect(isDirty.value).toBe(true);
 await w.findComponent(SaveButton).props('action')();
 expect(client.commitChecked.mock.calls[0]![1][0]).toMatchObject({path:'data/menu.es.json',sha:'m1'});w.unmount();
});
