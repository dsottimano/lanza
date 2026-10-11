import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import EditorView from "./EditorView.vue";
import Editor from "../editor/Editor.vue";
import AgentBodyReview from "./AgentBodyReview.vue";
import { access } from "../backend/access";
import { isDirty } from "./dirty";

import type { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
vi.mock("vue-router", async original => ({ ...await original<typeof import("vue-router")>(), useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {} }) }));
vi.mock("./staging", () => ({ refreshPending: vi.fn() }));
vi.mock("../errors", () => ({ reportError: vi.fn(), clearError: vi.fn() }));
const wrappers: VueWrapper[] = [];
let pluginSha: string;
let fetcher: ReturnType<typeof vi.fn>;
const respond = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear(); pluginSha = "a".repeat(40);
  Object.assign(access, { loaded: true, role: "owner", login: "fixture", repo: "fixture/site" });
  fetcher = vi.fn(async (_url, options) => {
    if(String(_url).includes('/plugins')) return respond(options?.method === "POST"
      ? {entryPath:"content/posts/en/article.md",html:"<ul><li>Magnitude: 7.7</li></ul>"}
      : {sha:pluginSha,state:{enabled:true,data:{manifest:{article:{contentPath:"content/posts/en/article.md"}}}}});
    return respond({requests:[],truncated:false});
  });
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
it("reviews research facts without saving, then accepts into the editor with autosave paused", async () => {
  const { wrapper, client, editor } = await fixture();
  editor.commands.setTextSelection(1);
  await button(wrapper,"Review research facts").trigger("click");await flushPromises();
  expect(wrapper.findComponent(AgentBodyReview).exists()).toBe(true);
  expect(editor.getHTML()).toBe("<p>Ground moves differently.</p>");
  await button(wrapper,"Accept in editor").trigger("click");await flushPromises();
  expect(editor.getHTML()).toContain("Magnitude: 7.7");expect(editor.getHTML()).toContain("Ground moves differently.");
  await vi.advanceTimersByTimeAsync(5000);expect(client.saveEntry).not.toHaveBeenCalled();
  await button(wrapper,"Save").trigger("click");await flushPromises();
  expect(client.saveEntry).toHaveBeenCalledWith("content/posts/en/article.md",expect.objectContaining({draft:true}),expect.stringContaining("Magnitude: 7.7"),expect.any(String),"original");
});
it("canceling a research proposal leaves the article and Git untouched",async()=>{
  const {wrapper,client,editor}=await fixture();await button(wrapper,"Review research facts").trigger("click");await flushPromises();
  await button(wrapper,"Cancel").trigger("click");await flushPromises();expect(editor.getHTML()).toBe("<p>Ground moves differently.</p>");expect(client.saveEntry).not.toHaveBeenCalled();
});
it("refuses research that changed during human review",async()=>{
  const {wrapper,client,editor}=await fixture();await button(wrapper,"Review research facts").trigger("click");await flushPromises();
  pluginSha="b".repeat(40);await button(wrapper,"Accept in editor").trigger("click");await flushPromises();
  expect(wrapper.text()).toContain("research changed");expect(editor.getHTML()).toBe("<p>Ground moves differently.</p>");expect(client.saveEntry).not.toHaveBeenCalled();
});
