<script setup lang="ts">
// Settings → People. Who can get into this site, and at what level.
//
// The honest part of this screen is the delay. `lanza.config.json` is imported by
// the Pages Function that guards /admin, so it is baked into the DEPLOY — an invite
// does not take effect when it is saved, or even when it is merged, but when
// Cloudflare finishes rebuilding. Every other panel can be vague about publishing;
// this one cannot, because the failure mode is a person being told they have access
// and then being turned away at the door. So the pending state is shown explicitly,
// per person, rather than as a banner that is easy to miss.
import { computed, ref } from "vue";
import { GitHubClient } from "../backend/github";
import { access, isValidLogin, saveEditors, toLoginList } from "../backend/access";
import { reportError, clearError } from "../errors";

const props = defineProps<{ client: GitHubClient }>();
defineEmits<{ (e: "back"): void }>();

const draft = ref("");
const saving = ref(false);
const justSaved = ref(false);

// The deployed list (what the gate currently enforces) vs the working-branch list
// (what it will enforce after a publish + rebuild). `access.editors` is loaded from
// production, and `pending` accumulates changes made here.
const pending = ref<string[] | null>(null);
const editors = computed(() => pending.value ?? access.editors);
const live = computed(() => access.editors.map((e) => e.toLowerCase()));

const isPending = (login: string) => !live.value.includes(login.toLowerCase());
const hasChanges = computed(() => pending.value !== null);

const error = ref<string | null>(null);

function add() {
  const login = draft.value.trim();
  error.value = null;
  if (!login) return;
  if (!isValidLogin(login)) {
    error.value = "That is not a GitHub username. Letters, numbers and single hyphens only.";
    return;
  }
  const who = login.toLowerCase();
  if (access.owners.some((o) => o.toLowerCase() === who)) {
    error.value = `${login} is already an owner of this site.`;
    return;
  }
  if (editors.value.some((e) => e.toLowerCase() === who)) {
    error.value = `${login} is already invited.`;
    return;
  }
  pending.value = [...editors.value, login];
  draft.value = "";
}

function remove(login: string) {
  error.value = null;
  pending.value = editors.value.filter((e) => e.toLowerCase() !== login.toLowerCase());
}

async function save() {
  if (!pending.value) return;
  saving.value = true;
  error.value = null;
  try {
    await saveEditors(props.client, toLoginList(pending.value));
    pending.value = null;
    justSaved.value = true;
    clearError();
  } catch (e) {
    reportError(e, "Could not save who can edit this site.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button class="text-sm text-zinc-600 transition hover:text-zinc-900" @click="$emit('back')">← Back</button>
      <span class="flex-1 text-center text-sm"></span>
      <button
        class="btn btn-primary min-w-[6.5rem] px-4"
        :disabled="!hasChanges || saving"
        @click="save"
      >
        {{ saving ? "Saving…" : "Save" }}
      </button>
    </header>

    <main class="mx-auto max-w-3xl px-6 pt-8 pb-24">
      <h1 class="mb-2 font-serif text-3xl font-bold tracking-tight text-zinc-900">People</h1>
      <p class="mb-8 max-w-prose text-sm leading-relaxed text-zinc-600">
        Everyone here signs in with their own GitHub account. There are no passwords to
        share and nothing to send them — they go to this site's
        <code class="rounded bg-zinc-100 px-1 py-0.5 text-[0.8em]">/admin</code> and sign in.
      </p>

      <!-- Owners -->
      <section class="mb-10">
        <h2 class="mb-1 text-sm font-semibold text-zinc-900">Owners</h2>
        <p class="mb-3 text-sm text-zinc-600">
          Can do everything: write, publish, change settings and hosting, and invite people.
        </p>
        <ul class="card divide-y divide-[var(--border)]">
          <li
            v-for="owner in access.owners"
            :key="owner"
            class="flex items-center justify-between gap-3 px-4 py-3"
          >
            <span class="text-sm font-medium text-zinc-900">
              {{ owner }}
              <span v-if="owner.toLowerCase() === access.login?.toLowerCase()" class="ml-1 text-zinc-500">(you)</span>
            </span>
            <span class="text-xs text-zinc-500">Owner</span>
          </li>
        </ul>
        <p class="mt-2 text-xs text-zinc-500">
          Owners are set in <code>lanza.config.json</code> in the repository. Changing them is
          deliberately a repo edit, so this screen can never hand out full control.
        </p>
      </section>

      <!-- Editors -->
      <section>
        <h2 class="mb-1 text-sm font-semibold text-zinc-900">Editors</h2>
        <p class="mb-3 text-sm text-zinc-600">
          Can write and edit content, and upload images. Cannot publish, change settings or
          hosting, or invite anyone.
        </p>

        <ul v-if="editors.length" class="card mb-3 divide-y divide-[var(--border)]">
          <li
            v-for="editor in editors"
            :key="editor"
            class="flex items-center justify-between gap-3 px-4 py-3"
          >
            <span class="text-sm font-medium text-zinc-900">
              {{ editor }}
              <span
                v-if="isPending(editor)"
                class="ml-2 rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-900"
              >
                Not live yet
              </span>
            </span>
            <button
              class="text-sm text-zinc-500 transition hover:text-red-700"
              @click="remove(editor)"
            >
              Remove
            </button>
          </li>
        </ul>
        <p v-else class="mb-3 text-sm text-zinc-500">
          No one else has been invited yet.
        </p>

        <form class="flex flex-wrap items-start gap-2" @submit.prevent="add">
          <div class="flex-1 min-w-[16rem]">
            <label class="sr-only" for="invite-login">GitHub username</label>
            <input
              id="invite-login"
              v-model="draft"
              class="input w-full"
              placeholder="GitHub username"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
            />
            <p v-if="error" class="mt-1.5 text-sm text-red-700">{{ error }}</p>
          </div>
          <button class="btn btn-ghost" type="submit">Add editor</button>
        </form>
      </section>

      <!-- The delay, stated plainly -->
      <aside class="mt-10 border-l-2 border-amber-500 bg-amber-50 px-4 py-3">
        <p class="text-sm leading-relaxed text-amber-950">
          <strong class="font-semibold">An invite goes live on the next publish.</strong>
          Who can sign in is part of the site itself, so it changes when the site is rebuilt —
          not when you press Save. Save here, then
          <em>Publish</em>, and give it a minute to build before they try.
        </p>
      </aside>

      <p v-if="justSaved && !hasChanges" class="mt-4 text-sm text-zinc-600">
        Saved. Publish to let the change take effect.
      </p>
    </main>
  </div>
</template>
