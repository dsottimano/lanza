// data/schema.json is compiled into frontend/content.config.ts, which `astro
// build` then IMPORTS — inside the tenant's Cloudflare Pages build, with the build
// environment's secrets and write access to the deployed output. Two writers reach
// that file and neither validates it: an uploaded theme bundle, and any editor
// session doing `PUT contents/data/schema.json`. So this generator is the gate,
// and these are its adversarial cases: each asserts the build FAILS **and** that
// no content.config.ts was written.
//
// Run: node --test scripts/gen-content-config.test.mjs
// (Not covered by `npm test`, whose glob is functions/_lib/*.test.mjs.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const GENERATOR = fileURLToPath(new URL("./gen-content-config.mjs", import.meta.url));
const REAL_SCHEMA = fileURLToPath(new URL("../data/schema.json", import.meta.url));

// The generator writes to ../frontend/content.config.ts relative to ITS OWN path,
// so it is copied into a sandbox first. Running it in place against a hostile
// schema would overwrite the repo's real config — which is itself worth knowing.
// A payload lands in the generated file whether it is neutralized or not — as a
// quoted string when it is, as code when it is not. So "does the text appear?" is
// the wrong question; the test IMPORTS the generated module (with astro:* stubbed,
// which is what a real build supplies) and asks whether the payload RAN. Each
// hostile schema drops its sentinel at <sandbox>/PWNED.
const SENTINEL = "__PWNED__";

function run(schema, { execute = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lanza-gen-"));
  const pwned = join(dir, SENTINEL);
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "frontend"));
    mkdirSync(join(dir, "data"));
    cpSync(GENERATOR, join(dir, "scripts/gen-content-config.mjs"));
    const json = typeof schema === "function" ? JSON.stringify(schema(pwned)) : JSON.stringify(schema);
    writeFileSync(join(dir, "data/schema.json"), typeof schema === "string" ? schema : json);
    const out = join(dir, "frontend/content.config.ts");
    const r = spawnSync(process.execPath, [join(dir, "scripts/gen-content-config.mjs")], {
      cwd: dir,
      encoding: "utf8",
    });
    const result = {
      status: r.status,
      stderr: r.stderr ?? "",
      wrote: existsSync(out),
      config: existsSync(out) ? readFileSync(out, "utf8") : null,
      pwned: () => existsSync(pwned),
      imported: null,
      importError: null,
    };
    if (execute && result.config) {
      writeFileSync(
        join(dir, "frontend/astro-stub.mjs"),
        "export const defineCollection = (x) => x;\n" +
          "export const glob = () => ({});\n" +
          "export const z = new Proxy({}, { get: () => () => new Proxy({}, { get: () => () => ({}) }) });\n",
      );
      const runnable = join(dir, "frontend/run.mjs");
      writeFileSync(
        runnable,
        result.config
          .replace('from "astro:content"', 'from "./astro-stub.mjs"')
          .replace('from "astro:schema"', 'from "./astro-stub.mjs"')
          .replace('from "astro/loaders"', 'from "./astro-stub.mjs"'),
      );
      const run = spawnSync(process.execPath, [runnable], { cwd: dir, encoding: "utf8" });
      result.imported = run.status === 0;
      result.importError = run.stderr ?? "";
      result.pwnedAfterImport = existsSync(pwned);
    }
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const collection = (over) => [
  { kind: "folder", name: "posts", folder: "content/posts", fields: [{ name: "title", widget: "string" }], ...over },
];

test("the real content model still generates", () => {
  const r = run(readFileSync(REAL_SCHEMA, "utf8"));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.config.includes("export const collections = {"));
  assert.ok(r.config.includes("import { defineCollection }"));
});

test("a hostile collection name fails the build and writes nothing", () => {
  // Emitted as a `const` binding: `const <name> = defineCollection({`. Nothing but
  // a plain identifier can be made safe in that position.
  const r = run(collection({ name: 'a = (await import("node:child_process")).execSync("id")' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /illegal collection name/);
  assert.equal(r.wrote, false);
});

test("a hostile field name is inert, not executable", () => {
  // The PROVEN attack: a field named
  //   [(await import("node:child_process")).execSync("id > /tmp/PWNED")]
  // landed verbatim in an object-key position. That is a *computed key*, so the
  // generated file stayed syntactically valid and still parsed as the config Astro
  // expects — the build ran the payload and reported success. Field keys now go
  // through JSON.stringify, so the name survives as data and executes nothing.
  const payload = (pwned) =>
    collection({
      fields: [
        { name: `[(await import("node:fs")).writeFileSync(${JSON.stringify(pwned)}, "")]`, widget: "string" },
      ],
    });
  const r = run(payload, { execute: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.imported, true, `generated config must still import: ${r.importError}`);
  assert.equal(r.pwnedAfterImport, false, "the payload must not execute");
  // The give-away for the old behaviour: an unquoted `[` opening a computed key.
  assert.doesNotMatch(r.config, /^\s*\[/m);
});

test("a field name cannot break out of the string either", () => {
  const payload = (pwned) =>
    collection({
      fields: [
        {
          name: `": z.any(), evil: (await import("node:fs")).writeFileSync(${JSON.stringify(pwned)}, ""), "x`,
          widget: "string",
        },
      ],
    });
  const r = run(payload, { execute: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.imported, true, `generated config must still import: ${r.importError}`);
  assert.equal(r.pwnedAfterImport, false, "the payload must not execute");
});

test("a folder that escapes the content tree fails the build", () => {
  for (const folder of ["../../../../etc", "/etc/passwd", "content\\..\\..\\x", "content/../../x"]) {
    const r = run(collection({ folder }));
    assert.notEqual(r.status, 0, folder);
    assert.match(r.stderr, /illegal folder/, folder);
    assert.equal(r.wrote, false, folder);
  }
});

test("a folder cannot break out of the loader's string literal", () => {
  // `base: "./${c.folder}"` was raw interpolation, so a quote closed the string.
  const payload = (pwned) =>
    collection({
      folder: `x", evil: (await import("node:fs")).writeFileSync(${JSON.stringify(pwned)}, ""), y: "`,
    });
  const r = run(payload, { execute: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.imported, true, `generated config must still import: ${r.importError}`);
  assert.equal(r.pwnedAfterImport, false, "the payload must not execute");
});

test("a nested field name is quoted too", () => {
  // renderObject recurses for `object` and `list` widgets — the fix has to apply
  // at every depth, not just the top level.
  const payload = (pwned) =>
    collection({
      fields: [
        {
          name: "seo",
          widget: "object",
          fields: [
            { name: `[(await import("node:fs")).writeFileSync(${JSON.stringify(pwned)}, "")]`, widget: "string" },
          ],
        },
        {
          name: "blocks",
          widget: "list",
          fields: [{ name: "[globalThis.pwned = true]", widget: "string" }],
        },
      ],
    });
  const r = run(payload, { execute: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.imported, true, `generated config must still import: ${r.importError}`);
  assert.equal(r.pwnedAfterImport, false, "the nested payload must not execute");
  assert.doesNotMatch(r.config, /^\s*\[/m);
});
