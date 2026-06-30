<script setup lang="ts">
// Image field: upload a file (committed to the repo under MEDIA.dir, served
// from MEDIA.publicPrefix) or paste an external URL. The upload is its own
// commit; the stored value is the public path/URL.
import { computed, inject } from "vue";
import { CLIENT_KEY } from "./context";
import { reportError } from "../errors";
import { inputCls } from "./styles";
import { useImageUpload } from "./useImageUpload";
import { safeImageUrl } from "../editor/url";

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
      class="max-h-40 rounded-lg border border-zinc-200 object-contain"
      alt=""
    />

    <div class="flex items-center gap-3">
      <label
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900"
        :class="{ 'pointer-events-none opacity-60': uploading }"
      >
        <span
          v-if="uploading"
          class="size-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
        />
        {{ uploading ? "Uploading…" : model ? "Replace" : "Upload image" }}
        <input type="file" accept="image/*" class="hidden" :disabled="uploading" @change="onPick" />
      </label>
      <button
        v-if="model"
        type="button"
        class="text-sm text-rose-500 transition hover:underline"
        @click="model = ''"
      >
        Remove
      </button>
    </div>

    <input type="text" v-model="model" placeholder="…or paste a URL / path" :class="inputCls" />
  </div>
</template>
