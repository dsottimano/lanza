<script setup lang="ts">
// Reusable language chooser: a toggle grid over LANG_CATALOG + a default-language
// select. Shared by first-run onboarding (multilingual step) and Settings →
// Languages. Two-way binds the chosen codes and the default code, keeps the
// default valid (always one of the chosen), and never empties the set.
import { LANG_CATALOG } from "../backend/site";

const chosen = defineModel<string[]>("chosen", { required: true });
const def = defineModel<string>("default", { required: true });

// Caller-supplied copy so each screen keeps its own wording.
withDefaults(
  defineProps<{ gridLabel?: string; defaultHint?: string }>(),
  { gridLabel: "Enabled languages", defaultHint: "" },
);

function toggle(code: string) {
  const i = chosen.value.indexOf(code);
  if (i === -1) chosen.value = [...chosen.value, code];
  else if (chosen.value.length > 1) chosen.value = chosen.value.filter((c) => c !== code);
  if (!chosen.value.includes(def.value)) def.value = chosen.value[0]; // keep default chosen
}
</script>

<template>
  <div>
    <label class="mb-2 block text-xs font-medium text-zinc-500">{{ gridLabel }}</label>
    <div class="grid grid-cols-2 gap-2">
      <button
        v-for="l in LANG_CATALOG"
        :key="l.code"
        type="button"
        :class="['flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition', chosen.includes(l.code) ? 'border-zinc-900/70 bg-[var(--paper-card)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--ink-soft)]']"
        @click="toggle(l.code)"
      >
        <span :class="['grid size-4 place-items-center rounded border text-[10px]', chosen.includes(l.code) ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-400']">
          <span v-if="chosen.includes(l.code)">✓</span>
        </span>
        {{ l.label }}
        <span class="ml-auto font-mono text-xs text-zinc-500">{{ l.code }}</span>
      </button>
    </div>

    <label class="mt-6 mb-1 block text-xs font-medium text-zinc-500">Default language</label>
    <p v-if="defaultHint" class="mb-2 text-xs text-zinc-500">{{ defaultHint }}</p>
    <select v-model="def" class="input">
      <option v-for="c in chosen" :key="c" :value="c">
        {{ LANG_CATALOG.find((l) => l.code === c)?.label ?? c }}
      </option>
    </select>
  </div>
</template>
