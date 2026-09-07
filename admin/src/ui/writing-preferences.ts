import { onUnmounted, reactive, ref, watch } from "vue";
const KEY = "lanza.writing.preferences.v2";
export const focusMode = ref(false);
export function useWritingPreferences() {
  const preferences = reactive({ options: false, seo: false, details: false });
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    for (const key of Object.keys(preferences) as (keyof typeof preferences)[]) {
      if (typeof saved?.[key] === "boolean") preferences[key] = saved[key];
    }
  } catch { /* preferences are optional */ }
  watch(preferences, () => {
    try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* unavailable */ }
  });
  onUnmounted(() => { focusMode.value = false; });
  return { preferences, focusMode };
}
