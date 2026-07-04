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
import { cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

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

// Astro, resolved wherever npm hoisted it (usually the tenant's node_modules, not
// a fixed path under the package), run rooted at the tenant cwd.
const astroBin = join(dirname(require.resolve("astro/package.json")), "bin/astro.mjs");
run(process.execPath, [astroBin, mode]);

// After a build, overlay the tenant's own public/ (media uploads + the generated
// _redirects) onto the output. Astro's publicDir points at the PACKAGE's public/
// (platform assets + prebuilt admin), so this merge is what brings the tenant's
// files in. In the monorepo dogfood cwd/public IS the package public/, so this
// re-copies the same files — a harmless no-op.
if (mode === "build") {
  const tenantPublic = join(process.cwd(), "public");
  const dist = join(process.cwd(), "dist");
  if (existsSync(tenantPublic)) {
    cpSync(tenantPublic, dist, { recursive: true });
  }
}
