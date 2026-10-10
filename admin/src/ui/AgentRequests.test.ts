import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import Editor from "../editor/Editor.vue";
import AgentRequests from "./AgentRequests.vue";
import { captureRequestAnchor, requestInstructions, type SavedRequest } from "../backend/agent-requests";
const wrappers: VueWrapper[] = [];
let saved: SavedRequest;
let fetcher: ReturnType<typeof vi.fn>;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  fetcher = vi.fn(async (_url, options) => {
    if (options?.method === "POST") { const body = JSON.parse(options.body); return response({ task: { ...saved.task, ...body }, sha: "b".repeat(40) }, 201); }
    if (options?.method === "PATCH") return response({ ...saved, task: { ...saved.task, status: "resolved" } });
    return response({ requests: [], truncated: false, nextCursor: null });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function fixture(path = "content/posts/en/article.md") {
  const editorWrapper = mount(Editor, { props: { initialHtml: "<p>Ground moves differently.</p>" }, attachTo: document.body }); wrappers.push(editorWrapper); await flushPromises();
  const editor = editorWrapper.vm.editor!; editor.commands.setTextSelection({ from: 1, to: 7 });
  saved = { sha: "a".repeat(40), task: { version: 1, id: "00000000-0000-7000-8000-000000000001", entryPath: path,
    action: "verify", instruction: "Verify this", anchor: await captureRequestAnchor(editor), status: "open", createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", createdBy: "fixture" } };
  const reviewReplacement = vi.fn().mockResolvedValue(false);
  const wrapper = mount(AgentRequests, { props: { editor, path, enabled: true, locked: false, reviewReplacement }, attachTo: document.body }); wrappers.push(wrapper); await flushPromises();
  return { wrapper, editor, reviewReplacement };
}
function button(wrapper: VueWrapper, text: string) { return wrapper.findAll("button").find(node => node.text() === text)!; }
async function openDialog(wrapper: VueWrapper, action = "Verify") {
  await button(wrapper, action).trigger("pointerdown"); await button(wrapper, action).trigger("click");
  for (let n = 0; n < 4 && !wrapper.find("dialog").exists(); n++) await flushPromises();
}
it("preserves the highlighted text across toolbar and dialog focus; saves default verification without invoking an AI", async () => {
  const { wrapper, editor } = await fixture(); const original = editor.getHTML(); await openDialog(wrapper);
  expect(wrapper.find("dialog blockquote").text()).toBe("Ground");
  (wrapper.find("textarea").element as HTMLTextAreaElement).focus();
  editor.commands.setTextSelection({ from: 8, to: 13 });
  await button(wrapper, "Save request").trigger("click"); await flushPromises();
  const writes = fetcher.mock.calls.filter(([, options]) => options?.method === "POST"); expect(writes).toHaveLength(1);
  expect(writes[0]![0]).toBe("/admin/api/agent-requests");
  expect(JSON.parse(writes[0]![1].body)).toMatchObject({ entryPath: "content/posts/en/article.md", action: "verify", instruction: requestInstructions.verify, anchor: { quote: "Ground", from: 1, to: 7 } });
  expect(wrapper.text()).toContain("Ready for your connected agent"); expect(editor.getHTML()).toBe(original);
});
it("retries a lost response with identical ID and payload rather than creating another request", async () => {
  const { wrapper } = await fixture(); await openDialog(wrapper);
  await wrapper.find("textarea").setValue("Check this carefully");
  fetcher.mockRejectedValueOnce(new Error("Network interrupted"));
  await button(wrapper, "Save request").trigger("click"); await flushPromises(); expect(wrapper.find("dialog").text()).toContain("Network interrupted");
  await button(wrapper, "Save request").trigger("click"); await flushPromises();
  const writes = fetcher.mock.calls.filter(([, options]) => options?.method === "POST"); expect(writes).toHaveLength(2); expect(writes[0]![1].body).toBe(writes[1]![1].body);
});
it("escapes request and response HTML and resolves only after an accepted manual review", async () => {
  const { wrapper, reviewReplacement } = await fixture();
  saved.task.status = "answered"; saved.task.response = { message: '<img src=x onerror="alert(1)">', replacementHtml: '<script>alert(1)</script>', createdAt: saved.task.createdAt, createdBy: "fixture", origin: "assistant" };
  fetcher.mockResolvedValue(response({ requests: [saved], truncated: false }));
  await button(wrapper, "Requests").trigger("click"); await flushPromises();
  expect(wrapper.find(".request-panel img").exists()).toBe(false); expect(wrapper.find(".request-panel script").exists()).toBe(false);
  await button(wrapper, "Review & apply").trigger("click"); await flushPromises();
  expect(reviewReplacement).toHaveBeenCalledWith(saved.task.anchor, saved.task.response.replacementHtml);
  expect(fetcher.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
  reviewReplacement.mockResolvedValue(true);
  fetcher.mockImplementation(async (_url, options) => options?.method === "PATCH" ? response({ ...saved, task: { ...saved.task, status: "resolved" } }) : response({ requests: [saved], truncated: false }));
  await button(wrapper, "Review & apply").trigger("click"); await flushPromises();
  expect(JSON.parse(fetcher.mock.calls.find(([, options]) => options?.method === "PATCH")![1].body)).toMatchObject({ id: saved.task.id, expectedSha: saved.sha, status: "resolved" });
  expect(wrapper.text()).toContain("Applied in your editor");
});
it("surfaces stale response refusal without resolving or writing the article", async () => {
  const { wrapper, reviewReplacement, editor } = await fixture(); const original = editor.getHTML();
  saved.task.status = "answered"; saved.task.response = { message: "Suggestion", replacementHtml: "New", createdAt: saved.task.createdAt, createdBy: "fixture", origin: "assistant" };
  fetcher.mockResolvedValue(response({ requests: [saved], truncated: false })); await button(wrapper, "Requests").trigger("click"); await flushPromises();
  reviewReplacement.mockRejectedValue(new Error("This response refers to an older article."));
  await button(wrapper, "Review & apply").trigger("click"); await flushPromises();
  expect(wrapper.find('[role="alert"]').text()).toContain("older article"); expect(editor.getHTML()).toBe(original);
  expect(fetcher.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
});
it("polls at30seconds only while the request panel and document are visible", async () => {
  const { wrapper } = await fixture(); vi.useFakeTimers(); const initial = fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(initial);
  await button(wrapper, "Requests").trigger("click"); await flushPromises(); const opened = fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(29_999); expect(fetcher).toHaveBeenCalledTimes(opened);
  await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(opened + 1);
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(opened + 1);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); await flushPromises();
  await wrapper.find('[aria-label="Close requests"]').trigger("click"); const closed = fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(closed);
});
it("drops old entry context on navigation, cancels its dialog and prevents task submission while deleting", async () => {
  const { wrapper } = await fixture(); await openDialog(wrapper); expect(wrapper.find("dialog").exists()).toBe(true);
  await wrapper.setProps({ path: "content/posts/en/another.md" }); await flushPromises(); expect(wrapper.find("dialog").exists()).toBe(false);
  await wrapper.setProps({ locked: true }); expect(button(wrapper, "Verify").attributes("disabled")).toBeDefined();
  await button(wrapper, "Verify").trigger("click"); expect(wrapper.find("dialog").exists()).toBe(false);
});
it("reports private repository refusal instead of claiming a request was saved", async () => {
  const { wrapper } = await fixture(); await openDialog(wrapper);
  fetcher.mockResolvedValueOnce(response({ error: "Private repository required for agent requests." }, 403));
  await button(wrapper, "Save request").trigger("click"); await flushPromises();
  expect(wrapper.find("dialog").text()).toContain("Private repository required"); expect(wrapper.find("dialog").exists()).toBe(true);
});
