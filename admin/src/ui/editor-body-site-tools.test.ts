import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import EditorView from "./EditorView.vue";
import Editor from "../editor/Editor.vue";
import AgentBodyReview from "./AgentBodyReview.vue";
import { access } from "../backend/access";
import { isDirty } from "./dirty";
import type { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
import type { ModelContext, SiteTool } from "../backend/site-tools";
vi.mock("vue-router", async original => ({ ...await original<typeof import("vue-router")>(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useRoute: () => ({ params: { slug: "article" }, query: {} }) }));
vi.mock("./staging", () => ({ pendingCount: 0, refreshPending: vi.fn() }));
vi.mock("../errors", () => ({ reportError: vi.fn(), clearError: vi.fn() }));
let tools: Map<string, SiteTool>;
const wrappers: VueWrapper[] = [];
beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear();
  Object.assign(access, { loaded: true, role: "owner", login: "test-owner", repo: "test/tenant" }); tools = new Map();
  (document as Document & { modelContext?: ModelContext }).modelContext = {
    registerTool: descriptor => { tools.set(descriptor.name, descriptor); }, unregisterTool: name => { tools.delete(name); },
  };
});
afterEach(async () => {
  wrappers.splice(0).forEach(w => w.unmount()); await flushPromises();
  delete (document as Document & { modelContext?: ModelContext }).modelContext;
  vi.useRealTimers(); isDirty.value = false;
});
const posts: FolderCollection = { kind: "folder", name: "posts", label: "Posts", labelSingular: "Post", localized: true,
  folder: "content/posts", body: "rich", fields: [{ name: "title", label: "Title", widget: "string" }, { name: "draft", label: "Draft", widget: "boolean" }] };
