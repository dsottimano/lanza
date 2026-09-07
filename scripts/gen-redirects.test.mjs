import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("homepage 301s compile without permitting patterns that intercept the CMS", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lanza-redirects-"));
  try {
    mkdirSync(join(cwd, "data"));
    const redirects = ["/", "/es/", "/*", "/ad*", "/:path", "/admin", "/admin/api"].map(from => ({ from, to: "/welcome/", status: 301 }));
    writeFileSync(join(cwd, "data/redirects.json"), JSON.stringify({ redirects }));
    execFileSync(process.execPath, [fileURLToPath(new URL("./gen-redirects.mjs", import.meta.url))], { cwd, stdio: "pipe" });
    assert.equal(readFileSync(join(cwd, "public/_redirects"), "utf8"), "/ /welcome/ 301\n/es/ /welcome/ 301\n");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
