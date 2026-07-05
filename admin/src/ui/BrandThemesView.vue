<script setup lang="ts">
// Settings → Brand & themes. The site's look-and-feel under one nav item: the
// palette/fonts/motion editor (Brand → BrandView) and theme import/export/apply
// (Themes → ThemesView). Each tab is the existing editor, unchanged, with its own
// Save/actions; the shell only adds the tab strip and guards tab switches on
// unsaved changes (switching unmounts the other editor). The old appearance.json
// form (theme select + logo) is gone — its `theme` was unread and `logo` unrendered.
import { ref } from "vue";
import BrandView from "./BrandView.vue";
import ThemesView from "./ThemesView.vue";
import { GitHubClient } from "../backend/github";
import { confirmDiscard } from "./dirty";

defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const TABS = [
  { key: "brand", label: "Brand" },
  { key: "themes", label: "Themes" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const tab = ref<TabKey>("brand");

function select(key: TabKey) {
  if (key === tab.value) return;
  if (!confirmDiscard()) return; // the active editor has unsaved edits
  tab.value = key;
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Tab strip: pick which slice of look-and-feel to edit. -->
    <div class="flex justify-center px-5 pt-3">
      <div class="segment">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="segment-btn text-sm"
          :class="{ 'segment-btn--active': tab === t.key }"
          @click="select(t.key)"
        >
          {{ t.label }}
        </button>
      </div>
    </div>

    <BrandView v-if="tab === 'brand'" :client="client" @back="emit('back')" />
    <ThemesView v-else :client="client" @back="emit('back')" />
  </div>
</template>
