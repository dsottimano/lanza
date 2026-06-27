<script setup lang="ts">
// Renders ONE schema field bound to its value via v-model. Recursive: `object`
// renders nested FieldInput per sub-field; `list`/`relation` delegate to the
// dedicated components. Scalars render native inputs.
import { computed, ref } from "vue";
import type { Field } from "../schema";
import ListInput from "./ListInput.vue";
import RelationInput from "./RelationInput.vue";

const props = defineProps<{ field: Field }>();
const model = defineModel<any>();

const isRequired = computed(() => props.field.required !== false);

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

const showImagePreview = computed(
  () => typeof model.value === "string" && /^(https?:\/\/|\/)/.test(model.value),
);

const open = ref(props.field.collapsed !== true);
</script>

<template>
  <!-- object: a collapsible group of nested fields -->
  <fieldset v-if="field.widget === 'object'" class="group">
    <legend class="grouphead" @click="open = !open">
      <span class="caret" :class="{ open }">▸</span> {{ field.label }}
    </legend>
    <div v-show="open" class="groupbody">
      <FieldInput
        v-for="sub in field.fields"
        :key="sub.name"
        :field="sub"
        v-model="objVal()[sub.name]"
      />
    </div>
  </fieldset>

  <!-- list: handled by the dedicated array editor -->
  <div v-else-if="field.widget === 'list'" class="row">
    <label class="lbl">{{ field.label }}</label>
    <ListInput :field="field" v-model="model" />
    <p v-if="field.hint" class="hint">{{ field.hint }}</p>
  </div>

  <!-- relation: pick slug(s) from a target collection -->
  <div v-else-if="field.widget === 'relation'" class="row">
    <label class="lbl">{{ field.label }}</label>
    <RelationInput :field="field" v-model="model" />
    <p v-if="field.hint" class="hint">{{ field.hint }}</p>
  </div>

  <!-- scalar widgets -->
  <div v-else class="row">
    <label class="lbl" :for="field.name">{{ field.label }}</label>

    <textarea
      v-if="field.widget === 'text'"
      :id="field.name"
      v-model="model"
      rows="3"
      :required="isRequired"
    />

    <input
      v-else-if="field.widget === 'datetime'"
      :id="field.name"
      type="datetime-local"
      v-model="localDate"
    />

    <label v-else-if="field.widget === 'boolean'" class="check">
      <input type="checkbox" v-model="model" />
      <span class="muted">{{ model ? "Yes" : "No" }}</span>
    </label>

    <input
      v-else-if="field.widget === 'number'"
      :id="field.name"
      type="number"
      :value="model"
      @input="onNumber"
    />

    <select
      v-else-if="field.widget === 'select'"
      :id="field.name"
      v-model="model"
      :multiple="field.multiple"
    >
      <option v-if="!field.multiple && !isRequired" :value="undefined">—</option>
      <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
    </select>

    <template v-else-if="field.widget === 'image'">
      <input
        :id="field.name"
        type="text"
        v-model="model"
        placeholder="/images/uploads/… or https://…"
      />
      <img v-if="showImagePreview" :src="model" class="preview" alt="" />
    </template>

    <!-- string (default) -->
    <input v-else :id="field.name" type="text" v-model="model" :required="isRequired" />

    <p v-if="field.hint" class="hint">{{ field.hint }}</p>
  </div>
</template>

<style scoped>
.row {
  margin-bottom: 1rem;
}
.lbl {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: #444;
  margin-bottom: 0.3rem;
}
input[type="text"],
input[type="number"],
input[type="datetime-local"],
textarea,
select {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.6rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font: inherit;
  background: #fff;
  color: #1a1a1a;
}
textarea {
  resize: vertical;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
}
.check input {
  width: auto;
}
.hint {
  margin: 0.3rem 0 0;
  font-size: 0.75rem;
  color: #999;
}
.muted {
  color: #888;
  font-size: 0.85rem;
}
.preview {
  display: block;
  max-width: 100%;
  max-height: 120px;
  margin-top: 0.5rem;
  border-radius: 6px;
}
.group {
  border: 1px solid #e6e6e6;
  border-radius: 8px;
  padding: 0 0.9rem;
  margin: 0 0 1rem;
}
.grouphead {
  font-size: 0.8rem;
  font-weight: 700;
  color: #333;
  cursor: pointer;
  padding: 0.6rem 0;
  user-select: none;
}
.caret {
  display: inline-block;
  transition: transform 0.12s;
}
.caret.open {
  transform: rotate(90deg);
}
.groupbody {
  padding-bottom: 0.4rem;
}
</style>
