// Apply a SITE RECIPE — the one artifact an agent authors to build a whole site.
//
//   node scripts/apply-recipe.mjs recipes/event-site [--into <dir>] [--dry-run] [--force]
//
// A recipe is a directory, not a blob, so every part of it stays hand-editable and
// diffable — the same reason templates live in the tenant repo:
//
//   recipes/<name>/
//     recipe.json                     content types + routes + menu + styles
//     templates/<t>/{template.html,fields.json}
//     content/<collection>/<locale>/*.md    seed entries (optional)
//
// It expands across the layers in docs/site-system.md: templates land in templates/,
// content types + routes are merged into data/schema.json, seeds into content/, menu
// links into data/menu.<locale>.json.
//
// NOTHING IS WRITTEN UNTIL EVERY CHECK PASSES. A recipe that half-applies leaves a
// content type whose template does not exist, which is worse than no recipe at all —
// so validation runs first, over the whole set, and the writes happen at the end.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { checkTemplate } from "../functions/_lib/site-system.mjs";

const argv = process.argv.slice(2);
const recipeDir = argv.find((a) => !a.startsWith("--"));
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = opt("into") || process.cwd();
const DRY = flag("dry-run");
const FORCE = flag("force");

if (!recipeDir) {
  console.error("usage: apply-recipe.mjs <recipe-dir> [--into <dir>] [--dry-run] [--force]");
  process.exit(1);
}

const fail = (msg) => {
  console.error(`apply-recipe: ${msg}`);
  process.exit(1);
};
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const recipe = readJson(join(recipeDir, "recipe.json"));
const tplRoot = join(recipeDir, "templates");
const templateNames = existsSync(tplRoot) ? readdirSync(tplRoot).filter((d) => statSync(join(tplRoot, d)).isDirectory()) : [];

// ── 1. work out each template's POSITION from the routes that reference it ───
// A template's position decides what the engine puts in its scope, so the checker
// cannot verify anything until it knows which one this is.
const position = new Map(templateNames.map((n) => [n, "page"]));
for (const ct of recipe.contentTypes || []) {
  if (ct.route?.template) position.set(ct.route.template, "detail");
  if (ct.route?.list?.template) position.set(ct.route.list.template, "list");
}

// ── 2. resolve content types (fields derived from their detail template) ─────
// `fieldsFrom` is the DRY rule that keeps this system honest: the template's
// fields.json is the ONE declaration of an event's shape, and the collection is
// derived from it. Declaring the same fields twice is how they drift.
const fieldsOf = new Map();
for (const name of templateNames) fieldsOf.set(name, readJson(join(tplRoot, name, "fields.json")));

const collections = [];
for (const ct of recipe.contentTypes || []) {
  const src = fieldsOf.get(ct.fieldsFrom);
  if (!src) fail(`content type "${ct.name}" says fieldsFrom "${ct.fieldsFrom}", which is not a template in this recipe.`);

  const route = ct.route ? { ...ct.route } : undefined;
  if (route?.list?.slotsFrom) {
    // A listing has no entry of its own, so its editable text starts as the list
    // template's declared defaults and lives in schema.json from then on.
    const listFields = fieldsOf.get(route.list.slotsFrom);
    if (!listFields) fail(`route.list.slotsFrom "${route.list.slotsFrom}" is not a template in this recipe.`);
    const slots = {};
    for (const f of listFields.fields || []) if (f.default !== undefined) slots[f.name] = f.default;
    route.list = { ...route.list, slots };
    delete route.list.slotsFrom;
  }

  collections.push({
    kind: "folder",
    name: ct.name,
    label: ct.label,
    labelSingular: ct.labelSingular,
    folder: ct.folder,
    body: ct.body || "none",
    ...(ct.thumbnail ? { thumbnail: ct.thumbnail } : {}),
    ...(ct.localized ? { localized: true } : {}),
    fields: src.fields,
    ...(route ? { route } : {}),
  });
}

// ── 3. validate EVERYTHING before writing anything ───────────────────────────
const world = { collections: new Map(collections.map((c) => [c.name, new Set(c.fields.map((f) => f.name))])) };
const problems = [];
for (const name of templateNames) {
  const html = readFileSync(join(tplRoot, name, "template.html"), "utf8");
  problems.push(
    ...checkTemplate({ name, html, fields: fieldsOf.get(name), position: position.get(name) }, world).map((p) => ({
      ...p,
      where: `${recipeDir}/templates/${name}/`,
    })),
  );
}

const errors = problems.filter((p) => p.level === "error");
for (const p of problems) console.error(`  [${p.level}] ${p.where} ${p.code}: ${p.message}`);
if (errors.length) fail(`${errors.length} error(s) — nothing written.`);

// Collisions with what the target repo already has.
const schemaPath = join(ROOT, "data/schema.json");
const schema = readJson(schemaPath);
const existing = new Set(schema.map((c) => c.name));
for (const c of collections) {
  if (existing.has(c.name) && !FORCE) {
    fail(`the target already has a collection named "${c.name}". Re-run with --force to replace it.`);
  }
}

// ── 4. write ─────────────────────────────────────────────────────────────────
const wrote = [];
const write = (rel, body) => {
  wrote.push(rel);
  if (DRY) return;
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

for (const name of templateNames) {
  for (const f of ["template.html", "fields.json"]) {
    write(join("templates", name, f), readFileSync(join(tplRoot, name, f), "utf8"));
  }
}

const merged = schema.filter((c) => !collections.some((n) => n.name === c.name)).concat(collections);
write("data/schema.json", `${JSON.stringify(merged, null, 2)}\n`);

const seedRoot = join(recipeDir, "content");
if (existsSync(seedRoot)) {
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else write(join("content", relative(seedRoot, p)), readFileSync(p, "utf8"));
    }
  };
  walk(seedRoot);
}

// Style variants — the looks the owner picks between at /style-preview/ before any
// of them is live. Copied verbatim; the preview route exists only when this file does.
const stylesSrc = join(recipeDir, "styles.json");
if (existsSync(stylesSrc)) write("data/styles.json", readFileSync(stylesSrc, "utf8"));

// Menu links, per locale, appended if not already present.
if (recipe.menu?.length) {
  const site = readJson(join(ROOT, "data/site.json"));
  for (const l of site.locales || []) {
    const rel = `data/menu.${l.code}.json`;
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    const menu = readJson(abs);
    const header = menu.header || [];
    let changed = false;
    for (const item of recipe.menu) {
      if (!header.some((h) => h.url === item.url)) {
        header.push({ ...item });
        changed = true;
      }
    }
    if (changed) write(rel, `${JSON.stringify({ ...menu, header }, null, 2)}\n`);
  }
}

console.log(`apply-recipe: "${recipe.label}" → ${ROOT}`);
for (const w of wrote) console.log(`  ${DRY ? "would write" : "wrote"} ${w}`);
if (recipe.styles?.length) console.log(`  styles offered: ${recipe.styles.join(", ")} — compare them at /style-preview/`);
if (DRY) console.log("  (dry run — nothing changed)");
