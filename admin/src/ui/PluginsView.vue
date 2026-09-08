<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SettingsHeader from './SettingsHeader.vue';
import SaveButton from './SaveButton.vue';
import { GitHubClient, GitHubError } from '../backend/github';
import { isOwner } from '../backend/access';
import { isDirty } from './dirty';
import { SITE_PLUGINS, resolveSitePlugins } from '../../../frontend/lib/site-plugins';
const props = defineProps<{ client: GitHubClient }>();
defineEmits<{ (e: 'back'): void }>();
const plugins = ref(resolveSitePlugins(null));
const loading = ref(true), saving = ref(false), ready = ref(false);
const error = ref(''), success = ref('');
let original: Record<string, unknown> = {}, sha: string | undefined;
const baseline = ref('');
const dirty = computed(() => ready.value && JSON.stringify(plugins.value) !== baseline.value);
watch(dirty, value => { isDirty.value = value; });
onBeforeUnmount(() => { isDirty.value = false; });
async function load() {
  loading.value = true; ready.value = false; error.value = '';
  try {
    if (!isOwner()) throw new Error('Only the site owner can manage plugins.');
    try {
      const file = await props.client.loadJson('data/appearance.json');
      original = file.data; sha = file.sha;
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e;
      original = {}; sha = undefined;
    }
    plugins.value = resolveSitePlugins(original.plugins);
    baseline.value = JSON.stringify(plugins.value); ready.value = true;
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not load plugins.'; }
  finally { loading.value = false; }
}
onMounted(load);
function cancel() {
  if (!ready.value || saving.value) return;
  plugins.value = JSON.parse(baseline.value); success.value = '';
}
async function apply() {
  if (!isOwner() || !ready.value || saving.value) throw new Error('Load plugins as the site owner before applying changes.');
  saving.value = true; error.value = ''; success.value = '';
  const submitted = JSON.stringify(plugins.value);
  const existing = original.plugins && typeof original.plugins === 'object' ? original.plugins : {};
  const next = { ...original, plugins: { ...existing, ...JSON.parse(submitted) } };
  try {
    sha = await props.client.saveJson('data/appearance.json', next, 'lanza: update site plugins', sha);
    original = next; baseline.value = submitted;
    success.value = 'Plugin choices saved to staging. Check the site preview, then publish when ready.';
  } finally { saving.value = false; }
}
</script>
<template>
  <div class="settings-page">
    <SettingsHeader title="Brand &amp; themes" @back="$emit('back')">
      <template #description><p>Optional features for your public site.</p></template>
      <template #navigation><slot name="navigation" /></template>
      <template #actions>
        <button class="btn btn-ghost" :disabled="!dirty || saving" @click="cancel">Cancel</button>
        <SaveButton label="Apply to staging" :action="apply" :disabled="!ready || !dirty || saving" @error="e => error = e instanceof Error ? e.message : 'Could not save plugins.'" />
      </template>
    </SettingsHeader>
    <main class="settings-body settings-body--wide">
      <p v-if="loading">Loading plugins…</p>
      <div v-if="error" role="alert"><p>{{ error }}</p><button v-if="!ready" class="btn btn-ghost" :disabled="loading" @click="load">Retry loading</button></div>
      <p v-if="success" role="status">{{ success }}</p>
      <fieldset :disabled="!ready || saving" class="plugin-grid">
        <legend class="sr-only">First-party plugins</legend>
        <label v-for="plugin in SITE_PLUGINS" :key="plugin.id" class="plugin-card">
          <span class="plugin-heading"><strong>{{ plugin.name }}</strong><input v-model="plugins[plugin.id]" type="checkbox" :aria-label="plugin.name" /></span>
          <span>{{ plugin.description }}</span><small>{{ plugin.scope }}</small>
          <span class="plugin-state">{{ plugins[plugin.id] ? 'Enabled' : 'Disabled' }}</span>
        </label>
      </fieldset>
      <p class="plugin-note">These first-party plugins run in the visitor's browser, with no accounts, tracking or external service. They are off until you enable and publish them. Turn one off and apply to remove its behavior from the next build.</p>
    </main>
  </div>
</template>
<style scoped>
.plugin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:1.5rem;margin:1.5rem 0;min-width:0}.plugin-card{display:flex;flex-direction:column;gap:1rem;padding:1.5rem;border:1px solid var(--border,#d8d5ca);line-height:1.7;cursor:pointer}.plugin-heading{display:flex;justify-content:space-between;align-items:center;gap:1rem;font-size:1.2rem}.plugin-heading input{width:1.2rem;height:1.2rem}.plugin-state{font-size:.8rem;font-weight:600}.plugin-note{max-width:65ch;line-height:1.7;font-size:.85rem}small{color:var(--muted,#666)}
</style>
