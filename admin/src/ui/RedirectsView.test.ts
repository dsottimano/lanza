import { afterEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RedirectsView from "./RedirectsView.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubError, type GitHubClient } from "../backend/github";
import { isDirty } from "./dirty";
vi.mock("../errors", () => ({ reportError: vi.fn(), clearError: vi.fn() }));
vi.mock("../backend/cloudflare", () => ({ CloudflareClient: class { listDeployments() { return Promise.resolve([]); } }, NotConfiguredError: class extends Error {} }));
const original = { redirects: [{ from: "/old", to: "/new", status: 301 }], futureSetting: "keep" };
function fixture(loadJson = vi.fn().mockResolvedValue({ data: original, sha: "old" }), saveJson = vi.fn().mockResolvedValue("new")) {
 const w = mount(RedirectsView, { props: { client: { loadJson, saveJson } as unknown as GitHubClient } });
 return { w, saveJson, save: () => w.findComponent(SaveButton).props("action")() };
}
afterEach(() => { isDirty.value = false; vi.clearAllMocks(); });
it.each([new Error("offline"), null, { redirects: "broken" }])("blocks failed or malformed reads and supports retry", async failure => {
 const load = vi.fn();
 if (failure instanceof Error) load.mockRejectedValueOnce(failure); else load.mockResolvedValueOnce({ data: failure, sha: "bad" });
 load.mockResolvedValue({ data: original, sha: "recovered" });
 const f = fixture(load); await flushPromises();
 expect(f.w.find("table").exists()).toBe(false); expect(f.w.findComponent(SaveButton).props("disabled")).toBe(true);
 await f.save(); expect(f.saveJson).not.toHaveBeenCalled();
 await f.w.get('[role="alert"] button').trigger("click"); await flushPromises();
 expect(f.w.find("table").exists()).toBe(true); await f.save();
 expect(f.saveJson.mock.calls[0]![3]).toBe("recovered"); f.w.unmount();
});
it("allows a genuinely missing file to be created", async () => {
 const f = fixture(vi.fn().mockRejectedValue(new GitHubError(404, "Not Found"))); await flushPromises();
 expect(f.w.find("table").exists()).toBe(true); await f.save();
 expect(f.saveJson.mock.calls[0]![1]).toEqual({ redirects: [] }); expect(f.saveJson.mock.calls[0]![3]).toBeUndefined(); f.w.unmount();
});
it("retains edits made during saving, advances SHA and preserves unrelated settings", async () => {
 let finish!: (sha: string) => void;
 const save = vi.fn().mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; })).mockResolvedValue("latest");
 const f = fixture(undefined, save); await flushPromises();
 await f.w.get('input[placeholder="/old-path"]').setValue("/first");
 const saving = f.save(); await f.w.get('input[placeholder="/old-path"]').setValue("/second");
 expect(save.mock.calls[0]![1]).toEqual({ ...original, redirects: [{from:"/first",to:"/new",status:301}] });
 finish("first-sha"); await saving; expect(isDirty.value).toBe(true);
 expect(f.w.text()).toContain("Save to staging"); expect(f.w.text()).not.toContain("Save to publish");
 await f.save(); expect(save.mock.calls[1]![3]).toBe("first-sha"); expect(isDirty.value).toBe(false); f.w.unmount();
});
it("preserves the new editor's dirty state when a save completes after unmount", async () => {
 let finish!: (sha: string) => void;
 const f = fixture(undefined, vi.fn().mockReturnValue(new Promise<string>(resolve => { finish = resolve; }))); await flushPromises();
 const saving = f.save(); f.w.unmount(); isDirty.value = true; finish("saved"); await saving; expect(isDirty.value).toBe(true);
});
