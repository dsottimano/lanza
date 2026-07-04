// Generates frontend/content.config.ts (Astro's Zod collection schemas) from
// data/schema.json (the CMS's single source of truth). Runs before
// `astro build`.
//
// WHY: the content model used to be defined twice and hand-synced — schema.json
// (what the CMS content-type editor writes) and content.config.ts (hand-written
// Zod). Astro never read schema.json, so a content type invented in the CMS was
// invisible to the build. This makes schema.json authoritative: JSON in, Zod out.
//
// DO NOT edit frontend/content.config.ts by hand — it is regenerated and any edit
// is lost. Change the model in the CMS (or schema.json) instead.
//
// widget → Zod mapping (see TODO.md task 1):
//   string/text/image/file → z.string()      number → z.number()
//   boolean                → z.boolean()      datetime → z.coerce.date()
//   select                 → z.enum(options)  (STRICT — a bad value fails the
//                            build, e.g. a misspelled listingStatus that would
//                            otherwise leave a sold property live on the site)
//   relation               → z.string(), or z.array(z.string()) when multiple
//   object (fields)        → z.object({...})  recursed
//   list (fields)          → z.array(z.object({...}))
//   list (types)           → z.array(z.discriminatedUnion("type", [...]))
//   list (neither)         → z.array(z.string())
// Modifiers: arrays always `.default([])`; `default` → `.default(x)`; optional
// datetimes tolerate a blank '' (Sveltia writes it) → undefined; otherwise
// `required: false` → `.optional()`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const schemaPath = fileURLToPath(new URL("../data/schema.json", import.meta.url));
const outPath = fileURLToPath(new URL("../frontend/content.config.ts", import.meta.url));

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

const IND = (d) => "  ".repeat(d);
const lit = (v) => JSON.stringify(v);

function renderObject(fields, depth) {
  const lines = fields.map((f) => `${IND(depth + 1)}${f.name}: ${render(f, depth + 1)},`);
  return `z.object({\n${lines.join("\n")}\n${IND(depth)}})`;
}

// list with `types` → a discriminated union keyed by the block's `type` literal.
function renderUnion(types, depth) {
  const variants = types.map((t) => {
    const fields = [{ name: "type", widget: "literal", literal: t.name }, ...t.fields];
    return `${IND(depth + 2)}${renderObject(fields, depth + 2)}`;
  });
  return (
    `z.array(\n${IND(depth + 1)}z.discriminatedUnion("type", [\n` +
    `${variants.join(",\n")},\n${IND(depth + 1)}]),\n${IND(depth)})`
  );
}

// The bare Zod expression for a field, before optional/default modifiers.
function base(field, depth) {
  switch (field.widget) {
    case "string":
    case "text":
    case "image":
    case "file":
    case "preset":
      // `preset` names a page template resolved by convention at render time
      // (frontend/components/Preset.astro). Deliberately a loose string, never an
      // enum of preset names — a tenant/agent adds a preset without touching this
      // config. Per-preset slot validation lives with the preset, not here.
      return "z.string()";
    case "slots":
      // Freeform per-preset content (the editable text/image slots). Loose for the
      // same reason as `preset`; the preset's own .slots.json describes its shape.
      return "z.record(z.string(), z.any())";
    case "boolean":
      return "z.boolean()";
    case "number":
      return "z.number()";
    case "datetime":
      return "z.coerce.date()";
    case "literal":
      return `z.literal(${lit(field.literal)})`;
    case "select":
      return `z.enum([${field.options.map(lit).join(", ")}])`;
    case "relation":
      return field.multiple ? "z.array(z.string())" : "z.string()";
    case "object":
      return renderObject(field.fields, depth);
    case "list":
      if (field.types) return renderUnion(field.types, depth);
      if (field.fields) return `z.array(${renderObject(field.fields, depth)})`;
      return "z.array(z.string())";
    default:
      throw new Error(`gen-content-config: unknown widget "${field.widget}" on field "${field.name}"`);
  }
}

const isArray = (f) => (f.widget === "relation" && f.multiple) || f.widget === "list";

// Full Zod expression for a field, with modifiers applied.
function render(field, depth) {
  // Arrays always carry `.default([])` so a missing key parses to []. `.optional()`
  // is never combined with `.default()` (order would short-circuit the default).
  if (isArray(field)) return `${base(field, depth)}.default([])`;

  if (field.widget === "datetime") {
    // Optional dates tolerate the blank string Sveltia writes for an empty field.
    if (field.required === false) {
      return (
        `z.preprocess(\n${IND(depth + 1)}(v) => (v === "" || v === null ? undefined : v),\n` +
        `${IND(depth + 1)}z.coerce.date().optional(),\n${IND(depth)})`
      );
    }
    return "z.coerce.date()";
  }

  // A CMS `default` is authoritative for both the new-entry form and Astro's
  // parse fallback (e.g. draft defaults true → a file missing the key is a draft).
  if (field.default !== undefined) return `${base(field, depth)}.default(${lit(field.default)})`;

  if (field.required === false) return `${base(field, depth)}.optional()`;

  return base(field, depth);
}

const collections = schema.filter((c) => c.kind === "folder");

const defs = collections
  .map((c) => {
    const fields = c.fields.map((f) => `    ${f.name}: ${render(f, 2)},`).join("\n");
    return (
      `const ${c.name} = defineCollection({\n` +
      `  loader: glob({ pattern: "**/*.{md,mdx}", base: "./${c.folder}" }),\n` +
      `  schema: z.object({\n${fields}\n  }),\n});`
    );
  })
  .join("\n\n");

const exportLine = `export const collections = { ${collections.map((c) => c.name).join(", ")} };`;

const out = `// ⚠️ GENERATED by scripts/gen-content-config.mjs from data/schema.json.
// Do not edit by hand — regenerated on every build. Change the model in the CMS
// content-type editor (or schema.json) instead.
//
// Localized collections store one subfolder per locale, so the glob loader yields
// id = "<locale>/<stem>" (e.g. "en/about"); routing parses that via
// frontend/lib/i18n.ts. Flat collections keep the bare stem. The glob loader is
// identical either way — the "**" pattern captures the locale subfolder — so this
// file does not distinguish them.
import { defineCollection } from "astro:content";
import { z } from "astro:schema";
import { glob } from "astro/loaders";

${defs}

${exportLine}
`;

writeFileSync(outPath, out);
console.log(`gen-content-config: wrote ${collections.length} collections to frontend/content.config.ts`);
