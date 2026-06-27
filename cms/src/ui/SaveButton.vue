<script setup lang="ts">
// Shared save control with visible lifecycle: idle → saving (spinner) →
// saved (green ✓, auto-reverts) or error (red, click to retry). Owns the
// async run; the parent passes an `action` that does the work and throws on
// failure, and listens for `saved` / `error` to update its own status line.
import { onBeforeUnmount, ref } from "vue";

const props = defineProps<{ action: () => Promise<void>; disabled?: boolean }>();
const emit = defineEmits<{
  (e: "saved"): void;
  (e: "error", message: string): void;
}>();

type State = "idle" | "saving" | "saved" | "error";
const state = ref<State>("idle");
let revertTimer: ReturnType<typeof setTimeout> | undefined;

async function run() {
  if (state.value === "saving") return;
  clearTimeout(revertTimer);
  state.value = "saving";
  try {
    await props.action();
    state.value = "saved";
    emit("saved");
    revertTimer = setTimeout(() => (state.value = "idle"), 1800);
  } catch (e) {
    state.value = "error";
    emit("error", e instanceof Error ? e.message : "Save failed.");
    revertTimer = setTimeout(() => (state.value = "idle"), 2800);
  }
}

onBeforeUnmount(() => clearTimeout(revertTimer));
</script>

<template>
  <button
    class="savebtn"
    :class="state"
    :disabled="disabled || state === 'saving'"
    @click="run"
  >
    <span v-if="state === 'saving'" class="spinner" aria-hidden="true" />
    <span v-else-if="state === 'saved'" class="glyph" aria-hidden="true">✓</span>
    <span v-else-if="state === 'error'" class="glyph" aria-hidden="true">!</span>
    <span>{{
      state === "saving"
        ? "Saving…"
        : state === "saved"
          ? "Saved"
          : state === "error"
            ? "Retry"
            : "Save"
    }}</span>
  </button>
</template>

<style scoped>
.savebtn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 6.2rem;
  justify-content: center;
  padding: 0.45rem 1rem;
  border: none;
  border-radius: 7px;
  background: #1a1a1a;
  color: #fff;
  cursor: pointer;
  font: inherit;
  transition: background-color 0.2s ease;
}
.savebtn:disabled {
  cursor: default;
}
.savebtn.saving {
  opacity: 0.85;
}
.savebtn.saved {
  background: #18794e; /* green */
}
.savebtn.error {
  background: #c0392b; /* red */
}
.glyph {
  font-weight: 700;
  line-height: 1;
}
.spinner {
  width: 0.85rem;
  height: 0.85rem;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
