<script setup lang="ts">
// Editor for ONE frontmatter field of a content type. Edits the field object in
// place (it is the same reactive object the parent holds), so top-level props
// change while any nested `fields` / `types` / `collapsed` on complex widgets are
// left completely untouched — never dropped or corrupted.
//
// Two things are deliberately locked:
//   • the `title` field — the CMS chrome promotes it, so its name/widget/removal
//     are frozen (a folder collection must always keep a title).
//   • `object` / `list` widgets — they carry nested structure this v1 editor does
//     not descend into, so the widget can't be switched away (which would orphan
//     the nested `fields`/`types`). Their name/label/required/hint stay editable.
//
// v2 TODO: a nested-field editor for object.fields and list.fields / list.types.
import { computed } from "vue";
import type { Field, Widget } from "../../schema";

const props = defineProps<{
  field: Field;
  isTitle: boolean;
  folderNames: string[]; // relation targets (all folder collections, incl. self)
  error?: string; // name validation message from the parent
  canMoveUp: boolean;
  canMoveDown: boolean;
}>();

const emit = defineEmits<{
  (e: "remove"): void;
  (e: "moveUp"): void;
  (e: "moveDown"): void;
  (e: "change"): void;
}>();

const WIDGETS: Widget[] = [
  "string",
  "text",
  "datetime",
  "boolean",
  "number",
  "image",
  "select",
  "relation",
  "object",
  "list",
];

// object / list carry nested fields/types — lock the widget so we can't orphan them.
const hasNested = computed(() => props.field.widget === "object" || props.field.widget === "list");
const nestedCount = computed(() => {
  const f = props.field;
  if (f.widget === "object") return f.fields?.length ?? 0;
  if (f.widget === "list") return f.fields?.length ?? f.types?.length ?? 0;
  return 0;
});
const nestedKind = computed(() =>
  props.field.widget === "list" && props.field.types ? "variant type(s)" : "sub-field(s)",
);

const widgetLocked = computed(() => props.isTitle || hasNested.value);

// A default only makes sense (and only serializes safely) for these widgets.
const showDefault = computed(() =>
  ["string", "text", "datetime", "select", "number", "boolean"].includes(props.field.widget),
);

function setValueType(e: Event) {
  props.field.valueType = (e.target as HTMLSelectElement).value as "int" | "float";
  emit("change");
}

// Typed views over the loosely-typed `default` (unknown) so v-model stays clean.
const defBool = computed<boolean>({
  get: () => props.field.default === true,
  set: (v) => {
    props.field.default = v;
    emit("change");
  },
});
const defStr = computed<string>({
  get: () => (props.field.default == null ? "" : String(props.field.default)),
  set: (v) => {
    props.field.default = v;
    emit("change");
  },
});
function onDefaultNumber(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  props.field.default = raw === "" ? undefined : props.field.valueType === "int" ? parseInt(raw, 10) : parseFloat(raw);
  emit("change");
}

// ── select options (editable string list) ──
function ensureOptions(): string[] {
  if (!Array.isArray(props.field.options)) props.field.options = [];
  return props.field.options;
}
function addOption() {
  ensureOptions().push("");
  emit("change");
}
function removeOption(i: number) {
  ensureOptions().splice(i, 1);
  emit("change");
}
</script>

