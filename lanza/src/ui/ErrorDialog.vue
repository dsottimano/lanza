<script setup lang="ts">
// The single, app-wide error dialog. Renders whatever reportError() last set.
// For auth-ish failures (401/403/404) it offers a shortcut to fix the token.
import { errorState, clearError, isAuthError } from "../errors";

const emit = defineEmits<{ (e: "fix-token"): void }>();

function fixToken() {
  clearError();
  emit("fix-token");
}
</script>

<template>
  <div
    v-if="errorState.message"
    class="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
    @click.self="clearError"
  >
    <div class="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
      <div class="mb-3 flex items-center gap-2">
        <span class="flex size-7 items-center justify-center rounded-full bg-rose-100 text-rose-600" aria-hidden="true">!</span>
        <h2 class="text-base font-semibold text-zinc-900">
          {{ isAuthError(errorState.status) ? "Access problem" : "Something went wrong" }}
        </h2>
      </div>

      <p class="text-sm leading-relaxed break-words text-zinc-600">{{ errorState.message }}</p>
      <p v-if="errorState.status" class="mt-1 text-xs text-zinc-400">GitHub status {{ errorState.status }}</p>

      <p v-if="isAuthError(errorState.status)" class="mt-3 text-sm text-zinc-500">
        Your token may be expired or missing <strong>Contents: read &amp; write</strong> on this repo.
      </p>

      <div class="mt-5 flex justify-end gap-2">
        <button
          v-if="isAuthError(errorState.status)"
          class="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
          @click="fixToken"
        >
          Update token
        </button>
        <button
          class="rounded-lg px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100"
          @click="clearError"
        >
          Dismiss
        </button>
      </div>
    </div>
  </div>
</template>
