// Pure-function unit tests for the GitHub-proxy allowlist.
// Run: node --experimental-strip-types functions/_lib/gh-proxy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowed, crossOriginBlocked, upstreamPath } from "./gh-proxy.ts";

// The allowlist now validates REPO-RELATIVE paths — the SPA never sends owner/name;
// the proxy prepends repos/<owner>/<name>/ via upstreamPath. So paths here have no
// repos/… prefix (and any that do are rejected — see below).

test("GET: existing allowed endpoints", () => {
  assert.ok(isAllowed("GET", "user"));
  assert.ok(isAllowed("GET", "contents/content/posts"));
  assert.ok(isAllowed("GET", "git/ref/heads/main"));
  assert.ok(isAllowed("GET", "git/commits/abc123"));
});

test("GET: read-only endpoints for revert", () => {
  assert.ok(isAllowed("GET", "git/trees/abc123"));
  assert.ok(isAllowed("GET", "git/trees/abc123?recursive=1"));
  assert.ok(isAllowed("GET", "git/blobs/deadbeef"));
  assert.ok(isAllowed("GET", "commits")); // list
  assert.ok(isAllowed("GET", "commits?sha=main&per_page=30&page=1"));
  assert.ok(isAllowed("GET", "commits/abc123")); // single REST commit
  assert.ok(isAllowed("GET", "compare/base123...head456"));
  assert.ok(isAllowed("GET", "/compare/base123...head456")); // leading slash normalized
});

test("GET: a repos/…-prefixed path is now rejected (SPA must send repo-relative)", () => {
  // The whole point of the server-owned identity: the SPA cannot address a repo.
  assert.ok(!isAllowed("GET", "repos/dsottimano/lanza/contents/x")); // even the tenant's own repo
  assert.ok(!isAllowed("GET", "repos/evil/other/commits"));
  assert.ok(!isAllowed("GET", "repos/evil/other/git/trees/abc"));
});

test("GET: rejects unknown endpoints", () => {
  assert.ok(!isAllowed("GET", "pulls"));
  assert.ok(!isAllowed("GET", "actions/workflows"));
  // A path that is a prefix but not the exact list endpoint or a sub-resource.
  assert.ok(!isAllowed("GET", "commitsfoo"));
});

test("GET: dot-segment traversal is rejected", () => {
  assert.ok(!isAllowed("GET", "git/trees/../../../orgs/x"));
  assert.ok(!isAllowed("GET", "compare/../secrets"));
  assert.ok(!isAllowed("GET", "git/blobs/.."));
  // But a three-dot basehead is a single segment, not traversal.
  assert.ok(isAllowed("GET", "compare/a...b"));
});

test("compare / commits are read-only: non-GET methods rejected", () => {
  assert.ok(!isAllowed("POST", "compare/a...b"));
  assert.ok(!isAllowed("POST", "commits"));
  assert.ok(!isAllowed("PUT", "git/trees/abc"));
  assert.ok(!isAllowed("DELETE", "git/blobs/abc"));
});

test("write allowlist", () => {
  assert.ok(isAllowed("PUT", "contents/x.md"));
  assert.ok(isAllowed("POST", "git/blobs"));
  assert.ok(isAllowed("POST", "git/trees"));
  assert.ok(isAllowed("POST", "git/commits"));
  assert.ok(isAllowed("PATCH", "git/refs/heads/main"));
  assert.ok(isAllowed("POST", "git/refs")); // create the working branch (ensureWorkingBranch)
});

test("upstreamPath prepends repo identity; /user passes through", () => {
  assert.equal(upstreamPath("contents/x.md", "o", "n"), "repos/o/n/contents/x.md");
  assert.equal(upstreamPath("/contents/x.md", "o", "n"), "repos/o/n/contents/x.md"); // leading slash
  assert.equal(upstreamPath("commits?sha=main", "o", "n"), "repos/o/n/commits?sha=main"); // query kept
  assert.equal(upstreamPath("user", "o", "n"), "user"); // account-scoped, not repo-scoped
});

test("crossOriginBlocked unchanged", () => {
  assert.ok(!crossOriginBlocked("GET", "https://evil.com", "cms.example.com"));
  assert.ok(crossOriginBlocked("POST", "https://evil.com", "cms.example.com"));
  assert.ok(!crossOriginBlocked("POST", "https://cms.example.com", "cms.example.com"));
  assert.ok(!crossOriginBlocked("POST", null, "cms.example.com")); // no Origin → allowed
});
