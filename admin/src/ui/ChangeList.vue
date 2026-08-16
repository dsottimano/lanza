<script setup lang="ts">
// The per-entry review panel: what publishing this page would change, field by
// field. The CMS writes to staging and publishes by merging into production, so
// an edit sits between the two branches until someone approves it — increasingly
// an edit an AGENT made, which is why reviewing it is now a first-class screen.
//
// Props in, events out. This component performs no revert and holds no client: it
// says which field the reviewer picked and lets the parent decide what that means.
// It reads the diff produced by backend/entry-diff.ts and nothing else.
import { computed } from "vue";
import { changedPaths, BODY_FIELD, type EntryDiff, type FieldDiff } from "../backend/entry-diff";
import type { Field } from "../schema";

const props = defineProps<{
  diff: EntryDiff;
  /** The collection's fields, for human labels. Absent → paths render raw. */
  fields?: Field[];
}>();

const emit = defineEmits<{
  (e: "select", path: string): void;
  (e: "revert", path: string): void;
}>();

// `changedPaths` is the authority on what counts as a change; filtering the field
// list by it keeps the rows in report order and hands us the values too.
const rows = computed<FieldDiff[]>(() => {
  const changed = new Set(changedPaths(props.diff));
  return props.diff.fields.filter((f) => changed.has(f.path));
});

// Per-FIELD revert only means something when the file exists on BOTH branches.
// On a `new` page there is no live value to go back to (that revert is a delete),
// and on a `deleted` one there is no staged file to put the value into — so the
// parent is never asked to perform a revert that has no defined outcome.
const canRevert = computed(() => props.diff.status === "changed");

const STATE_MESSAGE: Record<EntryDiff["status"], string> = {
  new: "This page has never been published. Publishing puts it on the live site for the first time.",
  deleted: "This page is on the live site now. Publishing takes it down.",
  unchanged: "Nothing to publish — this page already matches the live site.",
  absent: "This page isn't on the live site, and isn't in your drafts either.",
  changed: "",
};

const STATUS_WORD: Record<FieldDiff["status"], string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
  unchanged: "unchanged",
};

// Fields you can descend into: an object's or list's own `fields`, plus the fields
// of every typed variant (a list of page blocks declares its shape per `type`).
function childFields(f: Field): Field[] | undefined {
  const all = [...(f.fields ?? []), ...(f.types?.flatMap((t) => t.fields) ?? [])];
  return all.length ? all : undefined;
}

/**
 * A dot path as a human label: `slots.cards.0.heading` → "Cards › item 1 → Heading",
 * resolved against the declared fields. Numeric segments are list positions and are
 * shown 1-based, because "item 0" is a programmer's way to count.
 *
 * Falls back to the raw path when NOTHING in it resolves — a template's slots are
 * declared in the template's own fields.json, so a page's collection fields may not
 * describe them, and an honest path beats an invented label.
 */
function labelFor(path: string): string {
  const parts = path.split(".");
  const out: string[] = [];
  let level = props.fields;
  let matched = false;
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      // The item's own shape is the list's child shape, so `level` stays put.
      out.push(`item ${Number(part) + 1}`);
      continue;
    }
    const f = level?.find((x) => x.name === part);
    out.push(f ? f.label : part);
    if (f) matched = true;
    level = f ? childFields(f) : undefined;
  }
  if (matched) return out.join(" › ");
  // The body is not a frontmatter field — the schema excludes it — so it never
  // resolves, and "body" is jargon for the thing the writer sees as the page.
  return path === BODY_FIELD ? "Page content" : path;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A value a person can read at a glance. Never JSON: a container is summarised by
 * its size, because the point of a review row is "the cards changed", and the
 * detail belongs in the preview the reviewer is about to highlight.
 */
function summarize(v: unknown): string {
  if (v === null) return "empty";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return plural(v.length, "item");
  if (typeof v === "object") return plural(Object.keys(v).length, "field");
  // Bodies are HTML (Lanza is the source of truth for them), and markup in a
  // review row is noise. Rendered as TEXT either way — Vue escapes it — so this
  // is legibility, not sanitization.
  const text = String(v)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "empty";
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

const isMissing = (v: unknown) => v === undefined;
</script>

<template>
  <section class="card p-5">
    <header class="mb-4">
      <h2 class="font-serif text-lg font-bold tracking-tight text-zinc-900">Review changes</h2>
      <p v-if="STATE_MESSAGE[diff.status]" class="mt-1 text-sm text-zinc-600">
        {{ STATE_MESSAGE[diff.status] }}
      </p>
      <p v-else class="mt-1 text-sm text-zinc-600">
        {{ plural(rows.length, "field") }} would change when you publish.
      </p>
    </header>

    <ul v-if="rows.length" class="flex flex-col divide-y divide-[var(--border)] border-t border-[var(--border)]">
      <li
        v-for="row in rows"
        :key="row.path"
        class="group flex items-start gap-2 transition hover:bg-[var(--surface)]"
      >
        <button
          type="button"
          class="min-w-0 flex-1 px-2 py-3 text-left"
          :title="row.path"
          @click="emit('select', row.path)"
        >
          <span class="flex items-baseline gap-2">
            <span class="truncate text-sm font-medium text-zinc-900">{{ labelFor(row.path) }}</span>
            <span class="shrink-0 text-xs uppercase tracking-wide text-zinc-400">
              {{ STATUS_WORD[row.status] }}
            </span>
          </span>
          <span class="mt-1.5 flex flex-col gap-1 text-sm sm:flex-row sm:items-baseline sm:gap-3">
            <span class="min-w-0 flex-1">
              <span class="mr-1.5 text-xs text-zinc-400">Live</span>
              <span v-if="isMissing(row.live)" class="italic text-zinc-400">not set</span>
              <span v-else class="text-zinc-500 line-through decoration-zinc-300">{{ summarize(row.live) }}</span>
            </span>
            <span class="shrink-0 text-zinc-300" aria-hidden="true">→</span>
            <span class="min-w-0 flex-1">
              <span class="mr-1.5 text-xs text-zinc-400">After</span>
              <span v-if="isMissing(row.staged)" class="italic text-zinc-400">removed</span>
              <span v-else class="text-zinc-800">{{ summarize(row.staged) }}</span>
            </span>
          </span>
        </button>

        <button
          v-if="canRevert"
          type="button"
          class="shrink-0 self-center px-3 py-1.5 text-xs text-zinc-500 opacity-0 transition focus:opacity-100 hover:text-zinc-900 hover:underline group-hover:opacity-100"
          :aria-label="`Revert ${labelFor(row.path)} to the live version`"
          @click="emit('revert', row.path)"
        >
          Revert
        </button>
      </li>
    </ul>
  </section>
</template>
