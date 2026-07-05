<script setup lang="ts">
// Edit the site's template PARTS — the header/footer HTML that wraps every page
// (templates/parts/*.html, rendered by the front-end's lib/parts.ts). A source
// editor per part: load the raw HTML, edit, save its own commit. The menu links
// inside the header stay editable via Settings → Menu; this edits the markup.
import { onMounted, ref } from "vue";
import SaveButton from "./SaveButton.vue";
import { inputCls } from "../fields/styles";
import { GitHubClient } from "../backend/github";
import { PARTS, partPath, type PartName } from "../backend/parts";
import { reportError, clearError } from "../errors";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const active = ref<PartName>(PARTS[0].name);
const source = ref("");
const sha = ref<string>();
const loading = ref(true);
const dirty = ref(false);

async function load(name: PartName): Promise<void> {
  active.value = name;
  loading.value = true;
  dirty.value = false;
  try {
    const f = await props.client.loadText(partPath(name));
    source.value = f.text;
    sha.value = f.sha;
    clearError();
  } catch (e) {
    source.value = "";
    sha.value = undefined;
    reportError(e, "Couldn't load this part.");
  } finally {
    loading.value = false;
  }
}

function select(name: PartName): void {
  if (name === active.value) return;
  if (dirty.value && !confirm("Discard unsaved changes to this part?")) return;
  load(name);
}

async function save(): Promise<void> {
  sha.value = await props.client.saveText(
    partPath(active.value),
    source.value,
    `Edit ${active.value} part`,
    sha.value,
  );
  dirty.value = false;
}

onMounted(() => load(active.value));
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button
        class="text-sm text-zinc-600 transition hover:text-zinc-900"
        @click="emit('back')"
      >
        ← Back
      </button>
      <span class="flex-1 text-center text-sm">
        <span v-if="dirty" class="text-zinc-500">Unsaved changes</span>
      </span>
      <SaveButton
        :action="save"
        :disabled="loading"
        @saved="clearError"
        @error="(e) => reportError(e, 'Save failed.')"
      />
    </header>

    <main class="flex-1 px-5 pt-8 pb-24">
      <div class="mx-auto max-w-4xl">
        <h1 class="mb-1 font-serif text-2xl font-bold text-zinc-900">Header &amp; footer</h1>
        <p class="mb-4 text-sm text-zinc-500">
          The HTML that wraps every page. Menu links are edited in
          <span class="font-medium">Settings → Menu</span>; this edits the markup around them.
        </p>

        <!-- Part selector (header / footer) -->
        <div class="mb-3 flex gap-1">
          <button
            v-for="p in PARTS"
            :key="p.name"
            class="nav-item"
            :class="{ 'nav-item--active': active === p.name }"
            @click="select(p.name)"
          >
            {{ p.label }}
          </button>
        </div>

        <div class="card p-4">
          <p class="mb-2 font-mono text-xs text-zinc-500">templates/parts/{{ active }}.html</p>
          <div v-if="loading" class="skeleton h-80 w-full" />
          <textarea
            v-else
            v-model="source"
            rows="22"
            spellcheck="false"
            :class="[inputCls, 'resize-y font-mono text-xs']"
            @input="dirty = true"
          />
        </div>
      </div>
    </main>
  </div>
</template>
