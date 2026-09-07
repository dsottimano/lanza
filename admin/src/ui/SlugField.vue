<script setup lang="ts">
// The locale prefix stays visible while the public slug is edited.
import { computed } from "vue";
import IdentityField from "./IdentityField.vue";

const props = withDefaults(
  defineProps<{
    prefix: string;
    suffix: string;
    placeholder?: string;
    editable?: boolean;
    label?: string; // "URL" for pages, "Slug" for types with no simple public path
  }>(),
  { editable: true, placeholder: "", label: "URL" },
);

const slug = defineModel<string>({ default: "" });

// Auto-width the inline input to its content (or the placeholder), within reason.
const size = computed(() =>
  Math.min(Math.max((slug.value || props.placeholder).length, 3), 48),
);
</script>

<template>
  <IdentityField :label="label" :editable="editable"
    :hint="editable ? 'Edit the final URL segment. Save to confirm a URL change.' : 'URL changes require an owner because they update site redirects.'">
    <template #default="{ inputId }">
      <div class="identity-url">
        <span class="identity-url__prefix">{{ prefix }}</span>
        <input v-if="editable" :id="inputId" v-model="slug" :placeholder="placeholder" :size="size"
          spellcheck="false" autocapitalize="off" autocomplete="off" class="identity-url__input" />
        <span v-else>{{ slug }}</span>
        <span>{{ suffix }}</span>
      </div>
    </template>
  </IdentityField>
</template>
