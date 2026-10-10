import type { Field } from "../schema";
import { childPath } from "../fields/field-paths";
import type { SiteTool } from "./site-tools";

const MAX_TEXT = 20_000;
const MAX_FIELDS = 300;
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const own = (object: object, name: string) => Object.prototype.hasOwnProperty.call(object, name);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface TextField {
  path: string;
  label: string;
  value: string;
  parent: Record<string, unknown> | unknown[];
  key: string | number;
}

/** Walk declared fields and existing list items; never interpret caller paths. */
function textFields(fields: readonly Field[], data: Record<string, unknown>): TextField[] {
  const out: TextField[] = [];
  let remainingNodes = 3_000;
  function walk(declarations: readonly Field[], values: Record<string, unknown>, parent?: string, depth = 0) {
    if (depth > 12) return;
    for (const field of declarations) {
      if (--remainingNodes < 0) return;
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field.name) || forbidden.has(field.name) || out.length >= MAX_FIELDS) continue;
      const path = childPath(parent, field.name);
      const value = own(values, field.name) ? values[field.name] : undefined;
      if ((field.widget === "string" || field.widget === "text") && (value === undefined || typeof value === "string")) {
        if ((value ?? "").length <= MAX_TEXT) out.push({ path, label: field.label, value: value ?? "", parent: values, key: field.name });
      } else if (field.widget === "object" && record(value)) {
        walk(field.fields ?? [], value, path, depth + 1);
      } else if (field.widget === "list" && Array.isArray(value)) {
        for (let index = 0; index < value.length && out.length < MAX_FIELDS; index++) {
          if (--remainingNodes < 0) return;
          const item = value[index];
          const itemPath = childPath(path, index);
          if (record(item)) {
            const declarations = field.types ? field.types.find(type => type.name === item.type)?.fields ?? [] : field.fields ?? [];
            walk(declarations, item, itemPath, depth + 1);
          } else if (!field.fields && !field.types && typeof item === "string" && item.length <= MAX_TEXT) {
            out.push({ path: itemPath, label: `${field.label} ${index + 1}`, value: item, parent: value, key: index });
          }
        }
      }
    }
  }
  walk(fields, data);
  return out;
}

export interface EditorSiteTools {
  context: () => {
    repository: string | null;
    collection: string;
    locale: string;
    path: string | null;
    selectedField: string | null;
    dirty: boolean;
    baseSha?: string;
  };
  data: Record<string, unknown>;
  fields: () => readonly Field[];
  revision: () => string;
  ready: () => boolean;
  canEdit: () => boolean;
  focus: (path: string) => Promise<boolean>;
  pauseAutosave: (reason: string) => void;
  confirm?: (message: string) => boolean | Promise<boolean>;
}

function inputKeys(input: Record<string, unknown>, keys: string[]) {
  if (!record(input) || Object.keys(input).some(key => !keys.includes(key))) throw new Error("Invalid tool arguments.");
}

export function editorSiteTools(editor: EditorSiteTools): SiteTool[] {
  const schema = (properties: Record<string, unknown>, required: string[] = []) =>
    ({ type: "object", properties, required, additionalProperties: false });
  const fieldPath = { type: "string", description: "Exact field path from get_editor_context, including numeric list indices." };
  const ready = () => { if (!editor.ready()) throw new Error("Wait for this entry to load, resolve recovery or save conflicts, and finish any active save first."); };
  const field = (path: unknown) => {
    if (typeof path !== "string") throw new Error("An exact declared text field is required.");
    const found = textFields(editor.fields(), editor.data).find(item => item.path === path);
    if (!found) throw new Error("This is not an editable text field in the current entry. Refresh get_editor_context.");
    return found;
  };
  return [
    {
      name: "get_editor_context",
      description: "Read the OPEN entry's local revision, selection and declared text fields, including unsaved values. Use fieldPath to read one field. This does not read other entries or credentials.",
      inputSchema: schema({ fieldPath }),
      annotations: { readOnlyHint: true },
      execute: async input => {
        inputKeys(input, ["fieldPath"]); ready();
        const current = editor.context();
        const selected = input.fieldPath === undefined ? current.selectedField : field(input.fieldPath).path;
        const fields = textFields(editor.fields(), editor.data);
        const value = fields.find(item => item.path === selected);
        return { ...current, revision: editor.revision(), canPropose: editor.canEdit(),
          fields: fields.map(item => ({ path: item.path, label: item.label })),
          selected: value ? { path: value.path, label: value.label, value: value.value } : null,
          note: "Values are from the live editor. Proposals require confirmation and remain local until Save; saving drafts does not publish." };
      },
    },
    {
      name: "focus_editor_field",
      description: "Focus one declared text field in the OPEN editor and its preview. Changes the current selection; does not change content or save.",
      inputSchema: schema({ fieldPath }, ["fieldPath"]),
      execute: async input => {
        inputKeys(input, ["fieldPath"]); ready();
        const found = field(input.fieldPath);
        return { path: found.path, focused: await editor.focus(found.path) };
      },
    },
    {
      name: "propose_editor_change",
      description: "Propose replacement text for ONE declared field in the OPEN editor. Requires its exact current revision and human confirmation showing before/after. Accepted changes pause autosave and remain unsaved for review; this tool cannot save, publish, change a template, or edit other entries.",
      inputSchema: schema({ fieldPath, expectedRevision: { type: "string" }, value: { type: "string", maxLength: MAX_TEXT } },
        ["fieldPath", "expectedRevision", "value"]),
      annotations: { readOnlyHint: false },
      execute: async input => {
        inputKeys(input, ["fieldPath", "expectedRevision", "value"]); ready();
        if (!editor.canEdit()) throw new Error("This account cannot edit the entry.");
        if (typeof input.value !== "string" || input.value.length > MAX_TEXT) throw new Error(`Replacement text must be at most ${MAX_TEXT} characters.`);
        const expected = input.expectedRevision;
        if (typeof expected !== "string" || expected !== editor.revision()) throw new Error("The editor changed. Read its current context before proposing again.");
        const found = field(input.fieldPath);
        if (found.value === input.value) return { accepted: false, changed: false, note: "The field already has this value." };
        const current = editor.context();
        const prompt = `Review the agent's proposed change to ${found.label} (${found.path})\n${current.path ?? "New entry"} · ${current.locale}\n\nCurrent:\n${found.value}\n\nProposed:\n${input.value}\n\nApply in your editor? Autosave will pause. Review the preview, then Save to keep it. This does not publish.`;
        const accepted = await (editor.confirm ?? (message => window.confirm(message)))(prompt);
        if (!accepted) return { accepted: false, changed: false };
        // Confirmation may be asynchronous. Re-resolve the field and permission;
        // never retain a list-item reference across later typing/navigation.
        ready();
        if (!editor.canEdit() || expected !== editor.revision()) throw new Error("The editor or access changed during review. Nothing was applied; get fresh context.");
        const target = field(input.fieldPath);
        if (target.value !== found.value) throw new Error("The field changed during review. Nothing was applied.");
        editor.pauseAutosave("Agent change applied in your editor. Review it, then Save to keep it and resume autosaving.");
        if (Array.isArray(target.parent)) target.parent[Number(target.key)] = input.value;
        else target.parent[String(target.key)] = input.value;
        return { accepted: true, changed: true, path: target.path, revision: editor.revision(), saved: false, published: false,
          note: "Applied only in your editor. Review and Save to keep it. Publication remains a separate reviewed action." };
      },
    },
  ];
}
