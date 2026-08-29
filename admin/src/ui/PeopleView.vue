<script setup lang="ts">
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
  if (access.role === "owner") return "Owner";
  if (access.role === "editor") return "Editor";
  if (access.role === "viewer") return "Viewer";
  return "Unknown";
});
</script>

<template>
  <div class="min-h-screen">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button class="text-sm text-zinc-600 transition hover:text-zinc-900" @click="$emit('back')">← Back</button>
      <span class="flex-1 text-center text-sm"></span>
      <span class="min-w-[6.5rem]"></span>
    </header>

    <main class="mx-auto max-w-3xl px-6 pt-8 pb-24">
      <h1 class="mb-2 font-serif text-3xl font-bold tracking-tight text-zinc-900">People</h1>
      <p class="mb-8 max-w-prose text-sm leading-relaxed text-zinc-600">
        Everyone signs in with their own GitHub account. There are no passwords to share
        and nothing to send them: add them as a collaborator on the repository, and they
        can sign in at this site's
        <code class="rounded bg-zinc-100 px-1 py-0.5 text-[0.8em]">/admin</code> straight away.
      </p>

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
          Access is managed on GitHub, not here. Whoever can write the repository can edit
          this site; whoever administers it can also publish and change settings.
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
          <strong class="font-semibold">Changes take effect within a minute.</strong>
          Access is read from GitHub, not from the deployed site, so adding or removing
          someone does not need a publish or a rebuild.
        </p>
      </aside>
    </main>
  </div>
</template>
