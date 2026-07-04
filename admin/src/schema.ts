// The content model — the single source of truth for the CMS's collections and
// their fields. The field-form renderer and the collection nav are driven
// entirely by this.
//
// It is now DATA, not code: the editable model lives in
// `data/schema.json` (read + write-committed by the CMS through the
// GitHub proxy — see backend/schema.ts). The JSON is imported below as the
// build-time SEED so the CMS still boots if the runtime fetch fails, and so
// there is no second hand-maintained copy of the model. At boot the CMS overlays
// the live repo copy via `setCollections()`; the Settings → content-type editor
// writes edits back to the same JSON.
//
// Two collection kinds:
//   - "folder": one markdown file per entry (posts, pages, taxonomies, authors).
//     `body` decides whether the entry gets the TipTap writing canvas.
//   - "files": a fixed set of JSON files (Settings → seo / menu / redirects).

import { reactive } from "vue";
import type { Locale } from "./backend/config";
import seed from "../../data/schema.json";

export type Widget =
  | "string"
  | "text"
  | "datetime"
  | "boolean"
  | "number"
  | "image"
  | "select"
  | "relation"
  | "object"
  | "list"
  // Page-template surface (rendered by ui/TemplateEditor.vue, not FieldInput):
  // `preset` picks a tenant template, `slots` holds its editable content.
  | "preset"
  | "slots";

export interface Field {
  name: string;
  label: string;
  widget: Widget;
  required?: boolean; // default true; set false for optional fields
  hint?: string;
  default?: unknown;
  // select
  options?: string[];
  // number
  valueType?: "int" | "float";
  // relation — target folder-collection name; pick from its entries by slug
  collection?: string;
  multiple?: boolean;
  // object
  fields?: Field[];
  collapsed?: boolean;
  // list — `fields` => object items; `types` => typed variants (page blocks);
  // neither => plain string items (e.g. organization.sameAs)
  types?: Variant[];
  labelSingular?: string;
}

export interface Variant {
  name: string; // discriminator written as `type`
  label: string;
  fields: Field[];
}

export interface FolderCollection {
  kind: "folder";
  name: string;
  label: string;
  labelSingular: string;
  folder: string;
  body: "rich" | "none"; // "rich" => TipTap canvas; "none" => form only
  thumbnail?: string; // field name used as the list thumbnail
  // When true, entries live in one subfolder per locale (folder/<locale>/<slug>.md)
  // and the active locale (App.vue) scopes the list + new-entry path. When false/
  // omitted the collection is shared across languages (e.g. authors).
  localized?: boolean;
  fields: Field[]; // frontmatter fields (excludes the body)
}

export interface FileEntry {
  name: string;
  label: string;
  file: string; // repo path to the JSON file (the base; see `localized`)
  // When true, the file has one variant per locale: `file` is the base name and
  // the active locale is spliced in before `.json` (menu.json → menu.es.json).
  localized?: boolean;
  // When set, App.vue opens a purpose-built pane instead of the generic
  // FieldForm (e.g. "menu" → MenuView.vue). `fields` is then unused.
  view?: "menu" | "redirects";
  fields: Field[];
}

export interface FileCollection {
  kind: "files";
  name: string;
  label: string;
  files: FileEntry[];
}

export type Collection = FolderCollection | FileCollection;

// ── the live content model ─────────────────────────────────────────────────

// Reactive so schema edits (Settings → content types) re-render the nav and
// forms without a page reload. Seeded from the committed default (the JSON
// import); backend/schema.ts splices in the fetched repo copy at boot.
export const COLLECTIONS = reactive<Collection[]>(seed as unknown as Collection[]);

// Replace the whole model in place (keeps the exported array reference stable so
// every synchronous importer stays bound to the live data). Used by the boot
// loader and the content-type editor.
export function setCollections(list: Collection[]): void {
  COLLECTIONS.splice(0, COLLECTIONS.length, ...list);
}

export function getCollection(name: string): Collection | undefined {
  return COLLECTIONS.find((c) => c.name === name);
}

export function folderCollections(): FolderCollection[] {
  return COLLECTIONS.filter((c): c is FolderCollection => c.kind === "folder");
}

// Repo folder for a collection in the active locale. Localized collections live
// in a per-locale subfolder (folder/<locale>); shared ones (authors) don't.
export function entryFolder(c: FolderCollection, locale: Locale): string {
  return c.localized ? `${c.folder}/${locale}` : c.folder;
}

// Repo path for a settings file in the active locale. Localized files splice the
// locale before `.json` (data/menu.json → data/menu.es.json); shared
// files (appearance, redirects) keep their path.
export function fileEntryPath(f: FileEntry, locale: Locale): string {
  return f.localized ? f.file.replace(/\.json$/, `.${locale}.json`) : f.file;
}
