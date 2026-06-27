<script setup lang="ts">
// Renders ONE schema field bound to its value via v-model. Recursive: `object`
// renders nested FieldInput per sub-field; `list`/`relation` delegate to the
// dedicated components. Scalars render native inputs.
import { computed, ref } from "vue";
import type { Field } from "../schema";
import ListInput from "./ListInput.vue";
import RelationInput from "./RelationInput.vue";
import ImageInput from "./ImageInput.vue";

const props = defineProps<{ field: Field }>();
const model = defineModel<any>();

const isRequired = computed(() => props.field.required !== false);

// Shared control styling (text / number / datetime / select / image inputs).
const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 transition placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-900/5";

// datetime-local <-> ISO string. Stored value stays an ISO string.
function isoToLocal(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const localDate = computed({
  get: () => isoToLocal(model.value),
  set: (v: string) => {
    model.value = v ? new Date(v).toISOString() : "";
  },
});

function onNumber(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  if (raw === "") {
    model.value = undefined;
    return;
  }
  model.value = props.field.valueType === "int" ? parseInt(raw, 10) : parseFloat(raw);
}

// `object` sub-values live on a plain object under the field name. Initialise
// the shape once, at setup — never mutate reactive state during render.
if (
  props.field.widget === "object" &&
  (typeof model.value !== "object" || model.value === null || Array.isArray(model.value))
) {
  model.value = {};
}
function objVal(): Record<string, unknown> {
  return model.value as Record<string, unknown>;
}

const open = ref(props.field.collapsed !== true);
</script>

<template>
  <!-- object: a collapsible group of nested fields -->
  <fieldset v-if="field.widget === 'object'" class="mb-4 rounded-xl border border-zinc-200 px-3.5">
    <legend
      class="flex cursor-pointer items-center gap-1.5 py-2.5 text-xs font-bold tracking-wide text-zinc-700 uppercase select-none"
      @click="open = !open"
    >
      <span class="inline-block transition-transform" :class="{ 'rotate-90': open }">▸</span>
      {{ field.label }}
    </legend>
    <div v-show="open" class="pb-1">
      <FieldInput
        v-for="sub in field.fields"
        :key="sub.name"
        :field="sub"
        v-model="objVal()[sub.name]"
      />
    </div>
  </fieldset>

  <!-- list: handled by the dedicated array editor -->
  <div v-else-if="field.widget === 'list'" class="mb-4">
    <label class="mb-1.5 block text-xs font-semibold text-zinc-600">{{ field.label }}</label>
    <ListInput :field="field" v-model="model" />
    <p v-if="field.hint" class="mt-1.5 text-xs text-zinc-400">{{ field.hint }}</p>
  </div>

  <!-- relation: pick slug(s) from a target collection -->
  <div v-else-if="field.widget === 'relation'" class="mb-4">
    <label class="mb-1.5 block text-xs font-semibold text-zinc-600">{{ field.label }}</label>
    <RelationInput :field="field" v-model="model" />
    <p v-if="field.hint" class="mt-1.5 text-xs text-zinc-400">{{ field.hint }}</p>
  </div>

  <!-- scalar widgets -->
  <div v-else class="mb-4">
    <label class="mb-1.5 block text-xs font-semibold text-zinc-600" :for="field.name">{{ field.label }}</label>

    <textarea
      v-if="field.widget === 'text'"
      :id="field.name"
      v-model="model"
      rows="3"
      :required="isRequired"
      :class="[inputCls, 'resize-y']"
    />

    <input
      v-else-if="field.widget === 'datetime'"
      :id="field.name"
      type="datetime-local"
      v-model="localDate"
      :class="inputCls"
    />

    <label v-else-if="field.widget === 'boolean'" class="flex cursor-pointer items-center gap-2">
      <input type="checkbox" v-model="model" class="size-4 rounded border-zinc-300 accent-zinc-900" />
      <span class="text-sm text-zinc-500">{{ model ? "Yes" : "No" }}</span>
    </label>

    <input
      v-else-if="field.widget === 'number'"
      :id="field.name"
      type="number"
      :value="model"
      :class="inputCls"
      @input="onNumber"
    />

    <select
      v-else-if="field.widget === 'select'"
      :id="field.name"
      v-model="model"
      :multiple="field.multiple"
      :class="inputCls"
    >
      <option v-if="!field.multiple && !isRequired" :value="undefined">—</option>
      <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
    </select>

    <ImageInput v-else-if="field.widget === 'image'" v-model="model" />

    <!-- string (default) -->
    <input v-else :id="field.name" type="text" v-model="model" :required="isRequired" :class="inputCls" />

    <p v-if="field.hint" class="mt-1.5 text-xs text-zinc-400">{{ field.hint }}</p>
  </div>
</template>
