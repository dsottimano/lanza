<script setup lang="ts">
// The rows of a form: the layout half of FieldForm, split out so the same markup serves
// both a plain run of fields and the inside of a collapsed group. It is the markup this
// form has always emitted — the two branches below are unchanged.
//
// `dense` packs compact scalars (string/number/datetime/select/boolean) two per row;
// wide widgets (text/image/object/list/relation) always span the full width. It's a
// container query (see .field-grid in styles.css), so the two-column pass only kicks in
// when the form is actually wide enough — narrow side panels stay single-column.
import type { Field } from "../schema";
import FieldInput from "./FieldInput.vue";
import { anyTouchesField, childPath, fieldPathOfTarget } from "./field-paths";

const props = defineProps<{
  fields: Field[];
  data: Record<string, unknown>;
  dense?: boolean;
  // Paths RELATIVE TO `data` that a review reports as changed — see field-paths.ts.
  changed?: readonly string[];
}>();

// Which field the person is working in, so the preview can follow them. The path is
// relative to `data`, like `changed`.
const emit = defineEmits<{ focusField: [path: string] }>();

// ONE delegated listener for the whole form, on `focusin` because it bubbles (`focus`
// does not) and because the event lands on the <input>, not on the wrapper carrying the
// path. `fieldPathOfTarget` walks up to the NEAREST path, so a field nested in a list
// item reports `cards.0.heading` and not the `cards` it sits in.
function onFocusIn(e: FocusEvent): void {
  const path = fieldPathOfTarget(e.target);
  if (path) emit("focusField", path);
}

// Widgets that need the full row even in the two-column grid.
const WIDE = new Set(["text", "image", "object", "list", "relation"]);
const isWide = (f: Field) => WIDE.has(f.widget);

// Marked only in the dense grid, which already wraps each field in a div of its own.
// The plain column renders FieldInput directly and is left exactly as it was — a wrapper
// added there would change the spacing of every existing form in the CMS.
const isChanged = (f: Field) => anyTouchesField(props.changed ?? [], f.name);
</script>

<template>
  <div v-if="dense" class="field-grid" @focusin="onFocusIn">
    <div class="field-grid__items">
      <div
        v-for="f in fields"
        :key="f.name"
        :class="[
          { 'field-span-full': isWide(f) },
          isChanged(f) ? 'rounded-[var(--radius)] ring-1 ring-amber-300' : '',
        ]"
        :data-changed="isChanged(f) ? 'true' : undefined"
      >
        <FieldInput :field="f" :path="childPath(undefined, f.name)" v-model="data[f.name]" />
      </div>
    </div>
  </div>
  <div v-else class="flex flex-col" @focusin="onFocusIn">
    <FieldInput
      v-for="f in fields"
      :key="f.name"
      :field="f"
      :path="childPath(undefined, f.name)"
      v-model="data[f.name]"
    />
  </div>
</template>
