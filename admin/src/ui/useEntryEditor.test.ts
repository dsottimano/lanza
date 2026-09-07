import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { useEntryEditor, type EntryEditorHooks } from "./useEntryEditor";
import { GitHubError, type GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
import { isDirty } from "./dirty";

const PATH = "content/posts/en/story.md";
const collection: FolderCollection = { kind: "folder", name: "posts", label: "Posts", labelSingular: "Post",
  folder: "content/posts", localized: true, body: "rich", fields: [{ name: "draft", label: "Draft", widget: "boolean", default: true }] };
const wrappers: VueWrapper[] = [];
function setup(options: { path?: string | null; client?: Partial<GitHubClient>; hooks?: Partial<EntryEditorHooks> } = {}) {
  const client = {
    loadEntry: vi.fn().mockResolvedValue({ path: PATH, sha: "base", data: { title: "Story", tags: ["one"], image: "/old.jpg" }, body: "<p>Original</p>" }),
    saveEntry: vi.fn().mockResolvedValue("saved"), deleteFile: vi.fn().mockResolvedValue(undefined), ...options.client,
  };
  const body = ref("");
  const slug = ref("");
  let state!: ReturnType<typeof useEntryEditor>;
  const wrapper = mount(defineComponent({ setup() {
    state = useEntryEditor({ client: client as never, collection, locale: "en", path: options.path === undefined ? PATH : options.path }, {
      autosave: true, onLoaded: value => { body.value = value; }, getBody: () => body.value, getSlug: () => slug.value,
      restore: (value, stem) => { body.value = value; slug.value = stem; }, ...options.hooks,
    });
    return () => h("div");
  } }));
  wrappers.push(wrapper);
  return { client, body, slug, state, wrapper };
}

beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); });
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.useRealTimers(); });

 describe("entry autosave", () => {
  it("does not save on load, then saves model-only list and image changes after a pause", async () => {
    const { state, client } = setup();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.saveEntry).not.toHaveBeenCalled();
    (state.data.tags as string[]).push("two");
    state.data.image = "";
    expect(state.dirty.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(client.saveEntry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.saveEntry).toHaveBeenCalledWith(PATH, expect.objectContaining({ tags: ["one", "two"], image: "" }), expect.any(String), expect.any(String), "base");
    expect(state.dirty.value).toBe(false);
  });

  it("serializes saves and keeps typing during a save dirty until the next snapshot is stored", async () => {
    let finish!: (sha: string) => void;
    const saveEntry = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; })).mockResolvedValue("second");
    const { state, body } = setup({ client: { saveEntry } });
    await flushPromises();
    body.value = "<p>First</p>"; state.markDirty();
    const first = state.save();
    expect(state.save()).toBe(first);
    body.value = "<p>Still writing</p>"; state.markDirty();
    finish("first"); await first;
    expect(state.dirty.value).toBe(true);
    expect(saveEntry.mock.calls[0][2]).toContain("First");
    await vi.advanceTimersByTimeAsync(2000);
    expect(saveEntry.mock.calls[1][2]).toContain("Still writing");
    expect(saveEntry.mock.calls[1][4]).toBe("first");
    expect(state.dirty.value).toBe(false);
  });

  it("pauses on a conflict without retrying or overwriting the stored version", async () => {
    const saveEntry = vi.fn().mockRejectedValue(new GitHubError(409, "Conflict"));
    const { state } = setup({ client: { saveEntry } });
    await flushPromises(); state.data.title = "Human edit";
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.saveError.value).toContain("changed elsewhere");
    state.data.title = "More human editing";
    await vi.advanceTimersByTimeAsync(10000);
    expect(saveEntry).toHaveBeenCalledTimes(1);
    expect(state.dirty.value).toBe(true);
    expect(state.localCopy.value).toBe(true);
  });

  it("never saves a failed load", async () => {
    const { state, client } = setup({ client: { loadEntry: vi.fn().mockRejectedValue(new Error("offline")) } });
    await flushPromises(); state.data.title = "New title";
    await expect(state.save()).rejects.toThrow("load successfully");
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.saveEntry).not.toHaveBeenCalled();
  });

  it("does not autosave an untitled new entry", async () => {
    const { state, client } = setup({ path: null });
    await flushPromises(); state.markDirty();
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.saveEntry).not.toHaveBeenCalled();
    state.data.title = "New story";
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.saveEntry).toHaveBeenCalledWith("content/posts/en/new-story.md", expect.objectContaining({ draft: true }), expect.any(String), expect.any(String), undefined);
  });

  it("preserves the original base when recovering after another author changes the entry", async () => {
    const first = setup(); await flushPromises();
    first.body.value = "<p>Unfinished human writing</p>"; first.state.markDirty();
    first.wrapper.unmount();
    const second = setup({ client: { loadEntry: vi.fn().mockResolvedValue({ path: PATH, sha: "agent", data: { title: "Agent title" }, body: "<p>Agent version</p>" }) } });
    await flushPromises();
    expect(second.state.recovery.value).not.toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(second.client.saveEntry).not.toHaveBeenCalled();
    second.state.restoreRecovery();
    expect(second.body.value).toContain("Unfinished human writing");
    await vi.advanceTimersByTimeAsync(3000);
    expect(second.client.saveEntry).not.toHaveBeenCalled();
    await second.state.save();
    expect(vi.mocked(second.client.saveEntry).mock.calls[0][4]).toBe("base");
  });

  it("keeps a review revert local until explicitly saved", async () => {
    const { state, client } = setup(); await flushPromises();
    state.pauseAutosave("Review this revert"); state.data.title = "Live title";
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.saveEntry).not.toHaveBeenCalled();
    await state.save(); expect(state.pauseReason.value).toBe("");
  });

  it("does not let an old save clear another editor's dirty flag", async () => {
    let finish!: (sha: string) => void;
    const first = setup({ client: { saveEntry: vi.fn().mockImplementation(() => new Promise<string>(resolve => { finish = resolve; })) } });
    await flushPromises(); first.state.data.title = "First editor";
    const pending = first.state.save(); first.wrapper.unmount();
    const second = setup(); await flushPromises(); second.state.data.title = "Second editor";
    finish("written"); await pending;
    expect(isDirty.value).toBe(true);
  });

  it("requires an explicit save to rename an existing URL", async () => {
    const { state, slug, client } = setup(); await flushPromises();
    slug.value = "new-url"; state.markDirty();
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.saveEntry).not.toHaveBeenCalled();
    expect(state.pauseReason.value).toContain("URL");
    await state.save();
    expect(client.deleteFile).toHaveBeenCalledWith(PATH, "base", expect.any(String));
  });
  it("keeps a revert local even if an older autosave finishes afterwards", async () => {
    let finish!: (sha: string) => void;
    const saveEntry = vi.fn().mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    const { state } = setup({ client: { saveEntry } }); await flushPromises();
    state.data.title = "Writing";
    const pending = state.save();
    state.pauseAutosave("Review revert"); state.data.title = "Reverted";
    finish("stored"); await pending;
    await vi.advanceTimersByTimeAsync(5000);
    expect(saveEntry).toHaveBeenCalledTimes(1);
    expect(state.pauseReason.value).toBe("Review revert");
    expect(state.dirty.value).toBe(true);
  });

  it("retries the unfinished deletion after a partial rename", async () => {
    const deleteFile = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const { state, slug, client } = setup({ client: { deleteFile } }); await flushPromises();
    slug.value = "renamed"; state.markDirty();
    await expect(state.save()).rejects.toThrow("old page could not be removed");
    expect(state.dirty.value).toBe(true);
    await state.save();
    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.saveEntry).mock.calls[1][4]).toBe("saved");
  });

});
