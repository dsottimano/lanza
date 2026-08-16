<script lang="ts">
import type { Field } from "../schema";

// ── Grouping ────────────────────────────────────────────────────────────────
// A template's slots are a tall stack of equal-weight inputs, and on a landing page
// there are thirty of them. Most will be written by an agent, not typed by a human —
// the human's job is to review them in place — so a form optimised for typing is the
// wrong default. Fields carrying the same `group` (schema.ts) collapse under one
// heading; the rest is width the live preview gets back.

export interface FieldSection {
  /** The heading, or null for fields that belong to no group. */
  group: string | null;
  fields: Field[];
}

/**
 * Split fields into sections, preserving the order they were declared in.
 *
 * A group appears where its FIRST field appears, and later fields of that group join it
 * even if something else was declared in between — otherwise a stray field in the middle
 * of a run would silently split one heading into two. Ungrouped fields keep their own
 * position: consecutive ones share a section so they render exactly as they do today.
 */
export function sectionsOf(fields: readonly Field[]): FieldSection[] {
  const sections: FieldSection[] = [];
  const byGroup = new Map<string, FieldSection>();
  for (const field of fields) {
    const group = field.group;
    if (!group) {
      const last = sections[sections.length - 1];
      if (last && last.group === null) last.fields.push(field);
      else sections.push({ group: null, fields: [field] });
      continue;
    }
    const existing = byGroup.get(group);
    if (existing) {
      existing.fields.push(field);
      continue;
    }
    const section: FieldSection = { group, fields: [field] };
    byGroup.set(group, section);
    sections.push(section);
  }
  return sections;
}
</script>

<script setup lang="ts">
// Renders a list of schema fields against a reactive data object. Provides the
// GitHub client so nested relation widgets can list their target collection.
//
// Layout lives in FieldRows.vue; this file decides what is behind a heading and what is
// open. Groups are COLLAPSED by default and open themselves when they hold something the
// review flagged — the point is to show a reviewer the changed fields and nothing else,
// while leaving every field reachable. A form whose fields declare no `group` renders
// exactly as it always has, with no disclosure in sight.
import { computed, provide, reactive } from "vue";
import type { GitHubClient } from "../backend/github";
import type { Locale } from "../backend/config";
import FieldRows from "./FieldRows.vue";
import { anyTouchesField } from "./field-paths";
import { CLIENT_KEY, LOCALE_KEY } from "./context";

const props = defineProps<{
  fields: Field[];
  data: Record<string, unknown>;
  client: GitHubClient;
  locale: Locale;
  dense?: boolean;
  // Paths a review reports as changed, RELATIVE TO `data` — `cards.0.heading`, not
  // `slots.cards.0.heading`. Callers holding entry paths convert once on the way in
  // (fields/field-paths.ts); this component never does prefix arithmetic.
  changed?: readonly string[];
}>();

// Which field is being worked in, relative to `data`. Passed straight through from
// FieldRows — one delegated listener down there answers for every field, including the
// ones inside a collapsed group.
const emit = defineEmits<{ focusField: [path: string] }>();

provide(CLIENT_KEY, props.client);
provide(LOCALE_KEY, props.locale);

const sections = computed(() => sectionsOf(props.fields));
// Nothing is grouped: render the rows straight, with no wrapper at all, so every form in
// the CMS that predates grouping is untouched.
const flat = computed(() => !props.fields.some((f) => f.group));

const changedIn = (section: FieldSection): number =>
  section.fields.filter((f) => anyTouchesField(props.changed ?? [], f.name)).length;

// A group the person opened or closed by hand. Their choice outranks the automatic
// open — including closing a group full of changes, which is a perfectly good way to
// say "reviewed".
const toggled = reactive<Record<string, boolean>>({});
const isOpen = (section: FieldSection): boolean =>
  toggled[section.group ?? ""] ?? changedIn(section) > 0;

function onToggle(section: FieldSection, e: Event): void {
  toggled[section.group ?? ""] = (e.target as HTMLDetailsElement).open;
}
</script>

<template>
  <FieldRows
    v-if="flat"
    :fields="fields"
    :data="data"
    :dense="dense"
    :changed="changed"
    @focus-field="emit('focusField', $event)"
  />
  <div v-else class="flex flex-col gap-2">
    <template v-for="(s, i) in sections" :key="s.group ?? `ungrouped-${i}`">
      <FieldRows
        v-if="s.group === null"
        :fields="s.fields"
        :data="data"
        :dense="dense"
        :changed="changed"
        @focus-field="emit('focusField', $event)"
      />
      <details
        v-else
        class="field-group rounded-[var(--radius)] border border-[var(--border)] px-3 py-2"
        :open="isOpen(s)"
        :data-group="s.group"
        @toggle="onToggle(s, $event)"
      >
        <summary class="flex cursor-pointer items-center gap-2 text-xs font-semibold text-zinc-600">
          <span class="grow">{{ s.group }}</span>
          <template v-if="changedIn(s)">
            <span class="size-1.5 shrink-0 rounded-full bg-amber-400" />
            <span class="shrink-0 font-normal text-amber-700">
              {{ changedIn(s) }} changed
            </span>
          </template>
          <span v-else class="shrink-0 font-normal text-zinc-400">{{ s.fields.length }}</span>
        </summary>
        <div class="mt-3">
          <FieldRows
            :fields="s.fields"
            :data="data"
            :dense="dense"
            :changed="changed"
            @focus-field="emit('focusField', $event)"
          />
        </div>
      </details>
    </template>
  </div>
</template>
