<script setup lang="ts">
defineProps<{ title: string }>();
defineEmits<{ (e: "back"): void }>();
</script>

<template>
  <header class="settings-header">
    <div class="settings-header__row">
      <div class="min-w-0">
        <button class="settings-header__back" @click="$emit('back')">← Back to content</button>
        <h1 class="settings-header__title">{{ title }}</h1>
      </div>
      <div v-if="$slots.actions" class="settings-header__actions"><slot name="actions" /></div>
    </div>
    <div v-if="$slots.description" class="settings-header__description"><slot name="description" /></div>
    <slot name="navigation" />
  </header>
</template>
