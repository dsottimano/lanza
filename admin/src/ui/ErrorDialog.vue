<script setup lang="ts">
// The single, app-wide error dialog. Renders whatever reportError() last set.
// The GitHub token is server-side, in an HttpOnly cookie, so an auth-ish failure
// (401/403/404) is either a lapsed sign-in the person can redo or missing access to
// the repository — never a token they could paste in here.
import { errorState, clearError, isAuthError } from "../errors";
import { onBeforeUnmount, ref, watchEffect } from "vue";

const dialog = ref<HTMLDialogElement>();
watchEffect(() => {
  if (errorState.message && dialog.value && !dialog.value.open) dialog.value.showModal();
  if (!errorState.message && dialog.value?.open) dialog.value.close();
}, { flush: "post" });
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="error-dialog-title"
    aria-describedby="error-dialog-message"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border-0 bg-transparent p-0 backdrop:bg-black/30"
    @cancel.prevent="clearError"
  >
    <div class="glass-strong w-full max-w-md rounded-2xl p-6">
      <div class="mb-3 flex items-center gap-2">
        <span class="flex size-7 items-center justify-center rounded-full bg-rose-100 text-rose-600" aria-hidden="true">!</span>
        <h2 id="error-dialog-title" class="text-base font-semibold text-zinc-900">
          {{ isAuthError(errorState.status) ? "Access problem" : "Something went wrong" }}
        </h2>
      </div>

      <p id="error-dialog-message" class="text-sm leading-relaxed break-words text-zinc-600">{{ errorState.message }}</p>
      <p v-if="errorState.status" class="mt-1 text-xs text-zinc-500">GitHub status {{ errorState.status }}</p>

      <!-- A 401 is now "your GitHub sign-in ran out", not a server misconfiguration:
           the proxy sends YOUR token, so there is a fix you can perform yourself. A
           reload lands on the sign-in screen. 403/404 still mean the account is
           signed in but lacks access to this repository. -->
      <p v-if="errorState.status === 401" class="mt-3 text-sm text-zinc-500">
        Your GitHub sign-in has expired.
        <a class="underline" href="/admin/">Reload to sign in again.</a>
      </p>
      <p v-else-if="isAuthError(errorState.status)" class="mt-3 text-sm text-zinc-500">
        Your GitHub account may not have <strong>write access</strong> to this site's
        repository. Ask the site owner to add you as a collaborator.
      </p>

      <div class="mt-5 flex justify-end gap-2">
        <button
          autofocus
          class="rounded-lg px-4 py-2 text-sm text-zinc-600 transition hover:bg-[var(--surface)]"
          @click="clearError"
        >
          Dismiss
        </button>
      </div>
    </div>
  </dialog>
</template>