<template>
  <div class="rounded-xl border border-[var(--border)] bg-[var(--paper-card)] p-3.5">
    <!-- row header: name + reorder + remove -->
    <div class="flex items-center gap-2">
      <input
        v-model="field.name"
        :readonly="isTitle"
        placeholder="field_name"
        class="input font-mono text-xs"
        :class="{ 'opacity-70': isTitle }"
        @input="emit('change')"
      />
      <div class="flex flex-shrink-0 items-center gap-1">
        <button
          class="grid size-7 place-items-center rounded-md text-zinc-400 transition enabled:hover:bg-[var(--surface)] enabled:hover:text-zinc-800 disabled:opacity-30"
          title="Move up"
          :disabled="!canMoveUp"
          @click="emit('moveUp')"
        >
          ↑
        </button>
        <button
          class="grid size-7 place-items-center rounded-md text-zinc-400 transition enabled:hover:bg-[var(--surface)] enabled:hover:text-zinc-800 disabled:opacity-30"
          title="Move down"
          :disabled="!canMoveDown"
          @click="emit('moveDown')"
        >
          ↓
        </button>
        <button
          v-if="!isTitle"
          class="grid size-7 place-items-center rounded-md text-zinc-400 transition hover:bg-[var(--surface)] hover:text-red-600"
          title="Remove field"
          @click="emit('remove')"
        >
          ✕
        </button>
        <span v-else class="px-1 text-[0.65rem] font-semibold tracking-wide text-zinc-400 uppercase">Title</span>
      </div>
    </div>

    <p v-if="error" class="mt-1.5 text-xs font-medium text-red-600">{{ error }}</p>

    <!-- label + widget -->
    <div class="mt-3 grid gap-3 sm:grid-cols-2">
      <label class="block">
        <span class="mb-1 block text-xs font-semibold text-zinc-600">Label</span>
        <input v-model="field.label" class="input" @input="emit('change')" />
      </label>
      <label class="block">
        <span class="mb-1 block text-xs font-semibold text-zinc-600">Widget</span>
        <select v-model="field.widget" :disabled="widgetLocked" class="input" @change="emit('change')">
          <option v-for="w in WIDGETS" :key="w" :value="w">{{ w }}</option>
        </select>
      </label>
    </div>

    <p v-if="hasNested" class="mt-2 text-xs text-zinc-500">
      Holds {{ nestedCount }} {{ nestedKind }}, preserved as-is. Nested editing isn't available yet — edit the
      structure via schema.json.
    </p>

    <!-- required + hint -->
    <div class="mt-3 grid gap-3 sm:grid-cols-2">
      <label v-if="!isTitle" class="flex items-center gap-2 pt-6">
        <input type="checkbox" v-model="field.required" class="size-4 rounded border-zinc-300 accent-zinc-900" @change="emit('change')" />
        <span class="text-sm text-zinc-600">Required</span>
      </label>
      <div v-else class="pt-6 text-sm text-zinc-400">Always required</div>
      <label class="block">
        <span class="mb-1 block text-xs font-semibold text-zinc-600">Hint</span>
        <input v-model="field.hint" class="input" placeholder="Optional helper text" @input="emit('change')" />
      </label>
    </div>

    <!-- widget-specific -->
    <div v-if="field.widget === 'number'" class="mt-3">
      <label class="block sm:w-1/2">
        <span class="mb-1 block text-xs font-semibold text-zinc-600">Number type</span>
        <select :value="field.valueType ?? 'int'" class="input" @change="setValueType">
          <option value="int">Integer</option>
          <option value="float">Decimal</option>
        </select>
      </label>
    </div>

    <div v-else-if="field.widget === 'relation'" class="mt-3 grid gap-3 sm:grid-cols-2">
      <label class="block">
        <span class="mb-1 block text-xs font-semibold text-zinc-600">Related content type</span>
        <select v-model="field.collection" class="input" @change="emit('change')">
          <option v-for="n in folderNames" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
      <label class="flex items-center gap-2 pt-6">
        <input type="checkbox" v-model="field.multiple" class="size-4 rounded border-zinc-300 accent-zinc-900" @change="emit('change')" />
        <span class="text-sm text-zinc-600">Allow multiple</span>
      </label>
    </div>

    <div v-else-if="field.widget === 'select'" class="mt-3">
      <span class="mb-1 block text-xs font-semibold text-zinc-600">Options</span>
      <div class="flex flex-col gap-1.5">
        <div v-for="(_, i) in field.options || []" :key="i" class="flex items-center gap-2">
          <input v-model="field.options![i]" class="input" placeholder="value" @input="emit('change')" />
          <button
            class="grid size-8 flex-shrink-0 place-items-center rounded-md text-zinc-400 transition hover:bg-[var(--surface)] hover:text-red-600"
            title="Remove option"
            @click="removeOption(i)"
          >
            ✕
          </button>
        </div>
      </div>
      <button class="btn btn-ghost mt-2 text-xs" @click="addOption">+ Add option</button>
    </div>

    <!-- default -->
    <div v-if="showDefault" class="mt-3">
      <label class="block sm:w-1/2">
        <span class="mb-1 block text-xs font-semibold text-zinc-600">Default</span>
        <label v-if="field.widget === 'boolean'" class="flex items-center gap-2 pt-1.5">
          <input type="checkbox" v-model="defBool" class="size-4 rounded border-zinc-300 accent-zinc-900" />
          <span class="text-sm text-zinc-500">{{ defBool ? "Yes" : "No" }}</span>
        </label>
        <input
          v-else-if="field.widget === 'number'"
          type="number"
          :value="field.default"
          class="input"
          @input="onDefaultNumber"
        />
        <select v-else-if="field.widget === 'select'" v-model="defStr" class="input">
          <option value="">—</option>
          <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <input v-else v-model="defStr" class="input" />
      </label>
    </div>
  </div>
</template>
