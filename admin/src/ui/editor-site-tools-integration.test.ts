import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import EditorView from "./EditorView.vue";
import RecordEditor from "./RecordEditor.vue";
import SaveButton from "./SaveButton.vue";
import { access } from "../backend/access";
import { isDirty } from "./dirty";
import type { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
import type { ModelContext, SiteTool } from "../backend/site-tools";
import manifesto from "../../../templates/manifesto/fields.json";
import markup from "../../../templates/manifesto/template.html?raw";
import { render } from "../../../frontend/lib/template-render";

vi.mock("vue-router", async original => ({ ...await original<typeof import("vue-router")>(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useRoute: () => ({ params: { slug: "home" }, query: {} }) }));
vi.mock("./staging", () => ({ pendingCount: 0, refreshPending: vi.fn() }));
vi.mock("../errors", () => ({ reportError: vi.fn(), clearError: vi.fn() }));

const wrappers: VueWrapper[] = [];
let tools: Map<string, SiteTool>;
beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear();
  Object.assign(access, { loaded: true, role: "owner", login: "test-owner", repo: "test/tenant" });
  tools = new Map();
  (document as Document & { modelContext?: ModelContext }).modelContext = {
    registerTool: descriptor => { tools.set(descriptor.name, descriptor); },
    unregisterTool: name => { tools.delete(name); },
  };
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
});
afterEach(async () => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount()); await flushPromises();
  delete (document as Document & { modelContext?: ModelContext }).modelContext;
  vi.useRealTimers(); vi.unstubAllGlobals(); isDirty.value = false;
});

const pages: FolderCollection = { kind: "folder", name: "pages", label: "Pages", labelSingular: "Page", localized: true,
  folder: "content/pages", body: "rich", fields: [
    { name: "title", label: "Title", widget: "string" }, { name: "preset", label: "Template", widget: "preset" },
    { name: "slots", label: "Content", widget: "slots" },
  ] };

function page(entry = { sha: "original", data: { title: "Home", preset: "manifesto",
    slots: { headline: "Original heading", cards: [{ who: "Writers", body: "Preserved" }] } }, body: "<p>Preserve the legal body</p>" }) {
  const client = { loadEntry: vi.fn().mockResolvedValue(entry),
    loadText: vi.fn().mockResolvedValue({ text: "", sha: "original" }),
    listSubdirs: vi.fn().mockResolvedValue([{ name: "manifesto" }]),
    loadJson: vi.fn().mockResolvedValue({ data: manifesto }), saveEntry: vi.fn().mockResolvedValue("saved"),
  };
  const preview = defineComponent({ setup(_props, { expose }) {
    expose({ highlight: vi.fn(), scrollToField: vi.fn() }); return () => h("div");
  } });
  const wrapper = mount(EditorView, { attachTo: document.body,
    props: { client: client as unknown as GitHubClient, collection: pages, locale: "en", path: "content/pages/en/home.md" },
    global: { stubs: { PreviewPane: preview, EntryLocaleBar: true, Editor: true, Toolbar: true } } });
  wrappers.push(wrapper); return { wrapper, client };
}

