#!/usr/bin/env node
// Package the stock Lanza design as a theme bundle:
//
//   node scripts/pack-default-theme.mjs [out.tar.gz]
//
// Assembles the design SOURCE from the current working tree — the file set
// defined once in scripts/theme-fileset.mjs (isDesignPath) — into a temp staging
// dir (theme.json + files/**), then packs it with the shared packThemeDir() from
// pack-theme.mjs. Default output: themes/lanza-theme-default.tar.gz.
//
// Content and uploads are deliberately excluded: this is the design, not a site
// dump. Applying the bundle restores the stock pages/components/layout/styles and
// the content schema, overwriting those paths — it never deletes files.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { packThemeDir } from "./pack-theme.mjs";
import { DESIGN_DIR_PREFIXES, DESIGN_EXPLICIT_FILES, DATA_DIR, isDesignPath } from "./theme-fileset.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Read the site version from the root package.json (falls back to 1.0.0).
function siteVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "1.0.0";
  } catch {
    return "1.0.0";
  }
}

const MANIFEST = {
  name: "lanza-default",
  title: "Lanza Default",
  version: siteVersion(),
  author: "Lanza",
  description:
    "Restores the stock Lanza design: the default pages, components, layout, " +
    "styles, data defaults and content schema. Applying a theme overwrites those " +
    "paths but never deletes files — use the Revert feature for a true undo.",
  rebuildNote:
    "Ships the content schema (admin/src/schema.ts) — the CMS rebuilds after applying.",
};

/** Recursively list files under an absolute dir, returned as absolute paths. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const toRepoPath = (abs) => relative(REPO_ROOT, abs).split(sep).join("/");

// Collect design files by scanning the design directories + data dir, then
// filtering through isDesignPath (the single source of truth) so data-dir walks
// drop non-design files like redirects.json. Explicit files are added directly.
function collectDesignFiles() {
  const scanRoots = [...DESIGN_DIR_PREFIXES.map((p) => p.replace(/\/$/, "")), DATA_DIR.replace(/\/$/, "")];
  const found = new Set();
  for (const root of scanRoots) {
    const abs = join(REPO_ROOT, root);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue; // a design dir may not exist in a given tree — skip it
    }
    if (!stat.isDirectory()) continue;
    for (const file of walk(abs)) {
      const rel = toRepoPath(file);
      if (isDesignPath(rel)) found.add(rel);
    }
  }
  for (const rel of DESIGN_EXPLICIT_FILES) {
    try {
      if (statSync(join(REPO_ROOT, rel)).isFile()) found.add(rel);
    } catch {
      /* missing explicit file — skip */
    }
  }
  return [...found].sort();
}

function main() {
  const outArg = process.argv[2];
  const out = outArg
    ? join(process.cwd(), outArg)
    : join(REPO_ROOT, "themes", "lanza-theme-default.tar.gz");

  const files = collectDesignFiles();
  if (files.length === 0) throw new Error("No design files found — nothing to pack.");

  // Stage theme.json + files/<repo-path> in a temp dir, then hand it to the
  // shared packer (same tar/gzip logic as every other bundle).
  const stage = mkdtempSync(join(tmpdir(), "lanza-default-"));
  try {
    writeFileSync(join(stage, "theme.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);
    for (const rel of files) {
      const dest = join(stage, "files", rel);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(REPO_ROOT, rel), dest);
    }
    const { entries, bytes } = packThemeDir(stage, out);
    console.log(`Packed ${entries} entries (${files.length} files) → ${out} (${bytes} bytes)`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

main();
