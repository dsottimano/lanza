<script setup lang="ts">
// Settings → Publish. The CMS edits the `staging` branch (drafts, served at the
// Access-gated staging domain). Publishing merges staging → production (`main`),
// which triggers the public rebuild. This pane shows what's unpublished and runs
// the merge, surfacing conflicts instead of ever overwriting production.
import { ref, computed, onMounted } from "vue";
import { GitHubClient, GitHubError, PublishReviewError, type PublishReview } from "../backend/github";
import { versionState, securityUpdateRequired } from "../backend/version";
import { reportError, clearError } from "../errors";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const loading = ref(true);
const review = ref<PublishReview | null>(null);
const loadFailed = ref(false);
const problem = ref<string | null>(null);
const syncing = ref(false);
const diverged = computed(() => review.value?.diff.status === "diverged");
const publishing = ref(false);
const doneMsg = ref<string | null>(null);

// Files on staging not yet on production. `compare(main, staging)` returns them
// when staging is ahead; once merged the two match and this is empty.
const changes = computed(() => review.value?.diff.files ?? []);
const hasChanges = computed(() => changes.value.length > 0);

// Publishing while below the security floor would merge fine and then fail the
// BUILD (scripts/check-floor.mjs), so the site would stay on its old content with
// nothing in the CMS saying why - the failure would be a line in a Cloudflare build
// log nobody opens. Refuse here instead, where the person is standing and where the
// fix is one screen away.
const blocked = computed(() =>
  versionState.value ? securityUpdateRequired(versionState.value) : false,
);

async function refresh() {
  loading.value = true;
  loadFailed.value = false;
  review.value = null;
  try {
    review.value = await props.client.publishReview();
  } catch (e) {
    loadFailed.value = true;
    reportError(e, "Couldn't load unpublished changes.");
  } finally {
    loading.value = false;
  }
}

async function publish() {
  if (publishing.value || syncing.value || loading.value || !review.value || !hasChanges.value || blocked.value || diverged.value) return;
  publishing.value = true;
  doneMsg.value = null;
  problem.value = null;
  clearError();
  try {
    const { merged } = await props.client.publish(
      "lanza: publish staging → production", review.value,
    );
    doneMsg.value = merged
      ? "Published — the site is rebuilding."
      : "Nothing to publish — production is already up to date.";
    await refresh();
  } catch (e) {
    if (e instanceof GitHubError && e.status === 409) {
      problem.value = "Your drafts are safe. The live site and drafts contain conflicting edits. Ask your agent to reconcile both versions on staging, preserving your changes, then check again. Nothing was overwritten.";
    } else if (e instanceof PublishReviewError) {
      problem.value = e.message;
      await refresh();
    } else {
      reportError(e, "Publish failed.");
    }
  } finally {
    publishing.value = false;
  }
}

async function updateDrafts() {
  if (!review.value || syncing.value || publishing.value || loading.value) return;
  syncing.value = true;
  problem.value = null;
  try {
    await props.client.updateDrafts(review.value);
    doneMsg.value = "Drafts updated. Review the combined changes below before publishing.";
    await refresh();
  } catch (e) {
    if (e instanceof GitHubError && e.status === 409) {
      problem.value = "Your drafts are safe. Both versions changed the same content, so they need to be reconciled by your agent. Ask it to merge main into staging while preserving your edits, then check again. Nothing was overwritten.";
    } else if (e instanceof PublishReviewError) {
      problem.value = e.message;
      await refresh();
    } else reportError(e, "Couldn't update drafts.");
  } finally { syncing.value = false; }
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
        :disabled="publishing || syncing || loading || !hasChanges || blocked || diverged || loadFailed"
        @click="publish"
      >
        {{ publishing ? "Publishing…" : "Publish site" }}
      </button>
    </header>

    <main class="mx-auto max-w-2xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">Review &amp; publish</h1>
      <p class="mb-6 text-sm text-zinc-600">
        Review the saved changes below, then choose Publish site. This publishes the
        reviewed draft and starts rebuilding your public site.
      </p>

      <div v-if="blocked" class="mb-4 border-l-2 border-red-600 bg-red-50 px-4 py-3">
        <p class="text-sm leading-relaxed text-red-900">
          <strong class="font-semibold">Publishing is paused until this site is updated.</strong>
          It runs a version of the Lanza software that has been marked unsafe, and a
          build on that version is refused - so publishing now would leave the live site
          on its old content with no explanation. Go to <em>Software</em> and install the
          update, then publish.
        </p>
      </div>

      <p v-if="doneMsg" class="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {{ doneMsg }}
      </p>

      <div v-if="problem" role="alert" class="mb-4 border-l-2 border-amber-600 bg-amber-50 p-4">
        <h2 class="font-semibold">Publishing paused</h2>
        <p class="mt-2 text-sm">{{ problem }}</p>
        <button class="btn btn-ghost mt-3" :disabled="loading || publishing || syncing" @click="refresh">Check again</button>
      </div>
      <div v-if="diverged" class="mb-4 border-l-2 border-amber-600 bg-amber-50 p-4">
        <h2 class="font-semibold">The live site has newer changes</h2>
        <p class="mt-2 text-sm">Bring those changes into your drafts first. Your edits will be preserved. If the same content changed in both versions, we'll stop so it can be reconciled.</p>
        <button class="btn btn-secondary mt-3" :disabled="syncing || loading || publishing" @click="updateDrafts">{{ syncing ? 'Updating drafts…' : 'Update drafts' }}</button>
      </div>
      <div class="card p-6">
        <p v-if="loading" class="text-sm text-zinc-500">Checking for unpublished changes…</p>
        <div v-else-if="loadFailed">
          <p>Couldn’t check unpublished changes. Publishing is unavailable until this check succeeds.</p>
          <button class="btn btn-ghost mt-3" @click="refresh">Try again</button>
        </div>
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
