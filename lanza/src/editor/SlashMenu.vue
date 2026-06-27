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
  background: #fff;
  border: 1px solid #e7e7e7;
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
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
  background: #f1f1ef;
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
