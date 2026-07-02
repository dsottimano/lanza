import { ref } from "vue";

// App-wide "unsaved changes" flag. The active editor sets it while the user has
// pending edits; App.vue reads it to guard every pane transition, and the one
// beforeunload listener below warns before a tab close / reload.
export const isDirty = ref(false);

window.addEventListener("beforeunload", (e) => {
  if (!isDirty.value) return;
  e.preventDefault();
  e.returnValue = ""; // some browsers require a set returnValue to show the prompt
});

// True when it's safe to navigate away — immediately if clean, otherwise only
// after the user confirms discarding their unsaved edits.
export function confirmDiscard(): boolean {
  if (!isDirty.value) return true;
  return confirm("You have unsaved changes — leave anyway?");
}
