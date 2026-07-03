// Pure-function unit tests for the GitHub-proxy allowlist.
// Run: node --experimental-strip-types functions/_lib/gh-proxy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowed, crossOriginBlocked } from "./gh-proxy.ts";

const REPO = "repos/dsottimano/lanza";
const GIT = `${REPO}/git`;

test("GET: existing allowed endpoints", () => {
  assert.ok(isAllowed("GET", "user"));
  assert.ok(isAllowed("GET", `${REPO}/contents/frontend/content/posts`));
  assert.ok(isAllowed("GET", `${GIT}/ref/heads/main`));
  assert.ok(isAllowed("GET", `${GIT}/commits/abc123`));
});

test("GET: new read-only endpoints for revert", () => {
  assert.ok(isAllowed("GET", `${GIT}/trees/abc123`));
  assert.ok(isAllowed("GET", `${GIT}/trees/abc123?recursive=1`));
  assert.ok(isAllowed("GET", `${GIT}/blobs/deadbeef`));
  assert.ok(isAllowed("GET", `${REPO}/commits`)); // list
  assert.ok(isAllowed("GET", `${REPO}/commits?sha=main&per_page=30&page=1`));
  assert.ok(isAllowed("GET", `${REPO}/commits/abc123`)); // single REST commit
  assert.ok(isAllowed("GET", `${REPO}/compare/base123...head456`));
  assert.ok(isAllowed("GET", `/${REPO}/compare/base123...head456`)); // leading slash normalized
});

test("GET: rejects other repos and unknown endpoints", () => {
  assert.ok(!isAllowed("GET", "repos/evil/other/commits"));
  assert.ok(!isAllowed("GET", "repos/evil/other/git/trees/abc"));
  assert.ok(!isAllowed("GET", "repos/dsottimano/lanza-secrets/commits"));
  assert.ok(!isAllowed("GET", `${REPO}/pulls`));
  assert.ok(!isAllowed("GET", `${REPO}/actions/workflows`));
  // A path that is a prefix but not the exact list endpoint or a sub-resource.
  assert.ok(!isAllowed("GET", `${REPO}/commitsfoo`));
});

test("GET: dot-segment traversal is rejected even on new endpoints", () => {
  assert.ok(!isAllowed("GET", `${GIT}/trees/../../../orgs/x`));
  assert.ok(!isAllowed("GET", `${REPO}/compare/../secrets`));
  assert.ok(!isAllowed("GET", `${GIT}/blobs/..`));
  // But a three-dot basehead is a single segment, not traversal.
  assert.ok(isAllowed("GET", `${REPO}/compare/a...b`));
});

test("compare / commits are read-only: non-GET methods rejected", () => {
  assert.ok(!isAllowed("POST", `${REPO}/compare/a...b`));
  assert.ok(!isAllowed("POST", `${REPO}/commits`));
  assert.ok(!isAllowed("PUT", `${GIT}/trees/abc`));
  assert.ok(!isAllowed("DELETE", `${GIT}/blobs/abc`));
});

test("write allowlist unchanged (regression)", () => {
  assert.ok(isAllowed("PUT", `${REPO}/contents/x.md`));
  assert.ok(isAllowed("POST", `${GIT}/blobs`));
  assert.ok(isAllowed("POST", `${GIT}/trees`));
  assert.ok(isAllowed("POST", `${GIT}/commits`));
  assert.ok(isAllowed("PATCH", `${GIT}/refs/heads/main`));
  assert.ok(!isAllowed("POST", `${GIT}/refs`));
});

test("crossOriginBlocked unchanged", () => {
  assert.ok(!crossOriginBlocked("GET", "https://evil.com", "cms.example.com"));
  assert.ok(crossOriginBlocked("POST", "https://evil.com", "cms.example.com"));
  assert.ok(!crossOriginBlocked("POST", "https://cms.example.com", "cms.example.com"));
  assert.ok(!crossOriginBlocked("POST", null, "cms.example.com")); // no Origin → allowed
});
