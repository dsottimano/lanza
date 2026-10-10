<script setup lang="ts">
import SettingsHeader from "./SettingsHeader.vue";
// Settings → Software. Which version of the site software this tenant runs, and
// the one-click move to another one. The whole update mechanism is the pinned
// version in the tenant's package.json (see backend/version.ts) — this pane reads
// it, compares against the npm registry, and writes a new pin.
//
// Updates are staged. The existing publish screen reviews the complete draft
// before changing production.
import { ref, computed, onMounted } from "vue";
import { GitHubClient } from "../backend/github";
import {
  loadVersionState,
  versionState,
  setPinnedVersion,
  updateAvailable,
  unpublishedSource,
  securityUpdateRequired,
  compareVersions,
  strandsOwner,
  isUnsafeVersion,
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
const loadFailed = ref(false);

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
  loadFailed.value = false;
  try {
    state.value = await loadVersionState(props.client);
    versionState.value = state.value;
  } catch (e) {
    loadFailed.value = true;
    state.value = null;
    reportError(e, "Couldn't check the software version.");
  } finally {
    loading.value = false;
  }
}

async function apply(version: string) {
  if (busy.value || loading.value || loadFailed.value || !state.value) return;
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
    doneMsg.value = `Version ${version} is saved to drafts. Review and publish to apply it to your site.`;
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
  <div class="settings-page">
    <SettingsHeader title="Software" @back="$emit('back')">
      <template #actions>
        <button
          v-if="hasUpdate && state?.registry"
          class="btn btn-primary"
          :disabled="!!busy || loading || loadFailed"
          @click="apply(state.registry.latest)"
        >
          {{ busy ? "Updating…" : `Stage ${state.registry.latest}` }}
        </button>
      </template>
      <template #description><p>
        Your site's code is a package your build installs. You choose when to move to a newer
        version — nothing changes underneath you.
      </p></template>
    </SettingsHeader>

    <main class="settings-body">
      <p v-if="doneMsg" class="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {{ doneMsg }}
      </p>

      <p v-if="loading" class="text-sm text-zinc-500">Checking your version…</p>

      <p v-else-if="loadFailed" role="alert" class="text-sm text-red-700">
        Couldn’t check the software version.
        <button class="btn btn-ghost" @click="refresh">Try again</button>
      </p>

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
        <a v-if="stagedOnly" href="#/publish" class="btn btn-primary mb-4">Review &amp; publish</a>
        <div class="card mb-4 p-6">
          <p class="text-sm text-zinc-600">{{ stagedOnly ? "Version selected for drafts" : "Published version" }}</p>
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
            can. Publishing stays blocked while the selected version is below the security floor.
          </p>
        </div>

        <div v-else-if="hasUpdate" class="card mb-4 p-6">
          <p class="mb-1 text-sm font-medium text-zinc-900">
            Version {{ state?.registry?.latest }} is available
          </p>
          <p class="text-sm text-zinc-600">
            Updating saves the version to drafts. Review all pending changes before publishing.
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
              <span v-if="r.version === current" class="text-xs text-zinc-500">selected</span>
              <!-- Never offer a version below the declared security floor. -->
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
                :disabled="!!busy || loading || loadFailed"
                @click="apply(r.version)"
              >
                {{
                  busy === r.version
                    ? "Switching…"
                    : compareVersions(r.version, current ?? "0.0.0") > 0
                      ? "Stage update"
                      : "Stage this version"
                }}
              </button>
            </li>
          </ul>
        </div>
      </template>
    </main>
  </div>
</template>
