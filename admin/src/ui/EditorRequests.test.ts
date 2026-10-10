import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import EditorView from "./EditorView.vue";
import Editor from "../editor/Editor.vue";
import AgentBodyReview from "./AgentBodyReview.vue";
import { access } from "../backend/access";
import { isDirty } from "./dirty";
import { captureRequestAnchor, type SavedRequest } from "../backend/agent-requests";
import type { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
vi.mock("vue-router", async original => ({ ...await original<typeof import("vue-router")>(), useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {} }) }));
vi.mock("./staging", () => ({ refreshPending: vi.fn() }));
vi.mock("../errors", () => ({ reportError: vi.fn(), clearError: vi.fn() }));
const wrappers: VueWrapper[] = [];
let records: SavedRequest[];
let fetcher: ReturnType<typeof vi.fn>;
const respond = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear(); records = [];
  Object.assign(access, { loaded: true, role: "owner", login: "fixture", repo: "fixture/site" });
  fetcher = vi.fn(async (_url, options) => options?.method === "PATCH"
    ? respond({ ...records[0], task: { ...records[0]!.task, status: "resolved" } }) : respond({ requests: records, truncated: false }));
  vi.stubGlobal("fetch", fetcher); vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); isDirty.value = false; });
async function fixture() {
  const collection: FolderCollection = { kind: "folder", name: "posts", label: "Posts", labelSingular: "Post", folder: "content/posts", localized: true, body: "rich", fields: [
    { name: "title", label: "Title", widget: "string" }, { name: "draft", label: "Draft", widget: "boolean" }] };
  const client = { loadEntry: vi.fn().mockResolvedValue({ sha: "original", data: { title: "Research", draft: true }, body: "<p>Ground moves differently.</p>" }),
    loadText: vi.fn().mockResolvedValue({ text: "", sha: "original" }), loadJson: vi.fn().mockResolvedValue({ data: {} }),
    saveEntry: vi.fn().mockResolvedValue("saved"), deleteFile: vi.fn() };
  const wrapper = mount(EditorView, { attachTo: document.body, props: { client: client as unknown as GitHubClient, collection, locale: "en", path: "content/posts/en/article.md" }, global: { stubs: { EntryLocaleBar: true, Toolbar: true } } });
  wrappers.push(wrapper); await flushPromises(); const editor = wrapper.findComponent(Editor).vm.editor!;
  editor.commands.setTextSelection({ from: 1, to: 7 });
  return { wrapper, client, editor };
}
const button = (wrapper: VueWrapper, text: string) => wrapper.findAll("button").find(node => node.text() === text)!;
async function answered(editor: import("@tiptap/core").Editor) {
  records = [{ sha: "a".repeat(40), task: { version: 1, id: "00000000-0000-7000-8000-000000000001", entryPath: "content/posts/en/article.md", action: "rewrite", instruction: "Clarify", anchor: await captureRequestAnchor(editor), status: "answered", createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", createdBy: "fixture", response: { message: "Suggested clarification", replacementHtml: "<strong>Soil</strong>", createdAt: "2026-10-10T00:00:00Z", createdBy: "fixture", origin: "assistant" } } }];
}
it("keeps note editing separate from article autosave and blocks deletion while the request dialog is open", async () => {
  const { wrapper, client } = await fixture(); await button(wrapper, "Verify").trigger("click");
  for (let n = 0; n < 4 && !wrapper.find("dialog").exists(); n++) await flushPromises();
  expect(wrapper.find("dialog").exists()).toBe(true); expect(button(wrapper, "Delete post").attributes("disabled")).toBeDefined();
  await wrapper.find("#agent-request-instruction").setValue("Please check the source.");
  await button(wrapper, "Delete post").trigger("click"); await vi.advanceTimersByTimeAsync(5_000);
  expect(client.deleteFile).not.toHaveBeenCalled(); expect(client.saveEntry).not.toHaveBeenCalled();
  await button(wrapper, "Cancel").trigger("click"); expect(button(wrapper, "Delete post").attributes("disabled")).toBeUndefined();
});
it("reviews a saved response, applies only to captured text, pauses autosave and explicitly saves against the original SHA", async () => {
  const { wrapper, client, editor } = await fixture(); await answered(editor);
  await button(wrapper, "Requests").trigger("click"); await flushPromises();
  editor.commands.setTextSelection({ from: 8, to: 13 });
  await button(wrapper, "Review & apply").trigger("click");
  for (let n = 0; n < 4 && !wrapper.findComponent(AgentBodyReview).exists(); n++) await flushPromises();
  expect(wrapper.findComponent(AgentBodyReview).exists()).toBe(true); expect(editor.getHTML()).toBe("<p>Ground moves differently.</p>");
  await button(wrapper, "Accept in editor").trigger("click"); await flushPromises();
  expect(editor.getHTML()).toBe("<p><strong>Soil</strong> moves differently.</p>");
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5_000); expect(client.saveEntry).not.toHaveBeenCalled();
  await button(wrapper, "Save").trigger("click"); await flushPromises();
  expect(client.saveEntry).toHaveBeenCalledWith("content/posts/en/article.md", expect.objectContaining({ draft: true }), expect.stringContaining("<p><strong>Soil</strong> moves differently.</p>"), expect.any(String), "original");
});
it("rejects an old response before review when any article content has changed", async () => {
  const { wrapper, editor } = await fixture(); await answered(editor);
  await button(wrapper, "Requests").trigger("click"); await flushPromises(); editor.commands.insertContent("Human change");
  await button(wrapper, "Review & apply").trigger("click"); for (let n = 0; n < 4; n++) await flushPromises();
  expect(wrapper.findComponent(AgentBodyReview).exists()).toBe(false); expect(wrapper.text()).toContain("older article");
  expect(fetcher.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
});
