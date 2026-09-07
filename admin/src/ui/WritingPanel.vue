<script setup lang="ts">
import { useId } from "vue";
defineProps<{ title: string }>();
const open = defineModel<boolean>({ default: true });
const id = useId();
</script>
<template>
  <section class="writing-panel">
    <h2><button type="button" class="writing-panel__toggle" :aria-expanded="open" :aria-controls="id" @click="open = !open">
      {{ title }} <span aria-hidden="true">{{ open ? "−" : "+" }}</span>
    </button></h2>
    <div v-show="open" :id="id" class="writing-panel__body"><slot /></div>
  </section>
</template>
