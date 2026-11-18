import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import EditorView from "./EditorView.vue";
import Editor from "../editor/Editor.vue";
import { access } from "../backend/access";
import { isDirty } from "./dirty";
import manifesto from "../../../templates/manifesto/fields.json";
import type { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
vi.mock("vue-router", async original => ({ ...await original<typeof import("vue-router")>(), useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {} }) }));
vi.mock("./staging", () => ({ pendingCount: 0, refreshPending: vi.fn() }));
vi.mock("../errors", () => ({ reportError: vi.fn(), clearError: vi.fn() }));
const wrappers: VueWrapper[] = [];
beforeEach(() => { sessionStorage.clear(); Object.assign(access, { loaded: true, role: "owner", login: "o", repo: "o/s" }); vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 }))); });
afterEach(async () => { wrappers.splice(0).forEach(w => w.unmount()); await flushPromises(); vi.unstubAllGlobals(); isDirty.value = false; });
const pages: FolderCollection = { kind: "folder", name: "pages", label: "Pages", labelSingular: "Page", localized: true, folder: "content/pages", body: "rich", fields: [
  { name: "title", label: "Title", widget: "string" }, { name: "preset", label: "Template", widget: "preset" }, { name: "slots", label: "Content", widget: "slots" }] };

it("keeps text typed in the canvas when a preset is chosen before saving", async () => {
  const client = { loadEntry: vi.fn().mockResolvedValue({ sha: "s", data: { title: "About" }, body: "<p>Original</p>" }),
    loadText: vi.fn().mockResolvedValue({ text: "", sha: "t" }), listSubdirs: vi.fn().mockResolvedValue([{ name: "manifesto" }]),
    loadJson: vi.fn().mockResolvedValue({ data: manifesto }), saveEntry: vi.fn().mockResolvedValue("saved") };
  const preview = defineComponent({ setup(_p, { expose }) { expose({ highlight: vi.fn(), scrollToField: vi.fn() }); return () => h("div"); } });
  const w = mount(EditorView, { attachTo: document.body, props: { client: client as unknown as GitHubClient, collection: pages, locale: "en", path: "content/pages/en/about.md" },
    global: { stubs: { PreviewPane: preview, EntryLocaleBar: true, Toolbar: true } } });
  wrappers.push(w); await flushPromises();
  const editor = w.findComponent(Editor).vm.editor!;
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.insertContent(" typed before choosing a design");
  await flushPromises();
  await w.get("#tpl-preset").setValue("manifesto"); await flushPromises();
  expect(w.find(".page-editor").exists()).toBe(true);
  await w.findAll("button").find(b => b.text() === "Save")!.trigger("click"); await flushPromises();
  expect(client.saveEntry).toHaveBeenCalled();
  expect(client.saveEntry.mock.calls.at(-1)![2]).toContain("Original typed before choosing a design");
});
