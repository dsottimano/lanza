<script setup lang="ts">
import SettingsHeader from "./SettingsHeader.vue";
// Settings → Content types. Define the CMS's folder collections and the fields
// (templates) each entry is edited with. Master-detail: a rail of content types
// on the left, the selected type's settings + field list on the right.
//
// The live model (schema.ts COLLECTIONS) is deep-cloned into local editable
// state on mount — nothing touches the live store until Save, which commits
// data/schema.json AND applies the change in place (backend/schema.ts).
//
// Scope (v1): folder collections only. The system "settings" files collection is
// carried through untouched but never shown. Nested object.fields / list.types
// are preserved but not editable here (see FieldEditor's v2 TODO).
import { computed, onUnmounted, reactive, ref } from "vue";
import { GitHubClient } from "../backend/github";
import {
  COLLECTIONS,
  type Collection,
  type FolderCollection,
  type Field,
} from "../schema";
import { saveSchema } from "../backend/schema";
import SaveButton from "./SaveButton.vue";
import FieldEditor from "./content-types/FieldEditor.vue";
import EditingExperience from "./content-types/EditingExperience.vue";
import { reportError, clearError } from "../errors";
import { isDirty } from "./dirty";

const props = defineProps<{ client: GitHubClient }>();
const emit = defineEmits<{ (e: "back"): void }>();

const SLUG = /^[a-z0-9-]+$/;
// Stored field keys include camelCase (featuredImage) and underscores. They
// are identifiers, not URL slugs, and must not be renamed to pass validation.
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// Deep clone the live model (plain JSON — no reactivity/proxy leakage), then make
// the clone reactive for editing. Folder fields get an explicit `required`
// boolean for clean v-model binding; it's normalized back out on save.
const collections = reactive<Collection[]>(JSON.parse(JSON.stringify(COLLECTIONS)));
for (const c of collections) {
  if (c.kind !== "folder") continue;
  for (const f of c.fields) f.required = f.required !== false;
}

const folderTypes = computed(() =>
  collections.filter((c): c is FolderCollection => c.kind === "folder"),
);
const folderNames = computed(() => folderTypes.value.map((t) => t.name));

const selectedName = ref<string | null>(folderTypes.value[0]?.name ?? null);
const selected = computed(() => folderTypes.value.find((t) => t.name === selectedName.value) ?? null);

const markDirty = () => (isDirty.value = true);
onUnmounted(() => (isDirty.value = false));

function select(name: string) {
  selectedName.value = name;
  creating.value = false;
}

// ── field name validation (per type) ─────────────────────────────────────────
function fieldError(type: FolderCollection, i: number): string {
  const f = type.fields[i];
  if (!f.name.trim()) return "Field name is required.";
  if (!FIELD_NAME.test(f.name)) return "Start with a letter or underscore; use letters, numbers, underscores or hyphens.";
  if (type.fields.some((o, j) => j !== i && o.name === f.name)) return `Duplicate field name "${f.name}".`;
  return "";
}

// Global validity — gates the Save button. Every folder type must be internally
// consistent and keep a title field.
const problems = computed<string[]>(() => {
  const out: string[] = [];
  for (const t of folderTypes.value) {
    if (!t.fields.some((f) => f.name === "title")) out.push(`"${t.label}" must keep a title field.`);
    t.fields.forEach((_, i) => {
      const e = fieldError(t, i);
      if (e) out.push(`${t.label} → ${t.fields[i].label || t.fields[i].name || 'New field'}: ${e}`);
    });
  }
  return out;
});
const valid = computed(() => problems.value.length === 0);

// ── field operations (mutate the selected type in place) ─────────────────────
function addField() {
  selected.value?.fields.push({ name: "", label: "", widget: "string", required: true });
  markDirty();
}
function removeField(i: number) {
  const t = selected.value;
  if (!t) return;
  if (t.fields[i].name === "title") return; // guarded in the UI too
  t.fields.splice(i, 1);
  markDirty();
}
function moveField(i: number, dir: -1 | 1) {
  const t = selected.value;
  if (!t) return;
  const j = i + dir;
  if (j < 0 || j >= t.fields.length) return;
  const [f] = t.fields.splice(i, 1);
  t.fields.splice(j, 0, f);
  markDirty();
}

// ── add / delete a content type ──────────────────────────────────────────────
const creating = ref(false);
const draft = reactive({ name: "", label: "", labelSingular: "", body: "none" as "rich" | "none", localized: false });

const newTypeError = computed(() => {
  const name = draft.name.trim();
  if (!name) return "";
  if (!SLUG.test(name)) return "Use lowercase letters, numbers and hyphens only.";
  if (collections.some((c) => c.name === name)) return `A content type named "${name}" already exists.`;
  return "";
});
const canCreate = computed(
  () => !!draft.name.trim() && !newTypeError.value && !!draft.label.trim() && !!draft.labelSingular.trim(),
);

