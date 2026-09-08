<script setup lang="ts">
import SettingsHeader from "./SettingsHeader.vue";
defineEmits<{ (e: "back"): void }>();
import { computed, ref, shallowRef, watch } from 'vue';
import { render } from '../../../frontend/lib/template-render';
import { resolveBrand } from '../../../frontend/lib/appearance';
import { STARTERS } from '../../../recipes/catalog.mjs';
import { GitHubClient } from '../backend/github';
import { prepareStarter, installStarter } from '../backend/starters';
import { site } from '../backend/site';
import { loadSchema } from '../backend/schema';
import { refreshPending } from './staging';
const props = defineProps<{ client: GitHubClient }>();
const selected = ref(STARTERS[0].id);
const look = ref('editorial');
const locale = ref(site.defaultLocale);
const samples = ref(true);
const current = computed(() => STARTERS.find(s => s.id === selected.value)!);
const previewPage = ref<'home' | 'listing' | 'detail'>('home');
const viewport = ref<'desktop' | 'mobile'>('desktop');
const preview = computed(() => {
  const starter = current.value;
  const style = starter.looks.find(s => s.id === look.value) ?? starter.looks[0];
  const brand = resolveBrand({ brand: style.brand } as Parameters<typeof resolveBrand>[0]);
  const prefix = locale.value === site.defaultLocale ? '' : `/${locale.value}`;
  const indexUrl = `${prefix}/${starter.contentType.route.base}/`;
  const entries = samples.value ? starter.samples.map(sample => ({ ...sample.data, url: `${indexUrl}${sample.stem}/`, slug: sample.stem })) : [];
  const listing = starter.contentType.route.list;
  const template = previewPage.value === 'home' ? starter.home.preset : previewPage.value === 'listing' ? listing.template : starter.contentType.route.template;
  const data = previewPage.value === 'home' ? { ...starter.home.slots, browseUrl: indexUrl } : previewPage.value === 'listing' ? { ...listing.slots, entries, count: entries.length, isEmpty: !entries.length } : { ...starter.samples[0].data, body: starter.samples[0].body, indexUrl };
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${brand.fontHref ? `<link rel="stylesheet" href="${brand.fontHref}">` : ''}<style>body{margin:0;${brand.styleVars};background:var(--bg)}*{box-sizing:border-box}</style></head><body>${render(starter.templates[template].html, data)}</body></html>`;
});
watch(selected, () => { if (!current.value.looks.some(s => s.id === look.value)) look.value = current.value.looks[0].id; });
const busy = ref(false);
const error = ref('');
const success = ref('');
const plan = shallowRef<Awaited<ReturnType<typeof prepareStarter>> | null>(null);
watch([selected, look, locale, samples], () => { plan.value = null; error.value = ''; success.value = ''; });
async function prepare() {
  busy.value = true; error.value = ''; success.value = ''; plan.value = null;
  try { plan.value = await prepareStarter(props.client, { id: selected.value, look: look.value, locale: locale.value, includeSamples: samples.value }); }
  catch (err) { error.value = err instanceof Error ? err.message : 'Could not prepare this starter.'; }
  finally { busy.value = false; }
}
async function install() {
  if (!plan.value) return;
  busy.value = true; error.value = '';
  try {
    await installStarter(props.client, plan.value);
    success.value = `${plan.value.label} installed to staging. Edit its content, preview the site, then publish when ready.`;
    plan.value = null;
    await loadSchema(props.client); await refreshPending(props.client);
  } catch (err) { error.value = err instanceof Error ? err.message : 'Installation failed.'; plan.value = null; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="settings-page">
    <SettingsHeader title="Brand &amp; themes" @back="$emit('back')">
      <template #description><p>A starting point with pages, content and a style you can make your own.</p></template>
      <template #navigation><slot name="navigation" /></template>
    </SettingsHeader>
  <main class="starters settings-body settings-body--wide">
    <fieldset :disabled="busy">
      <legend class="sr-only">Site starter</legend>
      <div class="starter-options">
        <button v-for="starter in STARTERS" :key="starter.id" type="button" class="starter-option" :class="{ chosen: selected === starter.id }" :aria-pressed="selected === starter.id" @click="selected = starter.id">
          <span class="eyebrow">{{ starter.contentType.label }} · {{ starter.looks.length }} looks</span>
          <h2>{{ starter.label }}</h2><p>{{ starter.description }}</p>
          <ul><li v-for="feature in starter.features" :key="feature">{{ feature }}</li></ul>
          <strong>{{ selected === starter.id ? 'Selected ✓' : 'Choose starter →' }}</strong>
        </button>
      </div>
      <h2>Choose the atmosphere</h2>
      <div class="looks">
        <button v-for="style in current.looks" :key="style.id" type="button" :aria-pressed="look === style.id" :class="{ chosen: look === style.id }" @click="look = style.id">
          <span class="swatches"><i v-for="color in [style.brand.colors.bg, style.brand.colors.ink, style.brand.colors.accent]" :key="color" :style="{ background: color }"></i></span>
          <strong>{{ style.label }}</strong><span>{{ style.description }}</span>
        </button>
      </div>
      <div class="preview-toolbar">
        <h2>Preview</h2>
        <div role="group" aria-label="Preview page">
          <button v-for="page in (['home', 'listing', 'detail'] as const)" :key="page" type="button" :aria-pressed="previewPage === page" @click="previewPage = page">{{ page === 'home' ? 'Introduction' : page === 'listing' ? 'Listing' : 'Detail' }}</button>
        </div>
        <div role="group" aria-label="Preview width">
          <button type="button" :aria-pressed="viewport === 'desktop'" @click="viewport = 'desktop'">Desktop</button>
          <button type="button" :aria-pressed="viewport === 'mobile'" @click="viewport = 'mobile'">Mobile</button>
        </div>
      </div>
      <div class="preview-stage"><iframe title="Starter design preview" sandbox="" :srcdoc="preview" :class="{ 'preview-mobile': viewport === 'mobile' }" /></div>
      <p class="muted">Actual page templates with sample content. Your site's header and footer stay in place after installation. Detail previews always show an example.</p>
      <div class="setup">
        <label>Content language <select v-model="locale"><option v-for="language in site.locales" :key="language.code" :value="language.code">{{ language.label || language.code }}</option></select></label>
        <label><input v-model="samples" type="checkbox" /> Include example entries</label>
      </div>
      <p class="muted">Introductory copy and examples are in English. Replace or translate them before publishing. Contact links become active when you add your address or contact page.</p>
      <p class="muted">Not included: {{ current.notIncluded.join(', ') }}.</p>
      <button class="btn btn-primary" @click="prepare">{{ busy ? 'Working…' : 'Review installation →' }}</button>
    </fieldset>
    <p v-if="error" role="alert" class="notice">{{ error }}</p>
    <p v-if="success" role="status" class="notice">{{ success }}</p>
    <section v-if="plan" class="review">
      <h2>Ready to add {{ plan.label }}</h2>
      <p>{{ plan.homePreserved ? 'Your homepage stays as it is.' : 'This creates your homepage.' }} Overview: <code>{{ plan.overview }}</code> · Collection: <code>{{ plan.listingUrl }}</code></p>
      <ul><li v-for="note in plan.notes" :key="note">{{ note }}</li></ul>
      <details><summary>{{ plan.files.length }} files to add or update</summary><ul><li v-for="file in plan.files" :key="file.path">{{ file.action }} · {{ file.path }}</li></ul></details>
      <button class="btn btn-ghost mt-5" :disabled="busy" @click="plan = null">Cancel</button>
      <button class="btn btn-primary mt-5" :disabled="busy" @click="install">{{ busy ? 'Installing…' : 'Install to staging' }}</button>
    </section>
  </main>
  </div>
</template>
<style scoped>
.preview-toolbar{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin-top:2rem}.preview-toolbar h2{margin:0;margin-right:auto}.preview-toolbar button{padding:.6rem .8rem;border:1px solid #d8d5ca;background:#faf9f4}.preview-toolbar button[aria-pressed="true"]{background:#35382e;color:#fff}.preview-stage{padding:1rem;background:#e9e7df;margin-top:1rem;overflow:hidden}.preview-stage iframe{display:block;width:100%;height:600px;border:1px solid #d8d5ca;background:#fff;margin:auto}.preview-stage iframe.preview-mobile{width:390px;max-width:100%}

fieldset{min-width:0}.eyebrow{font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted,#666)}h1{font-size:2.7rem;letter-spacing:-.04em;line-height:1.1;margin:.6rem 0 1rem}h2{font-size:1.35rem;font-weight:600;margin:1.5rem 0 .8rem}.intro{max-width:650px;line-height:1.8;margin-bottom:2rem}.starter-options{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}.starter-option,.looks button{min-width:0;overflow-wrap:anywhere;border:1px solid #d8d5ca;text-align:left;padding:1.5rem;background:#faf9f4}.chosen{outline:2px solid #35382e;outline-offset:3px}.starter-option h2{font-size:2rem}.starter-option p,.starter-option li,.review li{line-height:1.8}.starter-option ul{margin:1rem 0;padding-left:1.2rem;list-style:disc}.looks{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin:1.5rem 0}.looks button>span:last-child{display:block;font-size:.8rem;margin-top:.5rem}.swatches{display:flex;margin-bottom:1rem}.swatches i{width:34px;height:34px;border:1px solid #aaa;border-radius:50%;margin-right:-5px}.setup{display:flex;align-items:center;gap:2rem;margin:2rem 0 1rem;flex-wrap:wrap}.setup select{margin-left:.5rem;padding:.5rem;border:1px solid #d8d5ca}.muted{font-size:.85rem;line-height:1.7;color:#666;margin:.7rem 0 1rem}.review,.notice{border:1px solid #d8d5ca;padding:1.5rem;margin-top:2rem}.review ul{margin:1rem 0}.review details{font-size:.8rem}button:focus-visible{outline:3px solid #956019;outline-offset:4px}@media(max-width:700px){.starter-options,.looks{grid-template-columns:1fr}h1{font-size:2rem}}
</style>
