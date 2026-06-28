<script setup lang="ts">
// Image field: upload a file (committed to the repo under MEDIA.dir, served
// from MEDIA.publicPrefix) or paste an external URL. The upload is its own
// commit; the stored value is the public path/URL.
import { computed, inject, ref } from "vue";
import { uploadImage } from "../backend/media";
import { CLIENT_KEY } from "./context";
import { reportError } from "../errors";

const model = defineModel<string>();
const client = inject(CLIENT_KEY);

const uploading = ref(false);

const hasPreview = computed(
  () => typeof model.value === "string" && /^(https?:\/\/|\/)/.test(model.value),
);

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 transition placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-900/5";

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!client) {
    reportError("Not connected to GitHub.");
    return;
  }
  uploading.value = true;
  try {
    model.value = await uploadImage(client, file);
  } catch (err) {
    reportError(err, "Image upload failed.");
  } finally {
    uploading.value = false;
    input.value = ""; // allow re-picking the same file
  }
}
</script>

<template>
  <div class="space-y-2">
    <img
      v-if="hasPreview"
      :src="model"
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
