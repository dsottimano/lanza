<script setup lang="ts">
// Settings → Publish. The CMS edits the `staging` branch (drafts, served at the
// Access-gated staging domain). Publishing merges staging → production (`main`),
// which triggers the public rebuild. This pane shows what's unpublished and runs
// the merge, surfacing conflicts instead of ever overwriting production.
import { ref, computed, onMounted } from "vue";
import { GitHubClient, GitHubError, type CompareResult } from "../backend/github";
import { REPO } from "../backend/config";
import { reportError, clearError } from "../errors";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const loading = ref(true);
const diff = ref<CompareResult | null>(null);
const publishing = ref(false);
const doneMsg = ref<string | null>(null);

// Files on staging not yet on production. `compare(main, staging)` returns them
// when staging is ahead; once merged the two match and this is empty.
const changes = computed(() => diff.value?.files ?? []);
const hasChanges = computed(() => changes.value.length > 0);

async function refresh() {
  loading.value = true;
  try {
    diff.value = await props.client.compare(REPO.productionBranch, REPO.branch);
  } catch (e) {
    reportError(e, "Couldn't load unpublished changes.");
  } finally {
    loading.value = false;
  }
}

async function publish() {
  if (publishing.value) return;
  publishing.value = true;
  doneMsg.value = null;
  clearError();
  try {
    const { merged } = await props.client.publish(
      "lanza: publish staging → production",
    );
    doneMsg.value = merged
      ? "Published — the site is rebuilding."
      : "Nothing to publish — production is already up to date.";
    await refresh();
  } catch (e) {
    if (e instanceof GitHubError && e.status === 409) {
      reportError(
        e,
        "Publish hit a merge conflict. Resolve it on GitHub, then try again.",
      );
    } else {
      reportError(e, "Publish failed.");
    }
  } finally {
    publishing.value = false;
  }
}

onMounted(refresh);

// added | modified | removed | renamed → a short verb + tone.
function statusLabel(s: string): string {
  return (
    { added: "added", modified: "changed", removed: "removed", renamed: "renamed" }[
      s
    ] ?? s
  );
}
</script>

<template>
  <div class="min-h-screen">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button class="text-sm text-zinc-600 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
      <span class="flex-1 text-center text-sm"></span>
      <button
        class="btn btn-primary"
        :disabled="publishing || loading || !hasChanges"
        @click="publish"
      >
        {{ publishing ? "Publishing…" : "Publish to production" }}
      </button>
    </header>

    <main class="mx-auto max-w-2xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">Publish</h1>
      <p class="mb-6 text-sm text-zinc-600">
        Your edits are saved to the <strong>staging</strong> branch and previewed on the staging
        domain. Publishing merges them into production and rebuilds the public site.
      </p>

      <p v-if="doneMsg" class="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {{ doneMsg }}
      </p>

      <div class="card p-6">
        <p v-if="loading" class="text-sm text-zinc-500">Checking for unpublished changes…</p>
        <template v-else-if="hasChanges">
          <p class="mb-3 text-sm font-medium text-zinc-900">
            {{ changes.length }} unpublished {{ changes.length === 1 ? "change" : "changes" }}
          </p>
          <ul class="flex flex-col gap-1.5">
            <li
              v-for="f in changes"
              :key="f.filename"
              class="flex items-center gap-2 text-sm text-zinc-700"
            >
              <span class="w-16 flex-shrink-0 text-xs uppercase tracking-wide text-zinc-400">{{ statusLabel(f.status) }}</span>
              <span class="truncate font-mono text-xs">{{ f.filename }}</span>
            </li>
          </ul>
        </template>
        <p v-else class="text-sm text-zinc-500">
          Nothing to publish — staging matches production.
        </p>
      </div>
    </main>
  </div>
</template>