it("proposes a real template field, renders it, and preserves body/other fields through explicit Save", async () => {
  const f = page(); await flushPromises();
  const context = await tools.get("get_editor_context")!.execute({ fieldPath: "slots.headline" }) as { revision: string };
  await tools.get("focus_editor_field")!.execute({ fieldPath: "slots.headline" }); await flushPromises();
  expect(document.activeElement?.getAttribute("placeholder") ?? document.activeElement?.tagName).toBeTruthy();
  await tools.get("propose_editor_change")!.execute({ fieldPath: "slots.headline", expectedRevision: context.revision, value: "Human approved heading" });
  await flushPromises(); await vi.advanceTimersByTimeAsync(5_000);
  expect(f.client.saveEntry).not.toHaveBeenCalled();
  expect(f.wrapper.text()).toContain("Review it, then Save");
  const titleContext = await tools.get("get_editor_context")!.execute({ fieldPath: "title" }) as { revision: string; selected: { value: string } };
  expect(titleContext.selected.value).toBe("Home"); expect(titleContext.revision).not.toBe(context.revision);
  await f.wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click"); await flushPromises();
  expect(f.client.saveEntry).toHaveBeenCalledOnce();
  const [path, data, body, , sha] = f.client.saveEntry.mock.calls[0]!;
  expect(path).toBe("content/pages/en/home.md"); expect(sha).toBe("original");
  expect(body.trim()).toBe("<p>Preserve the legal body</p>");
  expect(data.slots.cards[0]).toEqual({ who: "Writers", body: "Preserved" });
  expect(render(markup, data.slots)).toContain("Human approved heading");
  expect(isDirty.value).toBe(false);
  // A second editor reloads the explicitly saved content and no recovery text.
  f.wrapper.unmount(); await flushPromises();
  page({ sha: "saved", data, body }); await flushPromises();
  expect(await tools.get("get_editor_context")!.execute({ fieldPath: "slots.headline" })).toMatchObject({ selected: { value: "Human approved heading" } });
});

it("typing and saves invalidate older proposals; unmount invalidates retained tool handles", async () => {
  const f = page(); await flushPromises();
  const handle = tools.get("propose_editor_change")!;
  const original = await tools.get("get_editor_context")!.execute({ fieldPath: "slots.headline" }) as { revision: string };
  await tools.get("focus_editor_field")!.execute({ fieldPath: "slots.headline" }); await flushPromises();
  const textarea = f.wrapper.findAll("textarea").find(input => (input.element as HTMLTextAreaElement).value === "Original heading");
  const input = f.wrapper.findAll("input").find(input => (input.element as HTMLInputElement).value === "Original heading");
  await (textarea ?? input)!.setValue("Still typing");
  await expect(handle.execute({ fieldPath: "slots.headline", expectedRevision: original.revision, value: "Stale" })).rejects.toThrow("editor changed");
  const latest = await tools.get("get_editor_context")!.execute({ fieldPath: "slots.headline" }) as { revision: string };
  await vi.advanceTimersByTimeAsync(2_000);
  await expect(handle.execute({ fieldPath: "slots.headline", expectedRevision: latest.revision, value: "Before save" })).rejects.toThrow("editor changed");
  f.wrapper.unmount(); await expect(handle.execute({})).rejects.toThrow("no longer open");
});

it("record tools retain owner/editor authorization and preserve hidden body on Save", async () => {
  Object.assign(access, { role: "editor" });
  const client = { loadEntry: vi.fn().mockResolvedValue({ sha: "record-base", data: { title: "Original" }, body: "Hidden body" }),
    saveEntry: vi.fn().mockResolvedValue("stored") };
  const collection: FolderCollection = { kind: "folder", name: "authors", label: "Authors", labelSingular: "Author", folder: "content/authors",
    body: "none", fields: [{ name: "title", label: "Name", widget: "string" }] };
  const wrapper = mount(RecordEditor, { props: { client: client as unknown as GitHubClient, collection, locale: "en", path: "content/authors/original.md" } });
  wrappers.push(wrapper); await flushPromises();
  const context = await tools.get("get_editor_context")!.execute({ fieldPath: "title" }) as { revision: string };
  await tools.get("propose_editor_change")!.execute({ fieldPath: "title", expectedRevision: context.revision, value: "Edited" });
  expect(client.saveEntry).not.toHaveBeenCalled();
  await wrapper.findComponent(SaveButton).props("action")();
  expect(client.saveEntry).toHaveBeenCalledWith("content/authors/original.md", { title: "Edited", lanzaProvenance: {version:1,fields:{title:{origin:"agent",text:"Edited"}}} }, expect.stringContaining("Hidden body"), expect.any(String), "record-base");
  Object.assign(access, { role: "viewer" });
  const viewer = await tools.get("get_editor_context")!.execute({}) as { revision: string };
  await expect(tools.get("propose_editor_change")!.execute({ fieldPath: "title", expectedRevision: viewer.revision, value: "Forbidden" })).rejects.toThrow("cannot edit");
});
