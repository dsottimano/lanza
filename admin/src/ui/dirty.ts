import { computed, onScopeDispose, reactive, ref, watch, type Ref } from "vue";

// App-wide "unsaved changes" flag. The active editor sets it while the user has
// pending edits; App.vue reads it to guard every pane transition, and the one
// beforeunload listener below warns before a tab close / reload.
export const isDirty = ref(false);

// Independently saved child editors must retain their own navigation warning
// when the main page is saved. Each mounted owner removes only its own flag.
const additional = reactive(new Map<symbol, boolean>());
export const hasUnsavedChanges = computed(() => isDirty.value || [...additional.values()].some(Boolean));
export function useAdditionalDirtyFlag(dirty: Ref<boolean>): void {
  const owner = Symbol("unsaved editor");
  watch(dirty, value => additional.set(owner, value), { immediate: true, flush: "sync" });
  onScopeDispose(() => additional.delete(owner));
}

window.addEventListener("beforeunload", (e) => {
  if (!hasUnsavedChanges.value) return;
  e.preventDefault();
  e.returnValue = ""; // some browsers require a set returnValue to show the prompt
});

// True when it's safe to navigate away — immediately if clean, otherwise only
// after the user confirms discarding their unsaved edits.
export function confirmDiscard(): boolean {
  if (!hasUnsavedChanges.value) return true;
  return confirm("You have unsaved changes — leave anyway?");
}
