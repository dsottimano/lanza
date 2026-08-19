// Check a whole tenant against the site system (docs/site-system.md).
//
//   node scripts/validate-site.mjs [--into <dir>] [--strict]
//
// A filesystem adapter, nothing more: the checks themselves live in
// functions/_lib/site-system.mjs so that this CLI and the MCP `validate_site` tool
// (which reads a GitHub branch instead of a working tree) give the same answer.
// Exit 1 on any error; --strict also fails on warnings. Safe to run any time: it
// reads, it never writes.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkSite } from "../functions/_lib/site-system.mjs";

const argv = process.argv.slice(2);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = opt("into") || process.cwd();
const STRICT = argv.includes("--strict");
const tplRoot = join(ROOT, "templates");

const { problems, templates } = await checkSite({
  readText: (p) => {
    const abs = join(ROOT, p);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  },
  listTemplates: () =>
    existsSync(tplRoot)
      ? readdirSync(tplRoot).filter((n) => statSync(join(tplRoot, n)).isDirectory())
      : [],
});

const errors = problems.filter((p) => p.level === "error");
const warnings = problems.filter((p) => p.level === "warning");

for (const p of problems) console.log(`${p.level === "error" ? "✗" : "!"} ${p.where} ${p.code}\n    ${p.message}`);

console.log(`\nvalidate-site: ${templates.length} template dir(s), ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length || (STRICT && warnings.length) ? 1 : 0);
