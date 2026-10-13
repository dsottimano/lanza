<script setup lang="ts">
import SettingsHeader from "./SettingsHeader.vue";
// Settings → People. Who can get into this site, and at what level.
//
// This screen used to BE the invite mechanism: a list of GitHub usernames kept in
// lanza.config.json, saved to staging, live only after a publish and a rebuild. It
// was removed, and the reason is worth keeping. That list was a second answer to a
// question GitHub already answers, and it was the weaker one — it could disagree
// with who can actually write the repository, and removing someone from it never
// took their access away.
//
// So access is granted where it is real: GitHub's own collaborator settings. The
// role here comes from `permissions` on this repo, re-read at most 60 seconds old,
// which is also how long a removal now takes to bite. This screen's job is to say
// that clearly and get out of the way.
import { computed } from "vue";
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

      <section class="mb-10">
        <h2 class="mb-1 text-sm font-semibold text-zinc-900"><span data-lanza-origin="agent">Delegated site administrators</span></h2>
        <p class="mb-3 max-w-prose text-sm text-zinc-600"><span data-lanza-origin="agent">
          The person managing this site's Cloudflare project can grant site administration
          to selected GitHub collaborators. Each person must retain write access to this
          repository. Delegation allows site settings, publishing, software updates and
          agent tools; it does not grant hosting access or permission to change delegation.
        </span></p>
        <ol class="list-decimal pl-5 space-y-2 text-sm text-zinc-600">
          <li><span data-lanza-origin="agent">In Cloudflare, open this Pages project's Settings → Variables and Secrets, for Production.</span></li>
          <li><span data-lanza-origin="agent">Add </span><code>LANZA_SITE_ADMINS</code><span data-lanza-origin="agent"> with the exact GitHub usernames, separated by commas (without @). For example: </span><code>alice,bob</code><span data-lanza-origin="agent">. Usernames are case-insensitive.</span></li>
          <li><span data-lanza-origin="agent">Redeploy the project, then refresh the CMS. To revoke delegation, remove the username and redeploy. Removing GitHub repository access takes effect within a minute.</span></li>
        </ol>
        <p class="mt-3 text-sm text-zinc-600"><span data-lanza-origin="agent">This setting is managed in Cloudflare. Saving or publishing website content does not change it. An optional OAuth Worker needs the same setting in its own deployment.</span></p>
      </section>

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
          Changes to the Cloudflare delegation setting require a new deployment.</span>
        </p>
      </aside>
    </main>
  </div>
</template>
