import { afterEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SettingsView from "./SettingsView.vue";
import SaveButton from "./SaveButton.vue";
import FieldForm from "../fields/FieldForm.vue";
import type { GitHubClient } from "../backend/github";
import type { FileEntry } from "../schema";
import { isDirty } from "./dirty";

vi.mock("../errors", () => ({ reportError: vi.fn(), clearError: vi.fn() }));
const file: FileEntry = { name: "seo_defaults", label: "SEO", file: "data/seo.json", fields: [{ name: "title", label: "Title", widget: "string" }] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(loadJson = vi.fn().mockResolvedValue({ data: { title: "Original" }, sha: "old" }), saveJson = vi.fn().mockResolvedValue("saved")) {
 const wrapper = mount(SettingsView, { props: { client: { loadJson, saveJson } as unknown as GitHubClient, file, locale: "en" }, global: { stubs: { FieldForm: true } } });
 return { wrapper, loadJson, saveJson, data: () => wrapper.findComponent(FieldForm).props("data"), save: () => wrapper.findComponent(SaveButton).props("action")() };
}
afterEach(() => { isDirty.value = false; vi.clearAllMocks(); });

it("blocks editing and saving after a failed read, then retries", async () => {
 const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: { title: "Recovered" }, sha: "recovered" });
 const f = fixture(load); await flushPromises();
 expect(f.wrapper.findComponent(FieldForm).exists()).toBe(false);
 expect(f.wrapper.findComponent(SaveButton).props("disabled")).toBe(true);
 await f.save(); expect(f.saveJson).not.toHaveBeenCalled();
 await f.wrapper.get('[role="alert"] button').trigger("click"); await flushPromises();
 expect(f.data().title).toBe("Recovered");
 await f.save(); expect(f.saveJson.mock.calls[0]![3]).toBe("recovered"); f.wrapper.unmount();
});

it("preserves edits made during saving and advances the SHA for the next save", async () => {
 const pending = deferred<string>(); const save = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue("latest");
 const f = fixture(undefined, save); await flushPromises();
 f.data().title = "First"; const saving = f.save();
 f.data().title = "Second";
 expect(save.mock.calls[0]![1]).toEqual({ title: "First" });
 pending.resolve("saved-first"); await saving;
 expect(isDirty.value).toBe(true);
 await f.save(); expect(save.mock.calls[1]![3]).toBe("saved-first");
 expect(save.mock.calls[1]![1]).toEqual({ title: "Second" }); expect(isDirty.value).toBe(false); f.wrapper.unmount();
});

it("ignores a superseded load and keeps the new file's SHA", async () => {
 const pending = deferred<{ data: { title: string }; sha: string }>();
 const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ data: { title: "New" }, sha: "new-sha" });
 const f = fixture(load); await f.wrapper.setProps({ file: { ...file, file: "data/new.json" } }); await flushPromises();
 pending.resolve({ data: { title: "Stale" }, sha: "stale-sha" }); await flushPromises();
 expect(f.data().title).toBe("New"); await f.save();
 expect(f.saveJson.mock.calls[0]![0]).toBe("data/new.json"); expect(f.saveJson.mock.calls[0]![3]).toBe("new-sha"); f.wrapper.unmount();
});

it("keeps edits dirty when saving fails", async () => {
 const f = fixture(undefined, vi.fn().mockRejectedValue(new Error("conflict"))); await flushPromises(); f.data().title = "Keep";
 await expect(f.save()).rejects.toThrow("conflict"); expect(isDirty.value).toBe(true); expect(f.data().title).toBe("Keep"); f.wrapper.unmount();
});

it("does not clear another editor's dirty flag after unmount", async () => {
 const pending = deferred<string>(); const f = fixture(undefined, vi.fn().mockReturnValue(pending.promise)); await flushPromises();
 const saving = f.save(); f.wrapper.unmount(); isDirty.value = true; pending.resolve("saved"); await saving; expect(isDirty.value).toBe(true);
});

it.each(["resolve", "reject"] as const)("SaveButton ignores a late %s after unmount", async (outcome) => {
 const pending = deferred<string>(); const w = mount(SaveButton, { props: { action: () => pending.promise } });
 await w.get("button").trigger("click"); w.unmount();
 if (outcome === "resolve") pending.resolve("saved"); else pending.reject(new Error("offline"));
 await flushPromises(); expect(w.emitted("saved")).toBeUndefined(); expect(w.emitted("error")).toBeUndefined();
});
