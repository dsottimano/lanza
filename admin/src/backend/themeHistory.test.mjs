// Fixture tests for the pure revert-set computation.
// Run: node --experimental-strip-types admin/src/backend/themeHistory.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRevertSet } from "./themeHistory.ts";

// Parent tree (path → blob sha it had BEFORE the apply).
const parentBlobs = new Map([
  ["frontend/styles/site.css", "cssOLD"],
  ["frontend/layout.astro", "layoutOLD"],
]);

test("added → delete, modified → restore parent blob", () => {
  const files = [
    { filename: "frontend/styles/site.css", status: "modified" }, // existed before
    { filename: "frontend/new-page.astro", status: "added" }, // theme created it
  ];
  const set = computeRevertSet(files, parentBlobs, new Set());
  assert.deepEqual(set.restore, [{ path: "frontend/styles/site.css", sha: "cssOLD" }]);
  assert.deepEqual(set.remove, ["frontend/new-page.astro"]);
  assert.deepEqual(set.conflicts, []);
});

test("removed status also restores the parent blob", () => {
  const files = [{ filename: "frontend/layout.astro", status: "removed" }];
  const set = computeRevertSet(files, parentBlobs, new Set());
  assert.deepEqual(set.restore, [{ path: "frontend/layout.astro", sha: "layoutOLD" }]);
  assert.deepEqual(set.remove, []);
});

test("edited-since paths surface as conflicts (restore and delete alike)", () => {
  const files = [
    { filename: "frontend/styles/site.css", status: "modified" },
    { filename: "frontend/new-page.astro", status: "added" },
  ];
  const changedSince = new Set([
    "frontend/styles/site.css", // someone edited the CSS after applying
    "frontend/unrelated.md", // not in the revert set → ignored
  ]);
  const set = computeRevertSet(files, parentBlobs, changedSince);
  assert.deepEqual(set.conflicts, ["frontend/styles/site.css"]);
});

test("modified file missing from parent tree throws (defensive)", () => {
  const files = [{ filename: "frontend/ghost.css", status: "modified" }];
  assert.throws(
    () => computeRevertSet(files, parentBlobs, new Set()),
    /no blob in the apply's parent commit/,
  );
});
