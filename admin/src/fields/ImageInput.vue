<script setup lang="ts">
// Image field: upload a file (committed to the repo under MEDIA.dir, served
// from MEDIA.publicPrefix). The upload is its own commit; the stored value is
// the public path.
import { computed, inject } from "vue";
import { CLIENT_KEY } from "./context";
import { reportError } from "../errors";
import { useImageUpload } from "./useImageUpload";
import { safeImageUrl } from "../editor/url";

defineProps<{ inputId?: string }>();
const model = defineModel<string>();
const { uploading, pick } = useImageUpload(inject(CLIENT_KEY));

// Reuse the one image-URL policy for the preview instead of re-testing the
// scheme here: a non-http(s)/non-local value yields "" and shows no preview.
const safeSrc = computed(() => safeImageUrl(model.value));

function onPick(e: Event) {
  pick(
    e,
    (url) => (model.value = url),
    (err) => reportError(err, "Image upload failed."),
  );
}
</script>

<template>
  <div class="space-y-2">
    <img
      v-if="safeSrc"
      :src="safeSrc"
      class="w-full max-h-48 rounded-lg border border-[var(--border)] bg-[var(--surface)] object-contain"
      alt=""
    />

    <div class="flex flex-wrap items-center gap-3">
      <label
        class="btn btn-ghost relative cursor-pointer overflow-hidden focus-within:ring-2 focus-within:ring-[var(--accent)]"
        :class="{ 'pointer-events-none opacity-60': uploading }"
      >
        <span
          v-if="uploading"
          class="size-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
        />
        {{ uploading ? "Uploading…" : model ? "Replace" : "Upload image" }}
        <input :id="inputId" type="file" accept="image/*" :aria-label="model ? 'Replace image' : 'Upload image'" class="absolute inset-0 w-full cursor-pointer opacity-0" :disabled="uploading" @change="onPick" />
      </label>
      <button
        v-if="model"
        type="button"
        class="text-sm text-rose-500 transition hover:underline"
        :disabled="uploading"
        @click="model = ''"
      >
        Remove
      </button>
    </div>
  </div>
</template>
