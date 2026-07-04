<script setup lang="ts">
// Settings → Menu. Purpose-built editor for WordPress-style menu locations:
// two locations (Header / Footer) × three devices (Desktop / Tablet / Mobile).
// tablet/mobile default to inheriting the desktop menu (stored as null), so a
// small-business user only maintains what they customize.
//
// The saved shape MUST match frontend/lib/site.ts (normalizeMenu / SiteMenu) —
// they mirror each other on purpose (separate build roots, no shared import).
// Loads the legacy { items: [...] } shape gracefully; always saves the new one.
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import SaveButton from "./SaveButton.vue";
import { GitHubClient, GitHubError } from "../backend/github";
import { fileEntryPath, type FileEntry } from "../schema";
import type { Locale } from "../backend/config";
import { localeLabel } from "../backend/site";
import { reportError, clearError } from "../errors";
import { isDirty } from "./dirty";

const props = defineProps<{ client: GitHubClient; file: FileEntry; locale: Locale }>();
const emit = defineEmits<{ (e: "back"): void }>();

type MenuItem = { label: string; url: string };
type LocationMenu = { desktop: MenuItem[]; tablet: MenuItem[] | null; mobile: MenuItem[] | null };
type SiteMenu = { header: LocationMenu; footer: LocationMenu };

const LOCATIONS = [
  { key: "header", label: "Header" },
  { key: "footer", label: "Footer" },
] as const;
const DEVICES = [
  { key: "desktop", label: "Desktop" },
  { key: "tablet", label: "Tablet" },
  { key: "mobile", label: "Mobile" },
] as const;
type LocationKey = (typeof LOCATIONS)[number]["key"];
type DeviceKey = (typeof DEVICES)[number]["key"];

// ── normalize (mirrors frontend/lib/site.ts) ──────────────────────────────
function coerceItems(v: unknown): MenuItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (i): i is MenuItem =>
        !!i && typeof i === "object" &&
        typeof (i as MenuItem).label === "string" &&
        typeof (i as MenuItem).url === "string",
    )
    .map((i) => ({ label: i.label, url: i.url }));
}
function coerceLocation(v: unknown): LocationMenu {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    desktop: coerceItems(o.desktop),
    tablet: o.tablet == null ? null : coerceItems(o.tablet),
    mobile: o.mobile == null ? null : coerceItems(o.mobile),
  };
}
function normalize(raw: Record<string, unknown>): SiteMenu {
  if (raw.locations && typeof raw.locations === "object") {
    const loc = raw.locations as Record<string, unknown>;
    return { header: coerceLocation(loc.header), footer: coerceLocation(loc.footer) };
  }
  // Legacy { items: [...] } → header.desktop.
  return {
    header: { desktop: coerceItems(raw.items), tablet: null, mobile: null },
    footer: { desktop: [], tablet: null, mobile: null },
  };
}

// ── state ─────────────────────────────────────────────────────────────────
const loading = ref(true);
const model = reactive<SiteMenu>({
  header: { desktop: [], tablet: null, mobile: null },
  footer: { desktop: [], tablet: null, mobile: null },
});
let sha: string | undefined;

const activeLocation = ref<LocationKey>("header");
const activeDevice = ref<DeviceKey>("desktop");

const path = computed(() => fileEntryPath(props.file, props.locale));

// Shared unsaved-changes signal (App.vue guards navigation on it), like SettingsView.
const markDirty = () => (isDirty.value = true);
onUnmounted(() => (isDirty.value = false));

async function load() {
  loading.value = true;
  try {
    let raw: Record<string, unknown> = {};
    try {
      const loaded = await props.client.loadJson(path.value);
      raw = loaded.data;
      sha = loaded.sha;
    } catch (e) {
      // No menu file for this locale yet — start empty and create it on save.
      if (e instanceof GitHubError && e.status === 404) sha = undefined;
      else throw e;
    }
    Object.assign(model, normalize(raw));
  } catch (e) {
    reportError(e, "Failed to load the menu.");
  } finally {
    loading.value = false;
    isDirty.value = false;
  }
}

watch(path, load, { immediate: true });

async function save() {
  const out = {
    locations: {
      header: { ...model.header },
      footer: { ...model.footer },
    },
  };
  sha = await props.client.saveJson(path.value, out, `lanza: update ${path.value}`, sha);
  isDirty.value = false;
}

// ── active list helpers ───────────────────────────────────────────────────
const currentLocation = computed(() => model[activeLocation.value]);
// A non-desktop device inherits when its stored value is null.
const inherits = computed(
  () => activeDevice.value !== "desktop" && currentLocation.value[activeDevice.value as "tablet" | "mobile"] === null,
);
// The array we render/edit. When inheriting we show the desktop list read-only.
const items = computed<MenuItem[]>(() => {
  const stored = currentLocation.value[activeDevice.value];
  return stored ?? currentLocation.value.desktop;
});

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
  <div class="min-h-screen">
    <header class="toolbar flex items-center justify-between gap-4 px-5 py-2.5">
      <button class="text-sm text-zinc-600 transition hover:text-zinc-900" @click="emit('back')">← Back</button>
      <span class="flex-1 text-center text-sm"></span>
      <SaveButton
        :action="save"
        :disabled="loading"
        @saved="clearError"
        @error="(e) => reportError(e, 'Save failed.')"
      />
    </header>

    <main class="mx-auto max-w-3xl px-6 pt-8 pb-24">
      <h1 class="mb-1 font-serif text-3xl font-bold tracking-tight text-zinc-900">
        Menu
        <span v-if="file.localized" class="ml-2 align-middle text-base font-medium text-zinc-500">
          · {{ localeLabel(locale) }}
        </span>
      </h1>
      <p class="mb-6 text-sm text-zinc-600">
        Set the links for each menu location. Tablet and mobile follow the desktop menu
        unless you customize them.
      </p>

      <div v-if="loading" class="card space-y-4 p-5">
        <div class="skeleton h-9 w-full" />
        <div class="skeleton h-9 w-2/3" />
        <div class="skeleton h-9 w-full" />
      </div>

      <div v-else class="card p-5">
        <!-- Location tabs -->
        <div class="segment mb-4">
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
        <div v-if="inherits" class="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-zinc-600">
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
    </main>
  </div>
</template>
