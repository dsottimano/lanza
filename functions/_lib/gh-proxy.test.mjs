// Pure-function unit tests for the GitHub-proxy allowlist.
// Run: node --experimental-strip-types functions/_lib/gh-proxy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowed, crossOriginBlocked, upstreamPath, upstreamTargetAllowed } from "./gh-proxy.ts";

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

// ---------------------------------------------------------------------------
// Encoded + backslash traversal. A string check and the WHATWG URL parser
// disagree about what a path separator is; each case below RESOLVED OUTSIDE the
// repo before the fold-then-check fix. Regression cases — do not relax.
// ---------------------------------------------------------------------------

const BS = String.fromCharCode(92);
const resolved = (p) => new URL(`https://api.github.com/${upstreamPath(p, "o", "n")}`).href;

test("traversal: backslash is a path separator to fetch(), so it must be rejected", () => {
  const escape = `contents/${(".." + BS).repeat(4)}user/repos`;
  // Proof the payload really does escape once parsed:
  assert.equal(resolved(escape), "https://api.github.com/user/repos");
  assert.ok(!isAllowed("GET", escape));
  assert.ok(!isAllowed("PUT", `contents/${(".." + BS).repeat(4)}repos/attacker/evil/contents/pwn.md`));
});

test("traversal: %2e%2e is a dot segment per RFC 3986", () => {
  const escape = "contents/%2e%2e/%2e%2e/%2e%2e/%2e%2e/user/repos";
  assert.equal(resolved(escape), "https://api.github.com/user/repos");
  assert.ok(!isAllowed("GET", escape));
  // The branch pin is only meaningful if this is blocked: it deletes the branch
  // Astro builds from.
  assert.ok(!isAllowed("DELETE", "contents/%2e%2e/%2e%2e/%2e%2e/%2e%2e/repos/o/n/git/refs/heads/main"));
});

test("traversal: double-encoded and mixed forms", () => {
  assert.ok(!isAllowed("GET", "contents/%252e%252e/%252e%252e/user"));
  assert.ok(!isAllowed("GET", `contents/..%2f..%2fuser`));
  assert.ok(!isAllowed("GET", `contents/..${BS}../user`));
});

test("legitimate percent-encoding still passes (accented filenames)", () => {
  assert.ok(isAllowed("PUT", "contents/content/pages/en/caf%C3%A9.md"));
  assert.ok(isAllowed("GET", "contents/content/pages/en/about.md?ref=staging"));
});

test("upstreamTargetAllowed: the resolved URL is the last word", () => {
  assert.ok(upstreamTargetAllowed("https://api.github.com/repos/o/n/contents/x.md", "o", "n"));
  assert.ok(upstreamTargetAllowed("https://api.github.com/user", "o", "n"));
  // escaped out of the repo namespace
  assert.ok(!upstreamTargetAllowed("https://api.github.com/user/repos", "o", "n"));
  assert.ok(!upstreamTargetAllowed("https://api.github.com/repos/o/n-evil/contents/x", "o", "n"));
  assert.ok(!upstreamTargetAllowed("https://api.github.com/repos/other/repo/contents/x", "o", "n"));
  // never leave api.github.com
  assert.ok(!upstreamTargetAllowed("https://evil.com/repos/o/n/contents/x", "o", "n"));
  assert.ok(!upstreamTargetAllowed("not a url", "o", "n"));
});

// ── Preview-origin redirect ────────────────────────────────────────────────
// /admin on a Cloudflare Pages preview build can never authenticate: the session's
// aud claim is bound to the production origin. Rather than explain that, the
// middleware redirects to the live CMS — which already edits the same staging
// branch. These pin the derivation the redirect depends on.
import { productionOriginIfPreview } from "./tenant-config.ts";

test("productionOriginIfPreview redirects preview hosts to production", () => {
  assert.equal(
    productionOriginIfPreview("staging.mcp-test-736f7e918662.pages.dev"),
    "https://mcp-test-736f7e918662.pages.dev",
  );
  // Per-deployment hash URLs are previews too.
  assert.equal(
    productionOriginIfPreview("4eb5de2d.mcp-test-736f7e918662.pages.dev"),
    "https://mcp-test-736f7e918662.pages.dev",
  );
});

test("productionOriginIfPreview never redirects a site to itself", () => {
  // Production must not look like a preview, or /admin would 302-loop forever.
  assert.equal(productionOriginIfPreview("mcp-test-736f7e918662.pages.dev"), null);
  // Custom domains: a preview can't be told from an apex, and a wrong guess would
  // send a healthy live site somewhere it can't come back from.
  assert.equal(productionOriginIfPreview("example.com"), null);
  assert.equal(productionOriginIfPreview("www.example.com"), null);
  assert.equal(productionOriginIfPreview("staging.example.com"), null);
  // A host merely ending in the string isn't Cloudflare's.
  assert.equal(productionOriginIfPreview("evil-pages.dev"), null);
  assert.equal(productionOriginIfPreview("a.notpages.dev"), null);
  assert.equal(productionOriginIfPreview(""), null);
});
