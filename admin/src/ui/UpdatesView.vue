<script setup lang="ts">
// Settings → Software. Which version of the site software this tenant runs, and
// the one-click move to another one. The whole update mechanism is the pinned
// version in the tenant's package.json (see backend/version.ts) — this pane reads
// it, compares against the npm registry, and writes a new pin.
//
// Applying stages the bump like any other edit and then publishes, because it's
// the merge into production that makes Cloudflare rebuild onto the new code. Any
// other unpublished work rides along, so that is stated before the click, not after.
import { ref, computed, onMounted } from "vue";
import { GitHubClient } from "../backend/github";
import { REPO } from "../backend/config";
import {
  loadVersionState,
  setPinnedVersion,
  updateAvailable,
  unpublishedSource,
  securityUpdateRequired,
  compareVersions,
  strandsOwner,
  isUnsafeVersion,
  loadForcedUpdate,
  type VersionState,
} from "../backend/version";
import { reportError, clearError } from "../errors";
import { refreshPending } from "./staging";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const loading = ref(true);
const busy = ref<string | null>(null); // version currently being applied
const doneMsg = ref<string | null>(null);
const state = ref<VersionState | null>(null);
const otherPending = ref(0);
const forced = ref<{ version: string; date: string | null } | null>(null);

const current = computed(() => state.value?.staged ?? state.value?.live ?? null);
// This repo IS lanza-site (the release source), so it follows no pin. Not the same
// as unmanaged, and it must be checked FIRST — a source repo has no pin either.
const source = computed(() => state.value?.source ?? null);
const sourceAhead = computed(() => (state.value ? unpublishedSource(state.value) : false));
const hasUpdate = computed(() => (state.value ? updateAvailable(state.value) : false));
const insecure = computed(() => (state.value ? securityUpdateRequired(state.value) : false));
// A pin on staging that production hasn't got yet: chosen but not yet live.
const stagedOnly = computed(
  () => !!state.value?.staged && !!state.value?.live && state.value.staged !== state.value.live,
);

async function refresh() {
  loading.value = true;
  try {
    state.value = await loadVersionState(props.client);
    forced.value = await loadForcedUpdate(props.client, state.value.live);
    const diff = await props.client.compare(REPO.productionBranch, REPO.branch);
    otherPending.value = (diff.files ?? []).filter((f) => f.filename !== "package.json").length;
  } catch (e) {
    reportError(e, "Couldn't check the software version.");
  } finally {
    loading.value = false;
  }
}

async function apply(version: string) {
  if (busy.value) return;
  // Belt and braces: the button for an unsafe version isn't rendered, so reaching
  // here means something else called it. Refuse rather than write a known-bad pin.
  if (state.value && isUnsafeVersion(version, state.value)) return;
  // Going back far enough removes this screen, and with it the way to come back.
  // Say so plainly before doing it, not after.
  if (
    strandsOwner(version) &&
    !confirm(
      `Version ${version} doesn't include this Software screen.\n\n` +
        `If you switch to it, coming back means editing package.json in your ` +
        `GitHub repository by hand. Continue?`,
    )
  ) {
    return;
  }
  busy.value = version;
  doneMsg.value = null;
  clearError();
  try {
    await setPinnedVersion(props.client, version);
    await props.client.publish(`lanza: update to ${version}`);
    doneMsg.value = `Now on ${version}. Cloudflare is rebuilding your site — it goes live in a minute or two.`;
    await refresh();
    await refreshPending(props.client);
  } catch (e) {
    reportError(e, `Couldn't switch to ${version}.`);
  } finally {
    busy.value = null;
  }
}

