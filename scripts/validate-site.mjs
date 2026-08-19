// Check a whole tenant against the site system (docs/site-system.md).
//
//   node scripts/validate-site.mjs [--into <dir>] [--strict]
//
// Reads the real artifacts — data/schema.json, templates/*, templates/parts/* — and
// reports every cross-layer disagreement. Exit 1 on any error; --strict also fails on
// warnings. Safe to run any time: it reads, it never writes.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkTemplate, checkPart } from "./site-system.mjs";

const argv = process.argv.slice(2);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = opt("into") || process.cwd();
const STRICT = argv.includes("--strict");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const tplRoot = join(ROOT, "templates");
const schemaPath = join(ROOT, "data/schema.json");

const schema = existsSync(schemaPath) ? readJson(schemaPath) : [];
const folders = schema.filter((c) => c.kind === "folder");

// What the LIST templates need to check their declared item fields against.
const world = {
  collections: new Map(folders.map((c) => [c.name, new Set((c.fields || []).map((f) => f.name))])),
};

// A template's POSITION comes from the routes that reference it — the same derivation
// apply-recipe.mjs does, because the position decides what is in scope.
const position = new Map();
for (const c of folders) {
  if (c.route?.template) position.set(c.route.template, "detail");
  if (c.route?.list?.template) position.set(c.route.list.template, "list");
}

const problems = [];

if (existsSync(tplRoot)) {
  for (const name of readdirSync(tplRoot)) {
    const dir = join(tplRoot, name);
    if (!statSync(dir).isDirectory() || name === "parts") continue;
    const htmlPath = join(dir, "template.html");
    const fieldsPath = join(dir, "fields.json");
    if (!existsSync(htmlPath)) {
      problems.push({ level: "error", code: "missing-template", where: `templates/${name}/`, message: "No template.html." });
      continue;
    }
    if (!existsSync(fieldsPath)) {
      problems.push({ level: "error", code: "missing-fields", where: `templates/${name}/`, message: "No fields.json — the CMS would show no inputs for this template." });
      continue;
    }
    problems.push(
      ...checkTemplate(
        { name, html: readFileSync(htmlPath, "utf8"), fields: readJson(fieldsPath), position: position.get(name) },
        world,
      ),
    );
  }

  for (const part of ["header", "footer"]) {
    const p = join(tplRoot, "parts", `${part}.html`);
    if (existsSync(p)) problems.push(...checkPart(part, readFileSync(p, "utf8")));
  }
}

// A route pointing at a template that does not exist: the collection stores entries
// that render as "Unknown template" on a live URL.
for (const c of folders) {
  for (const t of [c.route?.template, c.route?.list?.template].filter(Boolean)) {
    if (!existsSync(join(tplRoot, t, "template.html"))) {
      problems.push({
        level: "error",
        code: "route-template-missing",
        where: `data/schema.json`,
        message: `collection "${c.name}" routes to template "${t}", which does not exist.`,
      });
    }
  }
}

const errors = problems.filter((p) => p.level === "error");
const warnings = problems.filter((p) => p.level === "warning");

for (const p of problems) console.log(`${p.level === "error" ? "✗" : "!"} ${p.where} ${p.code}\n    ${p.message}`);

const scanned = existsSync(tplRoot) ? readdirSync(tplRoot).length : 0;
console.log(`\nvalidate-site: ${scanned} template dir(s), ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length || (STRICT && warnings.length) ? 1 : 0);