function startCreate() {
  Object.assign(draft, { name: "", label: "", labelSingular: "", body: "none", localized: false });
  creating.value = true;
}
function createType() {
  if (!canCreate.value) return;
  const name = draft.name.trim();
  const type: FolderCollection = {
    kind: "folder",
    name,
    label: draft.label.trim(),
    labelSingular: draft.labelSingular.trim(),
    folder: `content/${name}`,
    body: draft.body,
    ...(draft.localized ? { localized: true } : {}),
    fields: [{ name: "title", label: "Title", widget: "string", required: true }],
  };
  collections.push(type);
  selectedName.value = name;
  creating.value = false;
  markDirty();
}

function deleteType(type: FolderCollection) {
  const ok = window.confirm(
    `Delete the "${type.label}" content type?\n\n` +
      `This removes it from the CMS only. Existing markdown files under ${type.folder} are NOT deleted, ` +
      `and a brand-new type won't render on the public site until a developer adds an Astro template.`,
  );
  if (!ok) return;
  const i = collections.findIndex((c) => c.name === type.name);
  if (i === -1) return;
  collections.splice(i, 1);
  if (selectedName.value === type.name) selectedName.value = folderTypes.value[0]?.name ?? null;
  markDirty();
}

// Thumbnail dropdown: bind undefined when "none" is picked.
const thumbnailModel = computed<string>({
  get: () => selected.value?.thumbnail ?? "",
  set: (v) => {
    if (!selected.value) return;
    if (v) selected.value.thumbnail = v;
    else delete selected.value.thumbnail;
    markDirty();
  },
});

// ── save ─────────────────────────────────────────────────────────────────────
// Normalize the editable clone back into clean schema shape: strip the explicit
// `required: true`, drop empty optional keys, and prune widget-specific props
// that don't apply — while leaving nested object/list structures untouched.
function cleanField(f: Field): Field {
  const out: Field = { ...f };
  if (out.required !== false) delete out.required;
  if (!out.hint) delete out.hint;
  if (out.default === undefined || out.default === "") delete out.default;
  if (out.widget !== "select") delete out.options;
  else out.options = (out.options ?? []).map((s) => s.trim()).filter(Boolean);
  if (out.widget !== "number") delete out.valueType;
  if (out.widget !== "relation") {
    delete out.collection;
    delete out.multiple;
  } else if (!out.multiple) {
    delete out.multiple;
  }
  return out;
}

function serialize(): Collection[] {
  return collections.map((c) => {
    if (c.kind !== "folder") return JSON.parse(JSON.stringify(c)) as Collection;
    const out: FolderCollection = {
      ...c,
      kind: "folder",
      name: c.name,
      label: c.label,
      labelSingular: c.labelSingular,
      folder: c.folder,
      body: c.body,
      ...(c.localized ? { localized: true } : {}),
      ...(c.thumbnail ? { thumbnail: c.thumbnail } : {}),
      fields: c.fields.map(cleanField),
    };
    return out;
  });
}

async function save() {
  if (!valid.value) return;
  await saveSchema(props.client, serialize());
  isDirty.value = false;
}
</script>

