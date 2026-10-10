<script setup lang="ts">
// Shared save control with visible lifecycle: idle → saving (spinner) →
// saved (green ✓, auto-reverts) or error (red, click to retry). Owns the
// async run; the parent passes an `action` that does the work and throws on
// failure, and listens for `saved` / `error` to update its own status line.
import { computed, onBeforeUnmount, ref } from "vue";

// Resolve false when the user cancels. Other resolved values mean success.
const props = defineProps<{ action: () => Promise<unknown>; disabled?: boolean; label?: string }>();
const emit = defineEmits<{
  (e: "saved"): void;
  (e: "error", err: unknown): void;
}>();

type State = "idle" | "saving" | "saved" | "error";
const state = ref<State>("idle");
let active = true;
let revertTimer: ReturnType<typeof setTimeout> | undefined;

async function run() {
  if (props.disabled || state.value === "saving") return;
  clearTimeout(revertTimer);
  state.value = "saving";
  try {
    const result = await props.action();
    if (!active) return;
    if (result === false) { state.value = "idle"; return; }
    state.value = "saved";
    emit("saved");
    revertTimer = setTimeout(() => (state.value = "idle"), 1800);
  } catch (e) {
    if (!active) return;
    state.value = "error";
    emit("error", e);
    revertTimer = setTimeout(() => (state.value = "idle"), 2800);
  }
}

onBeforeUnmount(() => { active = false; clearTimeout(revertTimer); });

const label = computed(() =>
  state.value === "saving"
    ? "Saving…"
    : state.value === "saved"
      ? "Saved"
      : state.value === "error"
        ? "Retry"
        : props.label ?? "Save",
);

const tone = computed(() => {
  if (state.value === "saved") return "bg-emerald-600 text-white";
  if (state.value === "error") return "btn-danger";
  return "btn-primary";
});
</script>

<template>
  <button
    :class="['btn min-w-[6.5rem] px-4', tone]"
    :disabled="disabled || state === 'saving'"
    @click="run"
  >
    <span
      v-if="state === 'saving'"
      class="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
      aria-hidden="true"
    />
    <span v-else-if="state === 'saved'" class="font-bold leading-none" aria-hidden="true">✓</span>
    <span v-else-if="state === 'error'" class="font-bold leading-none" aria-hidden="true">!</span>
    <span>{{ label }}</span>
  </button>
</template>
