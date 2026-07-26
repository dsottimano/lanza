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
import { join } from "node:path";

// Input is TENANT data (the content model) → read from the project root (cwd).
// Output is CODE (Astro's srcDir content config) → write into this package's
// frontend/. In the monorepo dogfood cwd === package, so both resolve as before.
const schemaPath = join(process.cwd(), "data/schema.json");
const outPath = fileURLToPath(new URL("../frontend/content.config.ts", import.meta.url));

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

const IND = (d) => "  ".repeat(d);
const lit = (v) => JSON.stringify(v);

// schema.json is UNTRUSTED input compiled straight into code that `astro build`
// then IMPORTS — inside the tenant's Cloudflare Pages build, with the build
// environment's secrets and write access to the deployed output. Two writers reach
// it and neither is a control: an uploaded theme bundle (third-party by
// definition) and any editor session doing `PUT contents/data/schema.json`
// (the content-type editor's checks live in a Vue computed, which is UI, not a
// gate). So this generator is the last honest gatekeeper, and it validates every
// value that lands in a code position — same posture as gen-redirects.mjs.
//
// The proven attack: a field named
//   [(await import("node:child_process")).execSync("id > /tmp/PWNED")]
// landed verbatim in an object-key position. That is a *computed key*, so the
// generated file stayed syntactically valid and still parsed as the config Astro
// expects — the build ran the payload and reported success.
//
// Field keys therefore go through lit() (a JSON string key can hold anything and
// executes nothing), and the two values that cannot be quoted away — a collection
// name (a JS identifier) and a loader base (a path) — are checked by shape.

// A collection name is emitted as a `const` binding and re-exported by name, so it
// must be a plain JS identifier. Nothing else can be made safe here.
const COLLECTION_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function assertCollectionName(name) {
  if (typeof name !== "string" || !COLLECTION_NAME_RE.test(name)) {
    throw new Error(
      `gen-content-config: illegal collection name ${JSON.stringify(name)} — ` +
        "must be a plain identifier (letters, digits, _ and $; not starting with a digit).",
    );
  }
}

// The folder is quoted by lit(), so it cannot break out of the string — but it is
// still a filesystem path handed to Astro's glob loader, and `..` there reads
// outside the content tree. Reject traversal, absolute paths and backslashes
// (WHATWG/Windows treat `\` as a separator) for the same reason lanza-content.ts
// does.
function assertFolder(folder, collection) {
  if (typeof folder !== "string" || !folder) {
    throw new Error(`gen-content-config: collection "${collection}" has no folder.`);
  }
  const bad =
    folder.includes("\\") ||
    folder.startsWith("/") ||
    folder.includes("\0") ||
    folder.split("/").some((seg) => seg === "..");
  if (bad) {
    throw new Error(
      `gen-content-config: illegal folder ${JSON.stringify(folder)} on collection "${collection}" — ` +
        "must be a repo-relative path with no `..`, backslash or leading slash.",
    );
  }
}

// Every field key is emitted quoted. A JSON string is inert in key position, so no
// name — however hostile — can reach a code position through this path.
function key(field) {
  if (typeof field?.name !== "string" || !field.name) {
    throw new Error(`gen-content-config: a field is missing its name (${JSON.stringify(field)}).`);
  }
  return lit(field.name);
}

function renderObject(fields, depth) {
  const lines = fields.map((f) => `${IND(depth + 1)}${key(f)}: ${render(f, depth + 1)},`);
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

// Validate the whole model BEFORE emitting anything: a hostile schema must fail
// the build loudly, not generate quietly. Throwing here leaves the previous
// content.config.ts on disk untouched — the write is the last statement.
for (const c of collections) {
  assertCollectionName(c.name);
  assertFolder(c.folder, c.name);
}

const defs = collections
  .map((c) => {
    const fields = c.fields.map((f) => `    ${key(f)}: ${render(f, 2)},`).join("\n");
    return (
      `const ${c.name} = defineCollection({\n` +
      `  loader: glob({ pattern: "**/*.{md,mdx}", base: ${lit(`./${c.folder}`)} }),\n` +
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
