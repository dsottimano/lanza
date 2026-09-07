<script setup lang="ts">
// Renders ONE schema field bound to its value via v-model. Recursive: `object`
// renders nested FieldInput per sub-field; `list`/`relation` delegate to the
// dedicated components. Scalars render native inputs.
import { computed, ref, useId, watch, nextTick, onUnmounted } from "vue";
import type { Field } from "../schema";
import ListInput from "./ListInput.vue";
import RelationInput from "./RelationInput.vue";
import ImageInput from "./ImageInput.vue";
import { inputCls } from "./styles";
import { childPath } from "./field-paths";

const props = defineProps<{
  field: Field;
  inlineObject?: boolean;
  // This field's path within the form's data (`cards.0.heading`). Stamped on the root
  // element as `data-field-path` so ONE delegated focus listener up in FieldRows can
  // tell the preview which region to bring into view — no per-input handlers, and the
  // nested case answers correctly because `closest` finds the innermost stamp.
  // Optional: an unstamped subtree simply reports no field.
  path?: string;
}>();
const model = defineModel<any>();
const inputId = useId();
const textarea = ref<HTMLTextAreaElement>();
function grow() {
  const el = textarea.value;
  if (!el || !el.clientWidth) return;
  el.style.height = "auto";
  el.style.height = `${Math.max(96, el.scrollHeight + 2)}px`;
}
watch([model, textarea], () => nextTick(grow), { flush: "post" });
let observedWidth = 0;
let resizeFrame = 0;
const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
  const width = entries[0]?.contentRect.width ?? 0;
  if (width && width !== observedWidth) {
    observedWidth = width;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(grow);
  }
});
watch(textarea, (el, previous) => {
  if (previous) resizeObserver?.unobserve(previous);
  if (el) resizeObserver?.observe(el);
});
onUnmounted(() => {
  resizeObserver?.disconnect();
  cancelAnimationFrame(resizeFrame);
});

const isRequired = computed(() => props.field.required !== false);

// datetime-local <-> ISO string. Stored value stays an ISO string.
function isoToLocal(v: unknown): string {
  if (!(v instanceof Date) && (typeof v !== "string" || !v)) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const localDate = computed({
  get: () => isoToLocal(model.value),
  set: (v: string) => {
    const date = new Date(v);
    model.value = v && !isNaN(date.getTime()) ? date.toISOString() : "";
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

// Missing objects render empty without mutating the document on mount.
const objModel = computed<Record<string, unknown>>(() =>
  model.value && typeof model.value === "object" && !Array.isArray(model.value) ? model.value : {});
function setSubValue(name: string, value: unknown) {
  model.value = { ...objModel.value, [name]: value };
}

const open = ref(props.field.collapsed !== true);

// For the `list` outer container: the item count + a singular noun for the label.
const itemCount = computed(() => (Array.isArray(model.value) ? model.value.length : 0));
const singular = computed(() => (props.field.labelSingular ?? "item").toLowerCase());
</script>

<template>
  <!-- object: a collapsible group of nested fields -->
  <fieldset
    v-if="field.widget === 'object'"
    class="mb-4 min-w-0"
    :class="inlineObject ? 'field-object-inline' : 'rounded-xl border border-[var(--border)] px-3.5'"
    :data-field-path="path"
  >
    <legend v-if="!inlineObject" class="max-w-full">
      <button type="button" class="flex items-center gap-1.5 py-2.5 text-left text-xs font-semibold text-zinc-700"
        :aria-expanded="open" @click="open = !open">
      <span class="inline-block transition-transform" :class="{ 'rotate-90': open }">▸</span>
      {{ field.label }}
      </button>
    </legend>
    <!-- v-if (not v-show): keeping the nested recursive FieldInputs mounted under
         a v-show triggers a Vue 3.5 dev-mode unmount crash ("Cannot destructure
         property 'type' of 'vnode'") when this view is torn down on a collection
         switch. v-if gives the subtree its own block boundary and avoids it.
         Collapsed values are safe — they live in the model object, not the DOM. -->
    <legend v-else class="sr-only">{{ field.label }}</legend>
    <div v-if="inlineObject || open" class="pb-1">
      <FieldInput
        v-for="sub in field.fields"
        :key="sub.name"
        :field="sub"
        :path="childPath(path, sub.name)"
        :model-value="objModel[sub.name]"
        @update:model-value="setSubValue(sub.name, $event)"
      />
    </div>
  </fieldset>

  <!-- list: a labelled OUTER container makes the array read as a repeating group
       (a tinted, accent-edged box) with its item cards nested inside. -->
  <div v-else-if="field.widget === 'list'" class="mb-4" :data-field-path="path">
    <div class="rounded-xl border border-[var(--border)] border-l-[3px] border-l-[var(--accent)] bg-[var(--surface)]/50 p-3">
      <div class="mb-2.5 flex items-baseline justify-between gap-2">
        <label class="text-xs font-bold tracking-wide text-zinc-600 uppercase">{{ field.label }}</label>
        <span class="text-[0.7rem] whitespace-nowrap text-zinc-400">
          {{ itemCount }} {{ itemCount === 1 ? singular : `${singular}s` }}
        </span>
      </div>
      <ListInput :field="field" :path="path" v-model="model" />
    </div>
    <p v-if="field.hint" class="mt-1.5 text-xs text-zinc-500">{{ field.hint }}</p>
  </div>

  <!-- relation: pick slug(s) from a target collection -->
  <div v-else-if="field.widget === 'relation'" class="mb-4" :data-field-path="path">
    <label :id="`${inputId}-label`" :for="inputId" class="mb-1.5 block text-xs font-semibold text-zinc-600">{{ field.label }}</label>
    <RelationInput :field="field" :input-id="inputId" v-model="model" />
    <p v-if="field.hint" class="mt-1.5 text-xs text-zinc-500">{{ field.hint }}</p>
  </div>

  <!-- scalar widgets -->
  <div v-else class="mb-4" :data-field-path="path">
    <label class="mb-1.5 block text-xs font-semibold text-zinc-600" :for="inputId">{{ field.label }}</label>

    <textarea
      v-if="field.widget === 'text'"
      ref="textarea"
      @input="grow"
      @focus="grow"
      :id="inputId"
      v-model="model"
      rows="3"
      :required="isRequired"
      :class="[inputCls, 'resize-y']"
    />

    <input
      v-else-if="field.widget === 'datetime'"
      :id="inputId"
      type="datetime-local"
      v-model="localDate"
      :class="inputCls"
    />

    <label v-else-if="field.widget === 'boolean'" class="flex cursor-pointer items-center gap-2">
      <input type="checkbox" v-model="model" :id="inputId" class="size-4 rounded border-zinc-300 accent-zinc-900" />
      <span class="text-sm text-zinc-500">{{ model ? "Yes" : "No" }}</span>
    </label>

    <input
      v-else-if="field.widget === 'number'"
      :id="inputId"
      type="number"
      :value="model"
      :class="inputCls"
      @input="onNumber"
    />

    <select
      v-else-if="field.widget === 'select'"
      :id="inputId"
      v-model="model"
      :multiple="field.multiple"
      :class="inputCls"
    >
      <option v-if="!field.multiple && !isRequired" :value="undefined">—</option>
      <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
    </select>

    <ImageInput v-else-if="field.widget === 'image'" :input-id="inputId" v-model="model" />

    <!-- string (default) -->
    <input v-else :id="inputId" type="text" v-model="model" :required="isRequired" :class="inputCls" />

    <p v-if="field.hint" class="mt-1.5 text-xs text-zinc-500">{{ field.hint }}</p>
  </div>
</template>
