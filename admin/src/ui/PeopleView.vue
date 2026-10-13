<script setup lang="ts">
import SettingsHeader from "./SettingsHeader.vue";
import { computed } from "vue";
import CoAdmins from "./CoAdmins.vue";
import { access } from "../backend/access";

defineEmits<{ (e: "back"): void }>();

const collaboratorsUrl = computed(() =>
  access.repo ? `https://github.com/${access.repo}/settings/access` : null,
);

const roleLabel = computed(() => {
  if (access.role === "owner" && access.delegated) return "Site administrator";
  if (access.role === "owner") return "Owner";
  if (access.role === "editor") return "Editor";
  if (access.role === "viewer") return "Viewer";
  return "Unknown";
});
</script>

<template>
  <div class="settings-page">
    <SettingsHeader title="People" @back="$emit('back')">
      <template #description><p>
        Everyone signs in with their own GitHub account. There are no passwords to share
        and nothing to send them: add them as a collaborator on the repository, and they
        can sign in at this site's
        <code class="rounded bg-zinc-100 px-1 py-0.5 text-[0.8em]">/admin</code> straight away.
      </p></template>
    </SettingsHeader>

    <main class="settings-body">
      <section class="mb-10">
        <h2 class="mb-1 text-sm font-semibold text-zinc-900">You</h2>
        <div class="card flex items-center justify-between gap-3 px-4 py-3">
          <span class="text-sm font-medium text-zinc-900">{{ access.login ?? "Not signed in" }}</span>
          <span class="text-xs text-zinc-500">{{ roleLabel }}</span>
        </div>
      </section>

      <section class="mb-10">
        <h2 class="mb-1 text-sm font-semibold text-zinc-900">Adding someone</h2>
        <p class="mb-3 max-w-prose text-sm text-zinc-600">
          <span data-lanza-origin="agent">GitHub write access allows content editing. GitHub
          repository admins can publish and change settings. On a personal repository,
          collaborators need explicit delegation to administer the site.</span>
        </p>
        <a
          v-if="collaboratorsUrl"
          class="btn btn-primary inline-flex px-4"
          :href="collaboratorsUrl"
          target="_blank"
          rel="noopener"
        >
          Manage collaborators on GitHub
        </a>
        <p v-else class="text-sm text-zinc-500">
          Sign in to see the link to this site's collaborator settings.
        </p>
      </section>

      <CoAdmins v-if="access.role === 'owner' && !access.delegated" />
      <p v-else class="mb-10 text-sm text-zinc-600" data-lanza-origin="agent">Only the GitHub repository owner or an administrator can add or remove co-admins. Co-admin access does not grant hosting access.</p>

      <section>
        <h2 class="mb-1 text-sm font-semibold text-zinc-900">What each level can do</h2>
        <ul class="card divide-y divide-[var(--border)]">
          <li class="px-4 py-3">
            <p class="text-sm font-medium text-zinc-900">Admin on GitHub, owner here</p>
            <p class="text-sm text-zinc-600">
              Everything: write, publish, change settings and hosting.
            </p>
          </li>
          <li class="px-4 py-3">
            <p class="text-sm font-medium text-zinc-900"><span data-lanza-origin="agent">Delegated site administrator</span></p>
            <p class="text-sm text-zinc-600"><span data-lanza-origin="agent">Write, publish, change site settings, update software and connect agents. Hosting and delegation remain with the site operator.</span></p>
          </li>
          <li class="px-4 py-3">
            <p class="text-sm font-medium text-zinc-900">Write on GitHub, editor here</p>
            <p class="text-sm text-zinc-600">
              Content and images, on the working branch. Cannot publish or change settings.
            </p>
          </li>
          <li class="px-4 py-3">
            <p class="text-sm font-medium text-zinc-900">Read on GitHub, viewer here</p>
            <p class="text-sm text-zinc-600">
              Can look, changes nothing. Only possible on an organisation-owned repository.
            </p>
          </li>
        </ul>
      </section>

      <aside class="mt-10 border-l-2 border-emerald-600 bg-emerald-50 px-4 py-3">
        <p class="text-sm leading-relaxed text-emerald-950">
          <span data-lanza-origin="agent"><strong class="font-semibold">GitHub access changes take effect within a minute.</strong>
          Co-admin changes take effect after the deployment succeeds.</span>
        </p>
      </aside>
    </main>
  </div>
</template>
