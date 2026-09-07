<script setup lang="ts">
import { ref, useId } from "vue";
withDefaults(defineProps<{ label: string; editable?: boolean; hint?: string }>(), { editable: true });
const inputId = useId();
const root = ref<HTMLElement>();
function edit() {
  const input = root.value?.querySelector<HTMLInputElement>('input, textarea');
  input?.focus();
  input?.select();
}
</script>

<template>
  <div ref="root" class="identity-field">
    <label :for="editable !== false ? inputId : undefined" class="identity-field__label">{{ label }}</label>
    <div class="identity-field__control" :class="{ 'identity-field__control--fixed': editable === false }">
      <div class="identity-field__value"><slot :input-id="inputId" /></div>
      <button v-if="editable !== false" type="button" class="identity-field__edit" :aria-label="`Edit ${label.toLowerCase()}`"
        :title="hint || `Edit ${label.toLowerCase()}`" @click="edit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z" /></svg>
      </button>
      <span v-else class="identity-field__fixed" :title="hint || 'This value is fixed'" role="img" :aria-label="hint || 'This value is fixed'">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4" /></svg>
      </span>
    </div>
  </div>
</template>
