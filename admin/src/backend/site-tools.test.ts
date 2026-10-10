import { afterEach, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { browserModelContext, registerSiteTools, type ModelContext, type SiteTool } from "./site-tools";

const tool = (execute = vi.fn().mockResolvedValue({ safe: true })): SiteTool => ({ name: "test_tool", description: "Read", inputSchema: {}, execute });
afterEach(() => { delete (document as Document & { modelContext?: ModelContext }).modelContext; });

it("leaves unsupported browsers alone", () => {
  expect(browserModelContext()).toBeUndefined();
  expect(() => registerSiteTools([tool()])()).not.toThrow();
});

it("registers in the top-level document, rejects stale handles and removes tools on disposal", async () => {
  const context = { registerTool: vi.fn(), unregisterTool: vi.fn() };
  (document as Document & { modelContext?: ModelContext }).modelContext = context;
  const descriptor = tool(); const remove = registerSiteTools([descriptor]); await flushPromises();
  const registered = context.registerTool.mock.calls[0]![0] as SiteTool;
  expect(await registered.execute({})).toEqual({ safe: true });
  remove();
  await expect(registered.execute({})).rejects.toThrow("no longer open");
  await flushPromises(); expect(context.unregisterTool).toHaveBeenCalledWith("test_tool");
});

it("does not let a late old screen registration delete the new screen's tools", async () => {
  let finish!: () => void;
  const descriptors = new Map<string, SiteTool>();
  const context: ModelContext = { registerTool: vi.fn().mockImplementationOnce((item: SiteTool) => {
    descriptors.set(item.name, item); return new Promise<void>(resolve => { finish = resolve; });
  }).mockImplementation((item: SiteTool) => { descriptors.set(item.name, item); }),
  unregisterTool: vi.fn().mockImplementation((name: string) => descriptors.delete(name)) };
  const oldRemove = registerSiteTools([tool(vi.fn().mockResolvedValue("old"))], context);
  await flushPromises(); oldRemove();
  const newRemove = registerSiteTools([tool(vi.fn().mockResolvedValue("new"))], context);
  finish(); await flushPromises();
  expect(await descriptors.get("test_tool")!.execute({})).toBe("new");
  oldRemove(); await flushPromises();
  expect(await descriptors.get("test_tool")!.execute({})).toBe("new");
  newRemove(); await flushPromises(); expect(descriptors.size).toBe(0);
});

it("handles unavailable registration without breaking the caller or later screens", async () => {
  const context: ModelContext = { registerTool: vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined), unregisterTool: vi.fn() };
  const remove = registerSiteTools([tool()], context); await flushPromises(); remove();
  const next = registerSiteTools([tool()], context); await flushPromises();
  expect(context.registerTool).toHaveBeenCalledTimes(2); next(); await flushPromises();
});
