<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { isOwner } from '../backend/access';
import { pluginRequest, type PluginManifest } from '../backend/plugins';
import type { GitHubClient } from '../backend/github';
import SettingsHeader from './SettingsHeader.vue';
import ResearchPanel from './ResearchPanel.vue';
import { useAdditionalDirtyFlag, confirmDiscard, hasUnsavedChanges } from './dirty';
const props=defineProps<{client:GitHubClient}>();
defineEmits<{(e:'back'):void}>();
const router=useRouter();
const catalog=ref<PluginManifest[]>([]), selected=ref<PluginManifest|null>(null);
const current=ref<any>(null),settings=ref<Record<string,string|number|boolean>>({});
const operationResult=ref('');
const busy=ref(false),error=ref(''),notice=ref('');
const dirty=computed(()=>!!current.value && JSON.stringify(settings.value)!==JSON.stringify(current.value.state.settings));
useAdditionalDirtyFlag(dirty);
async function load() {error.value='';try {if(!isOwner())throw new Error('Only the site owner can manage plugins.');catalog.value=(await pluginRequest()).plugins;}catch(e){error.value=(e as Error).message;}}
async function choose(plugin:PluginManifest) {
  if(busy.value || !confirmDiscard())return;
  selected.value=plugin;current.value=null;error.value='';notice.value='';busy.value=true;
  try {if(plugin.scope==='private'){current.value=await pluginRequest(plugin.id);settings.value={...Object.fromEntries((selected.value?.settings || []).filter(f=>f.default!==undefined).map(f=>[f.key,f.default!])),...current.value.state.settings};}}
  catch(e){error.value=(e as Error).message;}finally{busy.value=false;}
}
async function run(operation:string,input:Record<string,unknown>={}) {
  if(!selected.value||!current.value||busy.value)return;
  busy.value=true;error.value='';notice.value='';
  try {const result=await pluginRequest(selected.value.id,operation,{...input,expectedSha:current.value.sha});current.value={...current.value,...(result.state?result:{})};operationResult.value=typeof result.result?.message==='string'?result.result.message:typeof result.message==='string'?result.message:'Action completed.';settings.value={...Object.fromEntries((selected.value?.settings || []).filter(f=>f.default!==undefined).map(f=>[f.key,f.default!])),...current.value.state.settings};notice.value='Saved privately. Website publication is unchanged.';}
  catch(e){error.value=(e as Error).message;}finally{busy.value=false;}
}
onMounted(load);
</script>
<template>
  <div class="settings-page">
    <SettingsHeader title="Plugins" @back="$emit('back')"><template #description><p>Capabilities owned by your site. Choose what to enable and review the results.</p></template></SettingsHeader>
    <main class="settings-body settings-body--wide">
      <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
      <button v-if="error" class="btn btn-ghost" :disabled="busy" @click="selected ? choose(selected) : load()">Reload</button>
      <div class="plugin-catalog" aria-label="Installed plugins">
        <button v-for="plugin in catalog" :key="plugin.id" class="plugin-card" :aria-pressed="selected?.id===plugin.id" :disabled="busy" @click="choose(plugin)">
          <strong>{{ plugin.name }}</strong><span>{{ plugin.description }}</span><small>{{ plugin.scope==='private'?'Private workspace':'Public website' }} · {{ plugin.version }}</small>
        </button>
      </div>
      <p v-if="busy" role="status">Working…</p>
      <section v-if="selected?.scope==='site'" class="plugin-detail"><h2>{{ selected.name }}</h2><p>Website features are reviewed on staging before publication.</p><button class="btn btn-primary" @click="router.push('/settings/brand-themes?tab=plugins')">Open website features</button></section>
      <section v-if="selected && current" class="plugin-detail">
        <div class="plugin-heading"><h2>{{ selected.name }}</h2><button class="btn btn-ghost" :disabled="busy || hasUnsavedChanges" @click="run('set-enabled',{enabled:!current.state.enabled})">{{ current.state.enabled?'Disable':'Enable' }}</button></div>
        <p role="status">{{ current.state.enabled?'Enabled':'Disabled' }} · Manual actions only. Scheduled collection is not connected.</p>
        <p>Disabling keeps your saved evidence. Private data is separate from website Publish and Discard.</p>
        <ResearchPanel v-if="selected.workspace==='research'" :key="selected.id" :client="props.client" :current="current" :busy="busy" @run="run" />
        <form v-else @submit.prevent="run('settings',{settings})">
          <label v-for="field in selected.settings" :key="field.key" class="plugin-setting">{{ field.label }}
            <input v-if="field.type==='boolean'" v-model="settings[field.key]" type="checkbox" :disabled="busy" />
            <input v-else-if="field.type==='number'" v-model.number="settings[field.key]" type="number" :disabled="busy" :required="field.required" />
            <input v-else v-model="settings[field.key]" :disabled="busy" :required="field.required" />
          </label><button v-if="selected.settings.length" class="btn btn-primary" :disabled="busy || !dirty">Save settings</button>
        </form>
        <div v-if="selected.workspace==='settings' && current.state.enabled" class="plugin-heading"><button v-for="operation in selected.operations" :key="operation" class="btn btn-ghost" :disabled="busy || dirty" @click="run(operation)">{{ operation.replaceAll('-', ' ') }}</button></div>
        <p v-if="selected.workspace==='settings' && operationResult" role="status">{{ operationResult }}</p>
      </section>
    </main>
  </div>
</template>
<style scoped>
.plugin-catalog{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;margin:1.5rem 0}.plugin-card{display:flex;flex-direction:column;gap:.75rem;text-align:left;padding:1.25rem;border:1px solid var(--border);border-radius:8px}.plugin-card[aria-pressed=true]{border-color:var(--accent);background:var(--selection)}.plugin-card small{color:var(--muted)}.plugin-detail{border-top:1px solid var(--border);padding-top:1.5rem}.plugin-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem}.plugin-heading h2{font-size:1.4rem}.plugin-detail p{margin:.75rem 0;line-height:1.6}.plugin-setting{display:block;margin:1rem 0}.plugin-setting input{display:block;border:1px solid var(--border);padding:.5rem}
</style>
