<script setup lang="ts">
import { useId } from "vue";
const groupName = useId();
defineProps<{ modelValue: "rich" | "none"; hasTemplates?: boolean }>();
const emit = defineEmits<{ (e: "update:modelValue", value: "rich" | "none"): void }>();
</script>

<template>
  <fieldset class="experience">
    <legend class="font-semibold text-zinc-900">Editing experience</legend>
    <p class="mb-3 mt-1 text-sm text-zinc-600">Choose how people will create and update this content.</p>
    <div class="experience-options">
      <label class="experience-option" :class="{ chosen: modelValue === 'rich' }">
        <input type="radio" :name="groupName" :checked="modelValue === 'rich'" @change="emit('update:modelValue', 'rich')" />
        <span><strong>{{ hasTemplates ? 'Writing & page layouts' : 'Writing workspace' }}</strong>
          <span class="description">{{ hasTemplates ? 'The chosen page template decides: writing canvas or editable sections with a live preview.' : 'For articles, stories and text-led pages. A writing canvas with supporting details alongside.' }}</span>
        </span>
      </label>
      <label class="experience-option" :class="{ chosen: modelValue === 'none' }">
        <input type="radio" :name="groupName" :checked="modelValue === 'none'" @change="emit('update:modelValue', 'none')" />
        <span><strong>Field form</strong><span class="description">For structured records such as people, categories and listings. People fill in the fields below.</span></span>
      </label>
    </div>
    <p v-if="hasTemplates && modelValue === 'rich'" class="experience-note">
      <strong>Designed landing pages</strong> use the page template’s sections and live preview. A template that includes an article body opens the writing canvas instead. Set this for each template; the collection name does not decide it.
    </p>
    <p v-else-if="modelValue === 'none'" class="experience-note">This form has no writing canvas or page-layout preview. Any existing article body is kept when saving.</p>
  </fieldset>
</template>

<style scoped>
.experience-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.experience-option { display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--border); border-radius: 6px; padding: 16px; cursor: pointer; font-size: 14px; }
.experience-option input { margin-top: 4px; accent-color: var(--accent); }
.experience-option.chosen { border-color: var(--accent); background: #faf0e8; }
.experience-option:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.description { display: block; color: var(--muted); font-size: 13px; line-height: 1.5; margin-top: 5px; }
.experience-note { margin-top: 12px; padding: 12px 14px; background: var(--paper); font-size: 13px; line-height: 1.6; color: var(--ink-soft); }
@media (max-width: 700px) { .experience-options { grid-template-columns: 1fr; } }
</style>
