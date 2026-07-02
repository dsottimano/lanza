<script setup lang="ts">
// Renders a list of schema fields against a reactive data object. Provides the
// GitHub client so nested relation widgets can list their target collection.
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
}>();

provide(CLIENT_KEY, props.client);
provide(LOCALE_KEY, props.locale);
</script>

<template>
  <div class="flex flex-col">
    <FieldInput
      v-for="f in fields"
      :key="f.name"
      :field="f"
      v-model="data[f.name]"
    />
  </div>
</template>