function open(body = "<p>Original article</p><p>Keep this legal paragraph.</p>") {
  const client = { loadEntry: vi.fn().mockResolvedValue({ sha: "original", data: { title: "Research", draft: true }, body }),
    loadText: vi.fn().mockResolvedValue({ text: "", sha: "original" }), listSubdirs: vi.fn().mockResolvedValue([]),
    loadJson: vi.fn().mockResolvedValue({ data: {} }), saveEntry: vi.fn().mockResolvedValue("saved") };
  const wrapper = mount(EditorView, { attachTo: document.body,
    props: { client: client as unknown as GitHubClient, collection: posts, locale: "en", path: "content/posts/en/article.md" },
    global: { stubs: { EntryLocaleBar: true, Toolbar: true, AgentRequests: true } } }); wrappers.push(wrapper);
  return { wrapper, client, editor: () => wrapper.findComponent(Editor).vm.editor!,
    context: () => tools.get("get_editor_context")!.execute({ includeBody: true }) as Promise<{ revision: string; body: { html: string; selection: { text: string } | null } }> };
}
async function decision(wrapper: VueWrapper, accepted: boolean) {
  await wrapper.findComponent(AgentBodyReview).findAll("button").find(button => button.text() === (accepted ? "Accept in editor" : "Cancel"))!.trigger("click");
  await flushPromises();
}
it("reads unsaved live body, reviews readable previews, applies locally and saves with original SHA", async () => {
  const f = open(); await flushPromises();
  f.editor().commands.insertContent("Human unsaved text. ");
  const context = await f.context(); expect(context.body.html).toContain("Human unsaved text");
  const pending = tools.get("propose_editor_body_change")!.execute({ target: "body", expectedRevision: context.revision,
    html: "<h2>Careful research</h2><p>Evidence with a <strong>qualified conclusion</strong>.</p><p>Keep this legal paragraph.</p>" });
  await flushPromises();
  expect(f.wrapper.findComponent(AgentBodyReview).exists()).toBe(true);
  expect(f.wrapper.findComponent(AgentBodyReview).get('iframe[title="Proposed article after agent change"]').attributes("srcdoc")).toContain("qualified conclusion");
  expect(f.editor().getHTML()).toContain("Human unsaved text");
  await decision(f.wrapper, true); expect(await pending).toMatchObject({ accepted: true, saved: false, published: false });
  expect(f.editor().getHTML()).toContain("<strong><span data-lanza-origin=\"agent\" title=\"Agent-written text\">qualified conclusion</span></strong>");
  await vi.advanceTimersByTimeAsync(5_000); expect(f.client.saveEntry).not.toHaveBeenCalled();
  await f.wrapper.findAll("button").find(b => b.text() === "Save")!.trigger("click"); await flushPromises();
  expect(f.client.saveEntry).toHaveBeenCalledOnce();
  expect(f.client.saveEntry.mock.calls[0]![1]).toMatchObject({ title: "Research", draft: true });
  expect(f.client.saveEntry.mock.calls[0]![2]).toContain("Keep this legal paragraph");
  expect(f.client.saveEntry.mock.calls[0]![4]).toBe("original");
});
it("declines without changing content and refuses a parallel pending proposal", async () => {
  const f = open(); await flushPromises(); const context = await f.context();
  const args = { target: "body", expectedRevision: context.revision, html: "<p>Agent</p>" };
  const pending = tools.get("propose_editor_body_change")!.execute(args); await flushPromises();
  await expect(tools.get("propose_editor_body_change")!.execute(args)).rejects.toThrow("current body proposal");
  await decision(f.wrapper, false); expect(await pending).toMatchObject({ accepted: false, changed: false });
  expect(f.editor().getHTML()).toContain("Original article"); expect(f.client.saveEntry).not.toHaveBeenCalled();
});
it("selection changes since context was read invalidate the proposal before review", async () => {
  const f = open(); await flushPromises(); f.editor().commands.setTextSelection({ from: 1, to: 9 });
  const context = await f.context(); expect(context.body.selection?.text).toBe("Original");
  f.editor().commands.setTextSelection({ from: 10, to: 17 });
  await expect(tools.get("propose_editor_body_change")!.execute({ target: "selection", expectedRevision: context.revision, html: "New" })).rejects.toThrow("editor changed");
  expect(f.wrapper.findComponent(AgentBodyReview).exists()).toBe(false);
});
it.each(["typing", "selection", "access"])("rejects %s during pending body review", async change => {
  const f = open(); await flushPromises(); f.editor().commands.setTextSelection({ from: 1, to: 9 });
  const context = await f.context();
  const pending = tools.get("propose_editor_body_change")!.execute({ target: "selection", expectedRevision: context.revision, html: "New" });
  const refused = expect(pending).rejects.toThrow("changed"); await flushPromises();
  if (change === "typing") f.editor().commands.insertContent("Human");
  if (change === "selection") f.editor().commands.setTextSelection({ from: 2, to: 9 });
  if (change === "access") access.role = "viewer";
  await decision(f.wrapper, true); await refused;
  expect(f.editor().getHTML()).not.toContain("New");
});
it("disables Save while a body proposal awaits approval", async () => {
  const f = open(); await flushPromises(); const context = await f.context();
  const pending = tools.get("propose_editor_body_change")!.execute({ target: "body", expectedRevision: context.revision, html: "<p>New</p>" });
  await flushPromises(); const save = f.wrapper.findAll("button").find(button => button.text() === "Save")!;
  expect(save.attributes("disabled")).toBeDefined(); await save.trigger("click"); expect(f.client.saveEntry).not.toHaveBeenCalled();
  await decision(f.wrapper, false); expect(await pending).toMatchObject({ accepted: false });
});
it("unmount dismisses pending review without applying or leaving an unresolved promise", async () => {
  const f = open(); await flushPromises(); const context = await f.context();
  const pending = tools.get("propose_editor_body_change")!.execute({ target: "body", expectedRevision: context.revision, html: "<p>New</p>" });
  await flushPromises(); f.wrapper.unmount(); expect(await pending).toMatchObject({ accepted: false });
  expect(f.client.saveEntry).not.toHaveBeenCalled();
});
it("unsupported proposed markup preserves the live editor and never opens approval", async () => {
  const f = open(); await flushPromises(); const context = await f.context();
  await expect(tools.get("propose_editor_body_change")!.execute({ target: "body", expectedRevision: context.revision, html: '<p>New</p><video src="/clip.mp4"></video>' })).rejects.toThrow("cannot preserve");
  expect(f.editor().getHTML()).toContain("Original article"); expect(f.wrapper.findComponent(AgentBodyReview).exists()).toBe(false);
});
