<script setup lang="ts">
// The single, app-wide error dialog. Renders whatever reportError() last set.
// The GitHub token is server-side now, so auth-ish failures (401/403/404) point
// at the server/proxy config rather than a token the editor can fix in-browser.
import { errorState, clearError, isAuthError } from "../errors";
</script>

<template>
  <div
    v-if="errorState.message"
    class="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
    @click.self="clearError"
  >
    <div class="glass-strong w-full max-w-md rounded-2xl p-6">
      <div class="mb-3 flex items-center gap-2">
        <span class="flex size-7 items-center justify-center rounded-full bg-rose-100 text-rose-600" aria-hidden="true">!</span>
        <h2 class="text-base font-semibold text-zinc-900">
          {{ isAuthError(errorState.status) ? "Access problem" : "Something went wrong" }}
        </h2>
      </div>

      <p class="text-sm leading-relaxed break-words text-zinc-600">{{ errorState.message }}</p>
      <p v-if="errorState.status" class="mt-1 text-xs text-zinc-500">GitHub status {{ errorState.status }}</p>

      <p v-if="isAuthError(errorState.status)" class="mt-3 text-sm text-zinc-500">
        The server's GitHub token may be missing, expired, or lacking
        <strong>Contents: read &amp; write</strong> on this repo. Contact the site
        admin to check the <code class="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-700">GITHUB_TOKEN</code> setting.
      </p>

      <div class="mt-5 flex justify-end gap-2">
        <button
          class="rounded-lg px-4 py-2 text-sm text-zinc-600 transition hover:bg-white/60"
          @click="clearError"
        >
          Dismiss
        </button>
      </div>
    </div>
  </div>
</template>
