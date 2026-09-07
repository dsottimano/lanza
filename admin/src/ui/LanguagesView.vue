<script setup lang="ts">
import SettingsHeader from "./SettingsHeader.vue";
// Settings → Languages. Edit the site's locale set after onboarding: which
// languages exist + the default. Writes data/site.json (preserving the
// onboarded flag) through the proxy, then refreshes the in-memory config so the
// language rail updates immediately.
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { GitHubClient } from "../backend/github";
import { site, loadSiteConfig, SITE_CONFIG_PATH, putJsonSafe, LANG_CATALOG, type LocaleDef } from "../backend/site";
import SaveButton from "./SaveButton.vue";
import LocalePicker from "./LocalePicker.vue";
import { reportError, clearError } from "../errors";
import { isDirty } from "./dirty";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void; (e: "saved"): void }>();

// Seed from the currently-loaded config.
const chosen = ref<string[]>(site.locales.map((l) => l.code));
const defaultLocale = ref(site.defaultLocale);
const snapshot = () => JSON.stringify([chosen.value, defaultLocale.value]);
let baseline = snapshot();
watch([chosen, defaultLocale], () => { isDirty.value = snapshot() !== baseline; }, { deep: true });
onBeforeUnmount(() => { isDirty.value = false; });

const valid = computed(() => chosen.value.length >= 1 && chosen.value.includes(defaultLocale.value));

async function save() {
  // Preserve LANG_CATALOG order so the rail reads consistently.
  const locales = LANG_CATALOG.filter((l) => chosen.value.includes(l.code)) as LocaleDef[];
  await putJsonSafe(
    props.client,
    SITE_CONFIG_PATH,
    (cur) => ({ ...cur, defaultLocale: defaultLocale.value, locales, onboarded: cur.onboarded ?? true }),
    "lanza: update languages",
  );
  await loadSiteConfig(props.client);
  baseline = snapshot();
  isDirty.value = false;
  emit("saved");
}
</script>

<template>
  <div class="settings-page">
    <SettingsHeader title="Languages" @back="$emit('back')">
      <template #actions>
        <SaveButton
          :action="save"
          :disabled="!valid"
          @saved="clearError"
          @error="(e) => reportError(e, 'Save failed.')"
        />
      </template>
      <template #description><p>
        Pick the languages this site publishes in. Removing one hides it from the site and the
        editor — existing content files for it stay in the repo.
      </p></template>
    </SettingsHeader>

    <main class="settings-body">
      <div class="card p-6">
        <LocalePicker
          v-model:chosen="chosen"
          v-model:default="defaultLocale"
          default-hint="Lives at the site root (no URL prefix); others are prefixed (/es, /fr)."
        />
      </div>
    </main>
  </div>
</template>