<template>
  <div class="settings-page">
    <SettingsHeader title="Content types" @back="emit('back')">
      <template #actions>
        <span v-if="isDirty" class="text-sm text-zinc-500">Unsaved changes</span>
      <SaveButton
        :action="save"
        :disabled="!valid"
        @saved="clearError"
        @error="(e) => reportError(e, 'Save failed.')"
      />
      </template>
      <template #description><p>Decide what people can create, how they edit it, and which details they fill in.</p></template>
    </SettingsHeader>

    <main class="settings-body">

      <div v-if="!valid" role="alert" class="mb-4 rounded-xl border border-amber-300/60 bg-amber-50/70 px-4 py-2.5 text-sm text-amber-800">
        Fix {{ problems.length }} issue{{ problems.length === 1 ? "" : "s" }} before saving:
        <ul class="mt-2 list-disc pl-5"><li v-for="problem in problems" :key="problem">{{ problem }}</li></ul>
      </div>

      <div class="grid gap-5 md:grid-cols-[16rem_1fr]">
        <!-- type rail -->
        <aside class="card flex h-max flex-col gap-1 p-3">
          <div v-for="t in folderTypes" :key="t.name" class="group flex items-center gap-1">
            <button
              class="nav-item min-w-0 flex-1"
              :class="{ 'nav-item--active': t.name === selectedName && !creating }"
              @click="select(t.name)"
            >
              <span class="block truncate font-medium">{{ t.label }}</span>
              <span class="block truncate font-mono text-xs" :class="t.name === selectedName && !creating ? 'text-white/60' : 'text-zinc-500'">
                {{ t.body === 'none' ? 'Field form' : t.fields.some(f => f.name === 'preset') ? 'Writing & page layouts' : 'Writing workspace' }}
              </span>
            </button>
          </div>
          <button class="btn btn-ghost mt-2 justify-center" @click="startCreate">+ New content type</button>
        </aside>

        <!-- new type form -->
        <section v-if="creating" class="card p-6">
          <h2 class="mb-4 font-serif text-xl font-semibold text-zinc-900">New content type</h2>
          <div class="grid gap-4">
            <label class="block">
              <span class="mb-1 block text-xs font-semibold text-zinc-600">Name (slug)</span>
              <input v-model="draft.name" placeholder="e.g. events" class="input font-mono" />
              <span class="mt-1 block text-xs text-zinc-500">Lowercase letters, numbers, hyphens. Sets the folder content/{{ draft.name || "…" }}.</span>
            </label>
            <p v-if="newTypeError" class="text-xs font-medium text-red-600">{{ newTypeError }}</p>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="block">
                <span class="mb-1 block text-xs font-semibold text-zinc-600">Label (plural)</span>
                <input v-model="draft.label" placeholder="Events" class="input" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs font-semibold text-zinc-600">Label (singular)</span>
                <input v-model="draft.labelSingular" placeholder="Event" class="input" />
              </label>
            </div>
            <EditingExperience v-model="draft.body" />
            <div>
              <label class="flex items-center gap-2 pt-6">
                <input type="checkbox" v-model="draft.localized" class="size-4 rounded border-zinc-300 accent-zinc-900" />
                <span class="text-sm text-zinc-600">Localized (one file per language)</span>
              </label>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn btn-primary" :disabled="!canCreate" @click="createType">Create</button>
              <button class="btn btn-ghost" @click="creating = false">Cancel</button>
            </div>
            <p class="text-xs text-zinc-500">Starts with a required Title field. Add more fields after creating.</p>
          </div>
        </section>

        <!-- selected type editor -->
        <section v-else-if="selected" class="flex flex-col gap-5">
          <div class="card p-6">
            <EditingExperience v-model="selected.body" :has-templates="selected.fields.some(f => f.name === 'preset')" @update:model-value="markDirty" />
          </div>
          <!-- type settings -->
          <div class="card p-6">
            <div class="mb-4 flex items-baseline justify-between gap-3">
              <h2 class="font-serif text-xl font-semibold text-zinc-900">{{ selected.label }}</h2>
              <code class="text-xs text-zinc-500">{{ selected.folder }}</code>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="block">
                <span class="mb-1 block text-xs font-semibold text-zinc-600">Label (plural)</span>
                <input v-model="selected.label" class="input" @input="markDirty" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs font-semibold text-zinc-600">Label (singular)</span>
                <input v-model="selected.labelSingular" class="input" @input="markDirty" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs font-semibold text-zinc-600">List thumbnail</span>
                <select v-model="thumbnailModel" class="input">
                  <option value="">None</option>
                  <option v-for="f in selected.fields" :key="f.name" :value="f.name">{{ f.label || f.name }}</option>
                </select>
              </label>
              <label class="flex items-center gap-2 sm:col-span-2">
                <input type="checkbox" v-model="selected.localized" class="size-4 rounded border-zinc-300 accent-zinc-900" @change="markDirty" />
                <span class="text-sm text-zinc-600">Localized (one file per language)</span>
              </label>
            </div>
          </div>

          <!-- fields -->
          <div class="card p-6">
            <h3 class="font-semibold text-zinc-900">Content fields <span class="text-sm font-normal text-zinc-500">· {{ selected.fields.length }}</span></h3>
            <p class="mb-4 mt-1 text-sm text-zinc-600">{{ selected.body === 'rich' ? 'Supporting details for the editor. Page sections are defined by the chosen template.' : 'These fields make up the editing form.' }} Select a field to configure it.</p>
            <div class="flex flex-col gap-3">
              <details v-for="(f, i) in selected.fields" :key="i" class="field-disclosure" :open="!f.name || !!fieldError(selected, i)">
                <summary><span class="font-medium">{{ f.label || f.name || 'New field' }}</span><span class="ml-auto text-xs text-zinc-500">{{ f.widget }}{{ f.required !== false ? ' · Required' : '' }}</span></summary>
              <FieldEditor
                :field="f"
                :is-title="f.name === 'title'"
                :folder-names="folderNames"
                :error="fieldError(selected, i)"
                :can-move-up="i > 0"
                :can-move-down="i < selected.fields.length - 1"
                @remove="removeField(i)"
                @move-up="moveField(i, -1)"
                @move-down="moveField(i, 1)"
                @change="markDirty"
              />
              </details>
            </div>
            <button class="btn btn-ghost mt-3" @click="addField">+ Add field</button>
          </div>
          <details class="card p-4 text-sm">
            <summary class="cursor-pointer text-zinc-600">Advanced settings</summary>
            <p class="my-3 text-zinc-500">Content type: {{ selected.name }} · Stored in {{ selected.folder }}</p>
            <button class="btn btn-danger" @click="deleteType(selected)">Remove content type</button>
          </details>
        </section>

        <section v-else class="card grid place-items-center p-10 text-center text-sm text-zinc-500">
          <p>Create a content type to get started.</p>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.field-disclosure { border: 1px solid var(--border); border-radius: 5px; }
.field-disclosure > summary { display: flex; align-items: center; gap: 12px; padding: 13px 14px; cursor: pointer; font-size: 14px; }
.field-disclosure > summary::before { content: '›'; color: var(--muted); }
.field-disclosure[open] > summary::before { transform: rotate(90deg); }
.field-disclosure > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
