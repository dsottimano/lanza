#!/usr/bin/env node
// @lanza/site build tool. A tenant repo's package.json runs `lanza build` /
// `lanza dev`; this drives the code (shipped in this package) against the
// tenant's content + data (the current working directory).
//
//   lanza build → codegen (content.config.ts, _redirects) then `astro build`
//   lanza dev   → codegen then `astro dev`
//
// Codegen reads tenant data from cwd and writes content.config.ts into the
// package's srcDir; see scripts/gen-*.mjs. Astro runs from cwd (the project
// root) with the package's astro binary and config factory (astro-config.mjs).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// bin/ sits directly under the package root.
const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: process.cwd() });
  if (r.error) {
    console.error(`lanza: failed to run ${cmd}: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const mode = process.argv[2];
if (mode !== "build" && mode !== "dev") {
  console.error("usage: lanza <build|dev>");
  process.exit(2);
}

// Codegen (content model → Zod config; redirect rules → _redirects).
run(process.execPath, [join(PKG_ROOT, "scripts/gen-content-config.mjs")]);
run(process.execPath, [join(PKG_ROOT, "scripts/gen-redirects.mjs")]);

// Astro, from the package's own install, rooted at the tenant cwd.
const astroBin = join(PKG_ROOT, "node_modules/.bin/astro");
run(astroBin, [mode]);
