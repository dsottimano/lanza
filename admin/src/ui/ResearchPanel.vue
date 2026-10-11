<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { GitHubClient } from '../backend/github';
import { access } from '../backend/access';
import { site } from '../backend/site';
import { useAdditionalDirtyFlag } from './dirty';
const props=defineProps<{client:GitHubClient;current:any;busy:boolean}>();
const emit=defineEmits<{(e:'run',operation:string,input?:Record<string,unknown>):void}>();
const router=useRouter();
const manifest=ref<any>(null),baseline=ref(''),articles=ref<Array<{path:string;label:string}>>([]),issue=ref('');
const evidence=computed(()=>props.current.state.data?.evidence);
const dirty=computed(()=>JSON.stringify(manifest.value)!==baseline.value);
useAdditionalDirtyFlag(dirty);
watch(()=>props.current.state.data?.manifest,value=>{
  manifest.value=JSON.parse(JSON.stringify(value || {version:1,repository:access.repo,article:{id:'',contentPath:'',generatedFactIds:[]},sources:[],facts:[]}));
  baseline.value=JSON.stringify(manifest.value);
},{immediate:true});
onMounted(async()=>{try{for(const locale of site.locales){const files=await props.client.listDir(`content/posts/${locale.code}`);for(const file of files)if(file.path.endsWith('.md'))articles.value.push({path:file.path,label:`${file.name.replace(/\.md$/,'')} · ${locale.code}`});}}catch{issue.value='Could not load all articles. Reload this workspace to try again.';}});
function configure(){
  manifest.value.article.id=manifest.value.article.contentPath.split('/').pop()?.replace(/\.md$/,'');
  emit('run','configure',{manifest:JSON.parse(JSON.stringify(manifest.value))});
}
function addSource(){manifest.value.sources.push({id:`source-${Date.now()}`,url:'',format:'html',selector:'main'});}
function removeSource(id:string){manifest.value.sources=manifest.value.sources.filter((s:any)=>s.id!==id);}
function addFact(){manifest.value.facts.push({id:`fact-${Date.now()}`,label:'',sourceId:manifest.value.sources.find((s:any)=>s.format==='json')?.id || '',extract:{type:'json-pointer',pointer:''}});}
function removeFact(id:string){manifest.value.facts=manifest.value.facts.filter((f:any)=>f.id!==id);manifest.value.article.generatedFactIds=manifest.value.article.generatedFactIds.filter((v:string)=>v!==id);}
function openArticle(){const match=manifest.value.article.contentPath.match(/^content\/posts\/([^/]+)\/([^/]+)\.md$/);if(match)void router.push(`/posts/${match[1]}/${match[2]}`);}
</script>
<template>
  <div class="research-panel">
    <p v-if="issue" role="alert">{{ issue }}</p>
    <form @submit.prevent="configure">
      <fieldset :disabled="busy"><legend>Sources and article</legend>
        <label>Article<select v-model="manifest.article.contentPath" required><option value="" disabled>Choose an article</option><option v-for="article in articles" :key="article.path" :value="article.path">{{ article.label }}</option><option v-if="manifest.article.contentPath && !articles.some(a=>a.path===manifest.article.contentPath)" :value="manifest.article.contentPath">{{ manifest.article.id }}</option></select></label>
        <div v-for="source in manifest.sources" :key="source.id" class="research-source">
          <label>Source URL<input v-model="source.url" type="url" required placeholder="https://…" /></label>
          <label>Format<select v-model="source.format"><option value="html">Web page</option><option value="json">JSON data</option><option value="text">Plain text</option></select></label>
          <details v-if="source.format==='html'"><summary>Page extraction</summary><label>Content selector<input v-model="source.selector" placeholder="main" /></label><small>Use a tag, class or ID that identifies the source's main text.</small></details>
          <button type="button" class="btn btn-ghost" @click="removeSource(source.id)">Remove source</button>
        </div>
        <button type="button" class="btn btn-ghost" :disabled="manifest.sources.length>=5" @click="addSource">Add source</button>
        <details class="research-facts"><summary>Facts to track and propose ({{ manifest.facts.length }})</summary>
          <p>Web pages are monitored for changes. Define facts from JSON sources here; an agent can configure calculations and more precise extraction through the same plugin tools.</p>
          <div v-for="fact in manifest.facts" :key="fact.id" class="research-source">
            <label>Fact label<input v-model="fact.label" required /></label>
            <template v-if="fact.extract?.type==='json-pointer' && !fact.extract.select">
              <label>Source<select v-model="fact.sourceId" required><option v-for="s in manifest.sources.filter((s:any)=>s.format==='json')" :key="s.id" :value="s.id">{{ s.url }}</option></select></label>
              <label>JSON field path<input v-model="fact.extract.pointer" placeholder="/properties/mag" /></label>
            </template><p v-else>Extraction is configured by your agent. Existing rules are preserved.</p>
            <label class="inline-check"><input v-model="manifest.article.generatedFactIds" type="checkbox" :value="fact.id" />Include in article proposal</label>
            <button type="button" class="btn btn-ghost" @click="removeFact(fact.id)">Remove fact</button>
          </div><button type="button" class="btn btn-ghost" :disabled="manifest.facts.length>=40" @click="addFact">Add JSON fact</button>
        </details>
        <div class="research-actions"><button class="btn btn-primary" :disabled="!dirty || !manifest.sources.length || !manifest.article.contentPath">Save sources privately</button><button type="button" class="btn btn-ghost" :disabled="!dirty" @click="manifest=JSON.parse(baseline)">Cancel changes</button></div>
      </fieldset>
    </form>
    <div class="research-actions"><button class="btn btn-primary" :disabled="busy || dirty || !current.state.enabled || !current.state.data?.manifest" @click="emit('run','refresh')">{{ busy?'Working…':'Refresh now' }}</button><button class="btn btn-ghost" :disabled="busy || dirty || !evidence || current.state.data?.needsRefresh" @click="openArticle">Open article to review facts</button></div>
    <p v-if="current.state.data?.needsRefresh" role="status">Sources changed. Refresh before using these facts; the previous evidence is retained below.</p>
    <section v-if="evidence"><h3>Latest evidence</h3><p>Checked {{ evidence.refreshedAt }}. Imported sources are evidence to review, not verified conclusions.</p>
      <div v-for="source in evidence.sources" :key="source.id" class="research-snapshot"><strong>{{ source.status }}</strong> · {{ source.url }}<p>{{ source.changed?'Source changed':'Source unchanged' }}<span v-if="source.error"> · {{ source.error }}</span></p><details><summary>Read collected text</summary><pre>{{ source.text || 'No evidence collected.' }}</pre></details></div>
      <div class="research-table"><table><caption>Tracked facts</caption><thead><tr><th>Fact</th><th>Previous</th><th>Latest</th><th>Status</th></tr></thead><tbody><tr v-for="fact in evidence.facts" :key="fact.id"><th>{{ fact.label }}</th><td>{{ current.state.data.changes?.find((c:any)=>c.id===fact.id)?.before ?? '—' }}</td><td>{{ fact.value ?? 'Unavailable' }} {{ fact.unit }}</td><td>{{ fact.status }}</td></tr></tbody></table></div>
    </section><p v-else>No evidence collected yet. Save sources, enable Research, then refresh.</p>
  </div>
</template>
<style scoped>
.research-panel{margin-top:1.5rem;max-width:850px}.research-panel legend,.research-panel h3{font-size:1.2rem;font-weight:600;margin-bottom:1rem}.research-panel label{display:flex;flex-direction:column;gap:.35rem;margin:.6rem 0}.research-panel input,.research-panel select{border:1px solid var(--border);border-radius:6px;padding:.65rem;background:var(--paper-card);width:100%}.research-source,.research-snapshot{border:1px solid var(--border);border-radius:8px;margin:1rem 0;padding:1rem;overflow-wrap:anywhere}.research-panel .inline-check{flex-direction:row;align-items:center}.inline-check input{width:auto}.research-actions{display:flex;flex-wrap:wrap;gap:.75rem;margin:1.25rem 0}.research-facts{margin:1rem 0}.research-panel summary{cursor:pointer}.research-panel pre{white-space:pre-wrap;max-height:280px;overflow:auto;font:14px/1.6 system-ui}.research-table{overflow-x:auto}table{width:100%;text-align:left;border-collapse:collapse}th,td{padding:.75rem;border-bottom:1px solid var(--border)}caption{text-align:left;font-weight:600}.research-panel p{margin:.75rem 0;line-height:1.6}
</style>
