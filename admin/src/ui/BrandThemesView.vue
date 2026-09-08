<script setup lang="ts">
// One appearance workspace; tab switches retain the unsaved-change guard.
import { ref } from "vue";
import BrandView from "./BrandView.vue";
import StartersView from "./StartersView.vue";
import ThemesView from "./ThemesView.vue";
import PluginsView from "./PluginsView.vue";
import { GitHubClient } from "../backend/github";
import { confirmDiscard } from "./dirty";

defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const TABS = [
  { key: "brand", label: "Brand" },
  { key: "starters", label: "Site starters" },
  { key: "themes", label: "Themes" },
  { key: "plugins", label: "Plugins" },
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
  <component :is="tab === 'brand' ? BrandView : tab === 'starters' ? StartersView : tab === 'plugins' ? PluginsView : ThemesView" :client="client" @back="emit('back')">
    <template #navigation>
      <nav class="settings-tabs" aria-label="Appearance settings">
        <button v-for="t in TABS" :key="t.key" :aria-pressed="tab === t.key" @click="select(t.key)">{{ t.label }}</button>
      </nav>
    </template>
  </component>
</template>
