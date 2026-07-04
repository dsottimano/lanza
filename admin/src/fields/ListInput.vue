<script setup lang="ts">
// The `list` widget. Three shapes, decided by the schema field:
//   - field.types  => typed variants (page blocks); each item carries `type`
//   - field.fields => object items (menu items, redirects, gallery images)
//   - neither      => plain string items (organization.sameAs)
import { computed, ref } from "vue";
import type { Field, Variant } from "../schema";
import FieldInput from "./FieldInput.vue";
import { inputCls } from "./styles";

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
  <div class="flex flex-col gap-2.5">
    <div v-for="(item, i) in items" :key="i" class="rounded-xl border border-[var(--border)] bg-[var(--paper-card)] p-3">
      <div class="mb-2.5 flex items-center justify-between">
        <span class="text-[0.7rem] font-bold tracking-wide text-zinc-500 uppercase">
          {{ variantOf(item)?.label ?? `${singular} ${i + 1}` }}
        </span>
        <div class="flex gap-1">
          <button
            type="button"
            :disabled="i === 0"
            class="size-7 rounded-md border border-[var(--border)] bg-[var(--surface)] text-zinc-500 transition hover:text-zinc-900 disabled:opacity-35 disabled:hover:text-zinc-500"
            title="Move up"
            @click="move(i, -1)"
          >↑</button>
          <button
            type="button"
            :disabled="i === items.length - 1"
            class="size-7 rounded-md border border-[var(--border)] bg-[var(--surface)] text-zinc-500 transition hover:text-zinc-900 disabled:opacity-35 disabled:hover:text-zinc-500"
            title="Move down"
            @click="move(i, 1)"
          >↓</button>
          <button
            type="button"
            class="size-7 rounded-md border border-[var(--border)] bg-[var(--surface)] text-rose-500 transition hover:bg-rose-50"
            title="Remove"
            @click="remove(i)"
          >✕</button>
        </div>
      </div>

      <!-- scalar string item -->
      <input
        v-if="isScalar"
        type="text"
        v-model="items[i]"
        :class="inputCls"
      />

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
    <div v-if="field.types" class="relative">
      <button type="button" class="btn btn-ghost self-start" @click="addMenu = !addMenu">
        + Add {{ singular.toLowerCase() }}
      </button>
      <div
        v-if="addMenu"
        class="glass-strong absolute z-10 mt-1.5 flex min-w-48 flex-col overflow-hidden rounded-xl"
      >
        <button
          v-for="v in field.types"
          :key="v.name"
          type="button"
          class="px-3.5 py-2.5 text-left text-sm text-zinc-700 transition hover:bg-[var(--surface)]"
          @click="addVariant(v)"
        >
          {{ v.label }}
        </button>
      </div>
    </div>
    <button v-else type="button" class="btn btn-ghost self-start" @click="add">
      + Add {{ singular.toLowerCase() }}
    </button>
  </div>
</template>
