import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import EditorView from "./EditorView.vue";
import { access } from "../backend/access";
import { isDirty } from "./dirty";
import type { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", async original => ({ ...await original<typeof import("vue-router")>(), useRouter: () => ({ push }), useRoute: () => ({ query: {} }) }));
vi.mock("./staging", () => ({ refreshPending: vi.fn() }));
vi.mock("../errors", () => ({ reportError: vi.fn(), clearError: vi.fn() }));
const wrappers: VueWrapper[] = [];
beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear(); push.mockClear();
  Object.assign(access, { loaded: true, role: "owner", login: "fixture", repo: "fixture/site" });
});
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.useRealTimers(); isDirty.value = false; });
function fixture() {
  const collection: FolderCollection = { kind: "folder", name: "articles", label: "Articles", labelSingular: "Article",
    folder: "content/articles", localized: true, body: "rich", fields: [
      { name: "title", label: "Title", widget: "string" },
      { name: "draft", label: "Draft", widget: "boolean" },
    ] };
  const client = { loadEntry: vi.fn().mockResolvedValue({ sha: "old", data: { title: "Research", draft: true }, body: "<p>Research notes</p>" }),
    loadText: vi.fn().mockResolvedValue({ text: "", sha: "old" }), saveEntry: vi.fn().mockResolvedValue("saved") };
  const wrapper = mount(EditorView, { props: { client: client as unknown as GitHubClient,
    collection, locale: "en", path: "content/articles/en/research.md" },
    global: { stubs: { Editor: defineComponent({ setup(_props, { expose }) {
      expose({ getHTML: () => "<p>Research notes</p>" }); return () => h("div");
    } }), Toolbar: true, EntryLocaleBar: true, WritingPanel: true } } });
  wrappers.push(wrapper); return { wrapper, client };
}
it("saves a draft as publishable before opening review, preserving its body", async () => {
  const { wrapper, client } = fixture(); await flushPromises();
  expect(wrapper.find("header").text()).not.toContain("Ready");
  expect(wrapper.find("header").text()).not.toContain("to publish");
  await wrapper.findAll("button").find(b => b.text() === "Review & publish")!.trigger("click");
  await flushPromises();
  expect(client.saveEntry).toHaveBeenCalledOnce();
  expect(client.saveEntry.mock.calls[0]![1]).toMatchObject({ title: "Research", draft: false });
  expect(client.saveEntry.mock.calls[0]![2]).toContain("Research notes");
  expect(push).toHaveBeenCalledWith("/publish");
});
it("stays in the editor if saving fails", async () => {
  const { wrapper, client } = fixture(); await flushPromises();
  client.saveEntry.mockRejectedValue(new Error("Conflict"));
  await wrapper.findAll("button").find(b => b.text() === "Review & publish")!.trigger("click");
  await flushPromises(); expect(push).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("Conflict");
});
it("ordinary Save keeps a draft unpublished and editors have no publish action", async () => {
  access.role = "editor";
  const { wrapper, client } = fixture(); await flushPromises();
  expect(wrapper.find("header").text()).not.toContain("Review & publish");
  await wrapper.findAll("button").find(b => b.text() === "Save")!.trigger("click");
  await flushPromises();
  expect(client.saveEntry.mock.calls[0]![1]).toMatchObject({ draft: true });
  expect(push).not.toHaveBeenCalled();
});