function when(date: string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

onMounted(refresh);
</script>

<template>
  <div class="min-h-screen">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button class="text-sm text-zinc-600 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
      <span class="flex-1 text-center text-sm"></span>
      <button
        v-if="hasUpdate && state?.registry"
        class="btn btn-primary"
        :disabled="!!busy"
        @click="apply(state.registry.latest)"
      >
        {{ busy ? "Updating…" : `Update to ${state.registry.latest}` }}
      </button>
    </header>

    <main class="mx-auto max-w-2xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">Software</h1>
      <p class="mb-6 text-sm text-zinc-600">
        Your site's code is a package your build installs. You choose when to move to a newer
        version — nothing changes underneath you.
      </p>

      <p v-if="doneMsg" class="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {{ doneMsg }}
      </p>

      <!-- A change the owner didn't make needs explaining, or their site silently
           differs from what they chose. -->
      <div v-if="forced" class="card mb-4 border-red-200 bg-red-50 p-6">
        <p class="mb-1 text-sm font-medium text-red-900">
          We updated your site to {{ forced.version }}{{ forced.date ? ` on ${when(forced.date)}` : "" }}
        </p>
        <p class="text-sm text-red-800">
          The version you were running was found to be unsafe, so it was replaced for you —
          this is the only kind of change we make without asking. Your content was not
          touched, and you can still move to a newer version whenever you like.
        </p>
      </div>

      <p v-if="loading" class="text-sm text-zinc-500">Checking your version…</p>

      <!-- This repo IS lanza-site. Checked before `unmanaged`, which it would
           otherwise match: a source repo holds no pin either. -->
      <div v-else-if="source" class="card p-6">
        <p class="text-sm text-zinc-600">This site runs its own source</p>
        <p class="font-mono text-2xl text-zinc-900">{{ source }}</p>
        <p class="mt-3 text-sm text-zinc-600">
          This repository <strong>is</strong> Lanza — releases are published from here, so there is
          no version to move to. Every other site updates by pinning a release of it.
        </p>

        <p v-if="state?.offline" class="mt-3 text-sm text-zinc-500">
          Couldn't reach the package registry, so the published version can't be checked right now.
        </p>
        <p v-else-if="sourceAhead" class="mt-3 text-sm text-amber-700">
          Newest published release is
          <span class="font-mono">{{ state?.registry?.latest }}</span
          >, so this source is ahead of every site that pins one. Publishing a release is what
          carries these changes to them.
        </p>
        <p v-else-if="state?.registry?.latest" class="mt-3 text-sm text-zinc-500">
          Newest published release is
          <span class="font-mono">{{ state?.registry?.latest }}</span
          >.
        </p>
      </div>

      <!-- A repo generated before the package split: no dependency to bump. -->
      <div v-else-if="state?.unmanaged" class="card p-6">
        <p class="mb-2 text-sm font-medium text-zinc-900">Updates aren't available for this site</p>
        <p class="text-sm text-zinc-600">
          It was created before Lanza shipped its code as a package, so it holds its own copy and
          can't be updated from here. Newer sites track a version and update in one click.
        </p>
      </div>

      <template v-else>
        <div class="card mb-4 p-6">
          <p class="text-sm text-zinc-600">This site runs</p>
          <p class="font-mono text-2xl text-zinc-900">{{ current ?? "unknown" }}</p>

          <p v-if="stagedOnly" class="mt-3 text-sm text-amber-700">
            Version {{ state?.staged }} is chosen but not published yet — your live site is still
            on {{ state?.live }}.
          </p>

          <p v-if="state?.offline" class="mt-3 text-sm text-zinc-500">
            Couldn't reach the package registry, so newer versions can't be checked right now.
          </p>
          <p v-else-if="!hasUpdate" class="mt-3 text-sm text-emerald-700">
            This is the latest version.
          </p>
        </div>

        <div v-if="insecure" class="card mb-4 border-red-200 bg-red-50 p-6">
          <p class="mb-1 text-sm font-medium text-red-900">A security update is available</p>
          <p class="text-sm text-red-800">
            Your version is older than the oldest one still considered safe. Update as soon as you
            can — this is the one case where we may update your site for you.
          </p>
        </div>

        <div v-else-if="hasUpdate" class="card mb-4 p-6">
          <p class="mb-1 text-sm font-medium text-zinc-900">
            Version {{ state?.registry?.latest }} is available
          </p>
          <p class="text-sm text-zinc-600">
            Updating publishes your site, so
            <template v-if="otherPending">
              your {{ otherPending }} other unpublished
              {{ otherPending === 1 ? "change goes" : "changes go" }} live too.
            </template>
            <template v-else>your site rebuilds on the new code.</template>
          </p>
        </div>

        <div v-if="state?.registry?.releases.length" class="card p-6">
          <p class="mb-3 text-sm font-medium text-zinc-900">All versions</p>
          <ul class="flex flex-col gap-1">
            <li
              v-for="r in state.registry.releases"
              :key="r.version"
              class="flex items-center gap-3 border-b border-[var(--border)] py-2 text-sm last:border-0"
            >
              <span class="w-20 flex-shrink-0 font-mono text-xs text-zinc-900">{{ r.version }}</span>
              <span class="flex-1 text-xs text-zinc-500">{{ when(r.date) }}</span>
              <span v-if="r.version === current" class="text-xs text-zinc-500">in use</span>
              <!-- Below the safe floor: no button at all. Offering "go back" to a
                   version we just force-updated someone off would undo the rescue. -->
              <span
                v-else-if="state && isUnsafeVersion(r.version, state)"
                class="text-xs text-red-700"
                title="This version was marked unsafe and can't be selected."
              >
                unsafe
              </span>
              <button
                v-else
                class="btn btn-ghost text-xs"
                :disabled="!!busy"
                @click="apply(r.version)"
              >
                {{
                  busy === r.version
                    ? "Switching…"
                    : compareVersions(r.version, current ?? "0.0.0") > 0
                      ? "Update"
                      : "Go back to this"
                }}
              </button>
            </li>
          </ul>
        </div>
      </template>
    </main>
  </div>
</template>
