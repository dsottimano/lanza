<script setup lang="ts">
// Renders a list of schema fields against a reactive data object. Provides the
// GitHub client so nested relation widgets can list their target collection.
//
// `dense` packs compact scalars (string/number/datetime/select/boolean) two per
// row; wide widgets (text/image/object/list/relation) always span the full width.
// It's a container query (see .field-grid in styles.css), so the two-column pass
// only kicks in when the form is actually wide enough — narrow side panels stay
// single-column on their own.
import { provide } from "vue";
import type { Field } from "../schema";
import type { GitHubClient } from "../backend/github";
import type { Locale } from "../backend/config";
import FieldInput from "./FieldInput.vue";
import { CLIENT_KEY, LOCALE_KEY } from "./context";

const props = defineProps<{
  fields: Field[];
  data: Record<string, unknown>;
  client: GitHubClient;
  locale: Locale;
  dense?: boolean;
}>();

provide(CLIENT_KEY, props.client);
provide(LOCALE_KEY, props.locale);

// Widgets that need the full row even in the two-column grid.
const WIDE = new Set(["text", "image", "object", "list", "relation"]);
const isWide = (f: Field) => WIDE.has(f.widget);
</script>

<template>
  <div v-if="dense" class="field-grid">
    <div class="field-grid__items">
      <div
        v-for="f in fields"
        :key="f.name"
        :class="{ 'field-span-full': isWide(f) }"
      >
        <FieldInput :field="f" v-model="data[f.name]" />
      </div>
    </div>
  </div>
  <div v-else class="flex flex-col">
    <FieldInput
      v-for="f in fields"
      :key="f.name"
      :field="f"
      v-model="data[f.name]"
    />
  </div>
</template>
