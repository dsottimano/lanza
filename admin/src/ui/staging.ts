import { ref } from "vue";
import type { GitHubClient } from "../backend/github";
import { REPO } from "../backend/config";

// App-wide "pending publish" signal: how many files sit on the staging branch that
// production (`main`) doesn't have yet — i.e. saved edits that are committed but NOT
// published. The editor chrome shows this so "Save" reads honestly (it commits to
// staging), separate from the unsaved-changes flag (see dirty.ts). Publishing merges
// staging → production and this drops back to zero (see PublishView).
//
// One shared count, refreshed lazily: on editor mount and after each save. `compare`
// is the same call PublishView makes.
export const pendingCount = ref<number | null>(null);

export async function refreshPending(client: GitHubClient): Promise<void> {
  try {
    const diff = await client.compare(REPO.productionBranch, REPO.branch);
    pendingCount.value = diff.files?.length ?? 0;
  } catch {
    // Non-fatal — the count is advisory chrome, never block the editor on it.
    pendingCount.value = null;
  }
}
