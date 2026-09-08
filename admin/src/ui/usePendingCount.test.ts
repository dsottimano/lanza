import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { usePendingCount } from "./usePendingCount";
import { pendingCount, pendingCheckFailed, repositoryRevision } from "../backend/repository-state";

beforeEach(() => {
  pendingCount.value = null;
  pendingCheckFailed.value = false;
});
afterEach(() => vi.useRealTimers());
it("coalesces writes, refreshes on return, and stops after unmount", async () => {
  vi.useFakeTimers();
  const compare = vi.fn().mockResolvedValue({ files: [{ filename: "page.md" }] });
  const wrapper = mount(defineComponent({ setup() {
    usePendingCount({ compare } as any, ref(true));
    return () => null;
  } }));
  await vi.advanceTimersByTimeAsync(300);
  expect(pendingCount.value).toBe(1);
  repositoryRevision.value++;
  repositoryRevision.value++;
  await flushPromises();
  compare.mockResolvedValue({ files: [] });
  await vi.advanceTimersByTimeAsync(300);
  expect(compare).toHaveBeenCalledTimes(2);
  expect(pendingCount.value).toBe(0);
  await vi.advanceTimersByTimeAsync(31_000);
  expect(compare).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(300);
  expect(compare).toHaveBeenCalledTimes(3);
  wrapper.unmount();
  repositoryRevision.value++;
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(compare).toHaveBeenCalledTimes(3);
});

it("retains known changes on failure and supports an explicit retry", async () => {
  vi.useFakeTimers();
  const compare = vi.fn().mockRejectedValue(new Error("offline"));
  pendingCount.value = 2;
  let retry!: () => void;
  const wrapper = mount(defineComponent({ setup() {
    ({ retry } = usePendingCount({ compare } as any, ref(true)));
    return () => null;
  } }));
  await vi.advanceTimersByTimeAsync(300);
  expect(pendingCount.value).toBe(2);
  expect(pendingCheckFailed.value).toBe(true);
  compare.mockResolvedValue({ files: [] });
  retry();
  await vi.advanceTimersByTimeAsync(300);
  expect(pendingCount.value).toBe(0);
  expect(pendingCheckFailed.value).toBe(false);
  wrapper.unmount();
});

it("ignores stale failures after a new write and results after access is removed", async () => {
  vi.useFakeTimers();
  let rejectOld!: (reason: Error) => void;
  let resolveNew!: (value: unknown) => void;
  const compare = vi.fn()
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
  const enabled = ref(true);
  const wrapper = mount(defineComponent({ setup() {
    usePendingCount({ compare } as any, enabled);
    return () => null;
  } }));
  await vi.advanceTimersByTimeAsync(300);
  repositoryRevision.value++;
  await flushPromises();
  rejectOld(new Error("stale failure"));
  await flushPromises();
  expect(pendingCheckFailed.value).toBe(false);
  await vi.advanceTimersByTimeAsync(300);
  enabled.value = false;
  await flushPromises();
  resolveNew({ files: [{ filename: "old.md" }] });
  await flushPromises();
  expect(pendingCount.value).toBeNull();
  expect(pendingCheckFailed.value).toBe(false);
  wrapper.unmount();
});
