<script setup lang="ts">
// The page-template surface: pick one of the tenant's HTML templates (the page's
// `preset`), then fill its editable fields (the page's `slots`) with a dynamic
// FieldForm driven by that template's fields.json. An "Advanced" disclosure edits
// the template's raw HTML — the shared design, saved on its own commit.
//
// Templates live at the tenant repo root `templates/<name>/` and are read via
// backend/templates.ts. This replaces the old plain-text-box fallthrough for the
// `preset`/`slots` fields; EditorView filters them out of the generic field panel
// and mounts this instead.
import { computed, onMounted, ref, watch } from "vue";
import FieldForm from "../fields/FieldForm.vue";
import SaveButton from "./SaveButton.vue";
import { inputCls } from "../fields/styles";
import type { GitHubClient } from "../backend/github";
import type { Locale } from "../backend/config";
import { listTemplates, templateHtmlPath, type TemplateInfo } from "../backend/templates";
import { reportError, clearError } from "../errors";

const props = defineProps<{
  client: GitHubClient;
  data: Record<string, unknown>; // the entry frontmatter (reactive) — we own preset + slots
  locale: Locale;
}>();

const data = props.data;

const templates = ref<TemplateInfo[]>([]);
const loading = ref(true);

const selected = computed(() => templates.value.find((t) => t.name === data.preset));
const slotsData = computed(() => data.slots as Record<string, unknown>);

// Empty select value clears the preset; picking one guarantees a slots object.
const presetModel = computed<string>({
  get: () => (data.preset as string) ?? "",
  set: (v) => {
    if (v) {
      data.preset = v;
      ensureSlots();
    } else {
      data.preset = undefined;
    }
  },
});

// A page with a preset always needs a slots object to edit into; never clobber
// slots already loaded from frontmatter.
function ensureSlots(): void {
  const s = data.slots;
  if (data.preset && (typeof s !== "object" || s === null || Array.isArray(s))) {
    data.slots = {};
  }
}

// ── Advanced: the shared template HTML (lazy-loaded when the disclosure opens) ──
const sourceText = ref("");
const sourceSha = ref<string>();
const sourceLoading = ref(false);

async function loadSource(): Promise<void> {
  if (!data.preset) return;
  sourceLoading.value = true;
  try {
    const f = await props.client.loadText(templateHtmlPath(data.preset as string));
    sourceText.value = f.text;
    sourceSha.value = f.sha;
  } catch (e) {
    reportError(e, "Couldn't load the template HTML.");
  } finally {
    sourceLoading.value = false;
  }
}

async function saveSource(): Promise<void> {
  const name = data.preset as string;
  sourceSha.value = await props.client.saveText(
    templateHtmlPath(name),
    sourceText.value,
    `Edit template ${name}`,
    sourceSha.value,
  );
}

function onToggleSource(e: Event): void {
  const open = (e.target as HTMLDetailsElement).open;
  if (open && sourceSha.value === undefined && !sourceLoading.value) loadSource();
}

// Switching templates: reset the source editor (different file) and ensure slots.
watch(
  () => data.preset,
  () => {
    sourceText.value = "";
    sourceSha.value = undefined;
    ensureSlots();
  },
  { immediate: true },
);

onMounted(async () => {
  try {
    templates.value = await listTemplates(props.client);
    clearError();
  } catch (e) {
    reportError(e, "Couldn't load templates.");
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="card p-4">
    <h2 class="mb-3 border-b border-[var(--border)] pb-3 text-sm font-semibold text-zinc-900">
      Template
    </h2>

    <div v-if="loading" class="space-y-3">
      <div class="skeleton h-4 w-20" />
      <div class="skeleton h-9 w-full" />
    </div>

    <template v-else>
      <label class="mb-1.5 block text-xs font-semibold text-zinc-600" for="tpl-preset">Template</label>
      <select id="tpl-preset" v-model="presetModel" :class="inputCls">
        <option value="">None — default page</option>
        <option v-for="t in templates" :key="t.name" :value="t.name">{{ t.label }}</option>
      </select>
      <p v-if="selected?.description" class="mt-1.5 text-xs text-zinc-500">
        {{ selected.description }}
      </p>
      <p v-else-if="!templates.length" class="mt-1.5 text-xs text-zinc-500">
        No templates found in <code>templates/</code>. An agent can add one — see
        docs/authoring-templates.md.
      </p>

      <template v-if="selected">
        <!-- The template's editable fields → the page's `slots`. -->
        <div class="mt-4 border-t border-[var(--border)] pt-4">
          <FieldForm
            :fields="selected.fields"
            :data="slotsData"
            :client="client"
            :locale="locale"
            dense
          />
        </div>

        <!-- Power-user: edit the shared design HTML. -->
        <details class="mt-4 border-t border-[var(--border)] pt-3" @toggle="onToggleSource">
          <summary class="cursor-pointer text-xs font-semibold text-zinc-600">
            Advanced — edit template HTML
          </summary>
          <p class="mt-2 text-xs text-zinc-500">
            Edits the shared design for <b>every</b> page using “{{ selected.label }}”.
            Saved on its own, separate from this page.
          </p>
          <div v-if="sourceLoading" class="skeleton mt-2 h-40 w-full" />
          <template v-else-if="sourceSha !== undefined">
            <textarea
              v-model="sourceText"
              rows="14"
              spellcheck="false"
              :class="[inputCls, 'mt-2 resize-y font-mono text-xs']"
            />
            <div class="mt-2 flex justify-end">
              <SaveButton
                :action="saveSource"
                @saved="clearError"
                @error="(e) => reportError(e, 'Template save failed.')"
              />
            </div>
          </template>
        </details>
      </template>
    </template>
  </div>
</template>
