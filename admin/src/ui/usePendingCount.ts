import { onUnmounted, watch, type Ref } from "vue";
import type { GitHubClient } from "../backend/github";
import { REPO } from "../backend/config";
import { pendingCount, pendingCheckFailed, repositoryRevision } from "../backend/repository-state";

/** One branch comparison on boot, after writes, or on returning to the CMS.
 * No polling and no file-content reads. Publishing always takes its own snapshot. */
export function usePendingCount(client: GitHubClient, enabled: Ref<boolean>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let lastCheck = 0;
  let disposed = false;
  async function refresh() {
    if (!enabled.value || disposed) return;
    const current = generation;
    const revision = repositoryRevision.value;
    lastCheck = Date.now();
    try {
      const diff = await client.compare(REPO.productionBranch, REPO.branch);
      if (enabled.value && !disposed && current === generation && revision === repositoryRevision.value) {
        pendingCount.value = diff.files?.length ?? 0;
        pendingCheckFailed.value = false;
      }
    } catch {
      if (enabled.value && !disposed && current === generation && revision === repositoryRevision.value) {
        pendingCheckFailed.value = true;
      }
    }
  }
  function schedule() {
    generation++;
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  }
  function focus() {
    if (Date.now() - lastCheck > 30_000) schedule();
  }
  watch(enabled, () => {
    if (enabled.value) schedule();
    else {
      generation++;
      clearTimeout(timer);
      pendingCount.value = null;
      pendingCheckFailed.value = false;
    }
  }, { immediate: true });
  watch(repositoryRevision, schedule);
  window.addEventListener("focus", focus);
  onUnmounted(() => {
    disposed = true;
    clearTimeout(timer);
    window.removeEventListener("focus", focus);
  });
  return { retry: schedule };
}
