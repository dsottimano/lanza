// The build-time security floor (scripts/check-floor.mjs).
//
// This is the only thing left that can stop an unsafe version reaching the web,
// now that the broker cannot write tenant repositories. So the two ways it could
// fail are equally worth testing: letting a below-floor build through, and
// stopping a build it had no business stopping.
// Run: node --test scripts/check-floor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { refusalFor, isVersion, compareVersions } from "./check-floor.mjs";

test("a version below the floor is refused, and says how to fix it", () => {
  const refusal = refusalFor("0.1.9", "0.1.12");
  assert.ok(refusal);
  assert.match(refusal, /0\.1\.9/);
  assert.match(refusal, /0\.1\.12/);
  // The live site staying up is the part people need told; a refused build reads
  // like an outage otherwise.
  assert.match(refusal, /live site is untouched/);
});

test("at or above the floor builds", () => {
  assert.equal(refusalFor("0.1.12", "0.1.12"), null);
  assert.equal(refusalFor("0.2.0", "0.1.12"), null);
  assert.equal(refusalFor("1.0.0", "0.9.9"), null);
});

test("no floor published means no opinion", () => {
  assert.equal(refusalFor("0.1.9", null), null);
  assert.equal(refusalFor("0.1.9", undefined), null);
});

test("anything that is not a plain version builds", () => {
  // The bug this exists to prevent: a comparator that maps non-numeric segments to
  // zero judges every self-hoster and fork as version 0 - below every floor - and
  // blocks builds that were never on a release at all.
  for (const pin of ["file:../lanza", "https://example.com/p.tgz", "latest", "*", "0.1.x", "", null]) {
    assert.equal(refusalFor(pin, "0.1.12"), null, `must not refuse: ${JSON.stringify(pin)}`);
    assert.equal(refusalFor("0.1.9", pin), null, `must not refuse on floor: ${JSON.stringify(pin)}`);
  }
});

test("isVersion accepts only three numeric segments", () => {
  assert.equal(isVersion("0.1.12"), true);
  assert.equal(isVersion("10.20.30"), true);
  for (const bad of ["0.1", "0.1.12-beta", "v0.1.12", "0.1.12 ", "latest"]) {
    assert.equal(isVersion(bad), false, bad);
  }
});

test("comparison is numeric, not lexical", () => {
  // "0.1.9" > "0.1.12" as strings, which is exactly the floor being inverted.
  assert.equal(compareVersions("0.1.9", "0.1.12"), -1);
  assert.equal(compareVersions("0.2.0", "0.10.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
  assert.equal(compareVersions("0.1.12", "0.1.12"), 0);
});
