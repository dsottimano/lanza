<script setup lang="ts">
// The `list` widget. Three shapes, decided by the schema field:
//   - field.types  => typed variants (page blocks); each item carries `type`
//   - field.fields => object items (menu items, redirects, gallery images)
//   - neither      => plain string items (organization.sameAs)
import { computed, ref } from "vue";
import type { Field, Variant } from "../schema";
import FieldInput from "./FieldInput.vue";

const props = defineProps<{ field: Field }>();
const model = defineModel<any[]>();

// Initialise the array once, at setup — never mutate reactive state in render.
if (!Array.isArray(model.value)) model.value = [];
const items = computed<any[]>(() => model.value as any[]);

const isScalar = computed(() => !props.field.fields && !props.field.types);
const singular = computed(() => props.field.labelSingular ?? "Item");
const addMenu = ref(false);

function blankFromFields(fields: Field[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const f of fields) if (f.default !== undefined) obj[f.name] = f.default;
  return obj;
}

function add() {
  if (isScalar.value) items.value.push("");
  else if (props.field.fields) items.value.push(blankFromFields(props.field.fields));
}

function addVariant(v: Variant) {
  items.value.push({ type: v.name, ...blankFromFields(v.fields) });
  addMenu.value = false;
}

function variantOf(item: any): Variant | undefined {
  return props.field.types?.find((v) => v.name === item?.type);
}

function remove(i: number) {
  items.value.splice(i, 1);
}
function move(i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= items.value.length) return;
  const [it] = items.value.splice(i, 1);
  items.value.splice(j, 0, it);
}
</script>

<template>
  <div class="list">
    <div v-for="(item, i) in items" :key="i" class="item">
      <div class="itemhead">
        <span class="badge">{{ variantOf(item)?.label ?? `${singular} ${i + 1}` }}</span>
        <div class="ctrls">
          <button type="button" :disabled="i === 0" @click="move(i, -1)" title="Move up">↑</button>
          <button type="button" :disabled="i === items.length - 1" @click="move(i, 1)" title="Move down">↓</button>
          <button type="button" class="del" @click="remove(i)" title="Remove">✕</button>
        </div>
      </div>

      <!-- scalar string item -->
      <input v-if="isScalar" type="text" v-model="items[i]" />

      <!-- typed variant item -->
      <template v-else-if="variantOf(item)">
        <FieldInput
          v-for="f in variantOf(item)!.fields"
          :key="f.name"
          :field="f"
          v-model="item[f.name]"
        />
      </template>

      <!-- object item -->
      <template v-else-if="field.fields">
        <FieldInput
          v-for="f in field.fields"
          :key="f.name"
          :field="f"
          v-model="item[f.name]"
        />
      </template>
    </div>

    <!-- add control: variant picker when typed, plain add otherwise -->
    <div v-if="field.types" class="addwrap">
      <button type="button" class="add" @click="addMenu = !addMenu">+ Add {{ singular.toLowerCase() }}</button>
      <div v-if="addMenu" class="menu">
        <button v-for="v in field.types" :key="v.name" type="button" @click="addVariant(v)">
          {{ v.label }}
        </button>
      </div>
    </div>
    <button v-else type="button" class="add" @click="add">+ Add {{ singular.toLowerCase() }}</button>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.item {
  border: 1px solid #e6e6e6;
  border-radius: 8px;
  padding: 0.7rem 0.8rem 0.2rem;
  background: #fafafa;
}
.itemhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.6rem;
}
.badge {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #777;
}
.ctrls {
  display: flex;
  gap: 0.25rem;
}
.ctrls button {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 5px;
  width: 1.7rem;
  height: 1.7rem;
  cursor: pointer;
  color: #555;
}
.ctrls button:disabled {
  opacity: 0.35;
  cursor: default;
}
.del {
  color: #c0392b !important;
}
.addwrap {
  position: relative;
}
.add {
  align-self: flex-start;
  border: 1px dashed #ccc;
  background: #fff;
  border-radius: 7px;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
  color: #444;
  font: inherit;
}
.menu {
  position: absolute;
  z-index: 10;
  margin-top: 0.3rem;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  min-width: 12rem;
  overflow: hidden;
}
.menu button {
  text-align: left;
  border: none;
  background: none;
  padding: 0.55rem 0.8rem;
  cursor: pointer;
  font: inherit;
}
.menu button:hover {
  background: #f3f3f3;
}
</style>
