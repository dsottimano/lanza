<script setup lang="ts">
import type { SlashItem } from "./extensions/slash";

defineProps<{
  items: SlashItem[];
  selected: number;
  top: number;
  left: number;
}>();

defineEmits<{
  (e: "select", index: number): void;
  (e: "hover", index: number): void;
}>();
</script>

<template>
  <div class="slash-menu" :style="{ top: `${top}px`, left: `${left}px` }">
    <div v-if="!items.length" class="slash-empty">No matches</div>
    <button
      v-for="(item, i) in items"
      :key="item.title"
      class="slash-item"
      :class="{ active: i === selected }"
      @mouseenter="$emit('hover', i)"
      @mousedown.prevent="$emit('select', i)"
    >
      <span class="slash-icon">{{ item.icon }}</span>
      <span class="slash-text">
        <span class="slash-title">{{ item.title }}</span>
        <span class="slash-hint">{{ item.hint }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.slash-menu {
  position: fixed;
  z-index: 50;
  width: 16rem;
  max-height: 19rem;
  overflow-y: auto;
  padding: 0.35rem;
  background: var(--glass-tint-strong);
  backdrop-filter: blur(18px) saturate(180%);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  box-shadow: var(--glass-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
.slash-empty {
  padding: 0.6rem 0.7rem;
  color: #9a9a9a;
  font-size: 0.88rem;
}
.slash-item {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  border: none;
  border-radius: 7px;
  background: none;
  cursor: pointer;
  text-align: left;
}
.slash-item.active {
  background: rgba(23, 25, 32, 0.08);
}
.slash-icon {
  flex: 0 0 1.9rem;
  height: 1.9rem;
  display: grid;
  place-items: center;
  font-size: 0.85rem;
  font-weight: 600;
  color: #555;
  background: #f6f6f4;
  border: 1px solid #ececec;
  border-radius: 6px;
}
.slash-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.slash-title {
  font-size: 0.92rem;
  color: #1a1a1a;
}
.slash-hint {
  font-size: 0.76rem;
  color: #9a9a9a;
}
</style>
