<script setup lang="ts">
// Presentational menu editor: edits a parent-owned reactive SiteMenu in place and
// emits `change` on every edit (the parent owns load/save + dirty). Two locations
// (Header / Footer) × three devices (Desktop / Tablet / Mobile); tablet/mobile
// inherit the desktop list until customized (stored as null). Extracted from the
// old MenuView so HeaderFooterView can feed the same live model to the preview.
import { computed, ref } from "vue";
import type { SiteMenu, MenuItem, LocationKey, DeviceKey } from "../backend/menu";

// `location` locks the editor to one menu location and hides the location tabs —
// the visual builder passes it so a header part's menu card edits only the header
// list. Omit it for a standalone two-location editor.
const props = defineProps<{ model: SiteMenu; location?: LocationKey }>();
const emit = defineEmits<{ (e: "change"): void }>();

const LOCATIONS = [
  { key: "header", label: "Header" },
  { key: "footer", label: "Footer" },
] as const;
const DEVICES = [
  { key: "desktop", label: "Desktop" },
  { key: "tablet", label: "Tablet" },
  { key: "mobile", label: "Mobile" },
] as const;

const activeLocation = ref<LocationKey>(props.location ?? "header");
const activeDevice = ref<DeviceKey>("desktop");

const markDirty = () => emit("change");

const currentLocation = computed(() => props.model[activeLocation.value]);
// A non-desktop device inherits when its stored value is null.
const inherits = computed(
  () =>
    activeDevice.value !== "desktop" &&
    currentLocation.value[activeDevice.value as "tablet" | "mobile"] === null,
);
// The array we render/edit. When inheriting we show the desktop list read-only.
const items = computed<MenuItem[]>(
  () => currentLocation.value[activeDevice.value] ?? currentLocation.value.desktop,
);

function setInherit(on: boolean) {
  const dev = activeDevice.value as "tablet" | "mobile";
  currentLocation.value[dev] = on
    ? null
    : currentLocation.value.desktop.map((i) => ({ ...i })); // start from a copy of desktop
  markDirty();
}

function addItem() {
  items.value.push({ label: "", url: "" });
  markDirty();
}
function removeItem(i: number) {
  items.value.splice(i, 1);
  markDirty();
}
function move(i: number, delta: number) {
  const to = i + delta;
  if (to < 0 || to >= items.value.length) return;
  const [row] = items.value.splice(i, 1);
  items.value.splice(to, 0, row);
  markDirty();
}

// Soft URL validation — relative /path or absolute http(s). Warns, never blocks.
function urlWarns(url: string): boolean {
  return !!url && !(url.startsWith("/") || /^https?:\/\//.test(url));
}

const inputCls = "input min-w-0 flex-1";
const iconBtn =
  "grid size-8 flex-shrink-0 place-items-center rounded-md text-zinc-500 transition hover:bg-[var(--surface)] hover:text-zinc-800 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent";
</script>

<template>
  <div>
    <!-- Location tabs — hidden when the builder locks this editor to one location. -->
    <div v-if="!location" class="segment mb-4">
      <button
        v-for="l in LOCATIONS"
        :key="l.key"
        class="segment-btn text-sm"
        :class="{ 'segment-btn--active': activeLocation === l.key }"
        @click="activeLocation = l.key"
      >
        {{ l.label }}
      </button>
    </div>

    <!-- Device sub-tabs -->
    <div class="mb-4 flex gap-4 border-b border-[var(--border)]">
      <button
        v-for="d in DEVICES"
        :key="d.key"
        :class="[
          '-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition',
          activeDevice === d.key
            ? 'border-zinc-900 text-zinc-900'
            : 'border-transparent text-zinc-500 hover:text-zinc-800',
        ]"
        @click="activeDevice = d.key"
      >
        {{ d.label }}
      </button>
    </div>

    <!-- Same-as-desktop toggle (tablet/mobile only) -->
    <label
      v-if="activeDevice !== 'desktop'"
      class="mb-4 flex items-center gap-2.5 text-sm text-zinc-600"
    >
      <input
        type="checkbox"
        class="size-4 rounded border-zinc-300"
        :checked="inherits"
        @change="setInherit(($event.target as HTMLInputElement).checked)"
      />
      Same as desktop
    </label>

    <!-- Inheriting: read-only preview of the desktop menu -->
    <div
      v-if="inherits"
      class="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-zinc-600"
    >
      <p v-if="items.length === 0">Uses the desktop menu (currently empty).</p>
      <template v-else>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Following desktop</p>
        <ul class="space-y-1">
          <li v-for="(it, i) in items" :key="i" class="flex gap-2">
            <span class="text-zinc-700">{{ it.label || "(no label)" }}</span>
            <span class="text-zinc-500">{{ it.url }}</span>
          </li>
        </ul>
      </template>
    </div>

    <!-- Editable rows -->
    <div v-else>
      <p v-if="items.length === 0" class="mb-3 text-sm text-zinc-500">No links yet.</p>
      <ul class="space-y-2">
        <li v-for="(it, i) in items" :key="i" class="flex items-start gap-1.5">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <div class="flex min-w-0 gap-1.5">
              <input v-model="it.label" :class="inputCls" placeholder="Label" @input="markDirty" />
              <input v-model="it.url" :class="inputCls" placeholder="/path/ or https://…" @input="markDirty" />
            </div>
            <p v-if="urlWarns(it.url)" class="text-xs text-amber-600">
              Use a relative path (<code>/about/</code>) or a full URL (<code>https://…</code>).
            </p>
          </div>
          <button :class="iconBtn" :disabled="i === 0" title="Move up" @click="move(i, -1)">↑</button>
          <button :class="iconBtn" :disabled="i === items.length - 1" title="Move down" @click="move(i, 1)">↓</button>
          <button :class="iconBtn" title="Remove" @click="removeItem(i)">✕</button>
        </li>
      </ul>
      <button class="btn btn-ghost mt-3" @click="addItem">+ Add link</button>
    </div>
  </div>
</template>
