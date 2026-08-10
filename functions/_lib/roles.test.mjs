// Adversarial tests for the two-role model (functions/_lib/roles.ts).
//
// The interesting cases are all the same shape: an editor reaching production by a
// route that is not `POST /merges`. Refusing the publish endpoint is the obvious
// check and the least sufficient one — the contents API and the git-data API can
// each write a branch directly, and the git-data API can write ANY path, so a
// prefix check on `contents/` alone would be decoration.
//
// Run: node --experimental-strip-types --loader ./functions/_lib/ts-resolve.mjs functions/_lib/roles.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveRole,
  roleFromPermissions,
  roleMayWrite,
  editorMayCall,
  roleMayUseCloudflare,
} from "./roles.ts";

const POLICY = { workingBranch: "staging", productionBranch: "main" };
const may = (method, path, body = null) => editorMayCall(method, path, body, POLICY);

// ── role resolution ─────────────────────────────────────────────────────────

test("owner and editor lists resolve, and an unknown login gets nothing", () => {
  assert.equal(resolveRole("dsottimano", "dsottimano", []), "owner");
  assert.equal(resolveRole("alice", "dsottimano", ["alice"]), "editor");
  assert.equal(resolveRole("mallory", "dsottimano", ["alice"]), null);
});

test("logins are case-insensitive, like the rest of the gate", () => {
  assert.equal(resolveRole("DSottimano", "dsottimano", []), "owner");
  assert.equal(resolveRole("ALICE", "dsottimano", ["Alice"]), "editor");
});

test("adminLogin still accepts the comma-list form", () => {
  assert.equal(resolveRole("bob", "dsottimano, bob", []), "owner");
});

test("owner wins when a login is in both lists — being an editor never demotes", () => {
  assert.equal(resolveRole("dsottimano", "dsottimano", ["dsottimano"]), "owner");
});

test("empty, missing and malformed lists admit nobody", () => {
  assert.equal(resolveRole("alice", "", []), null);
  assert.equal(resolveRole("alice", undefined, undefined), null);
  assert.equal(resolveRole("alice", "dsottimano", [null, 42, {}]), null);
  assert.equal(resolveRole("", "dsottimano", []), null);
  assert.equal(resolveRole(null, "dsottimano", []), null);
});

test("a whitespace-only entry does not become a wildcard", () => {
  assert.equal(resolveRole("   ", "dsottimano", ["  "]), null);
  assert.equal(resolveRole("alice", "  ,  ", []), null);
});

// ── publishing ──────────────────────────────────────────────────────────────

test("an editor cannot publish", () => {
  assert.equal(may("POST", "merges", { base: "main", head: "staging" }).ok, false);
});

test("an editor cannot publish by fast-forwarding production directly", () => {
  // The same effect as a merge, via a different endpoint.
  assert.equal(may("PATCH", "git/refs/heads/main", { sha: "deadbeef" }).ok, false);
  assert.equal(may("PATCH", "git/refs/heads/staging", { sha: "deadbeef" }).ok, true);
});

test("an editor cannot create a ref that is not the working branch", () => {
  assert.equal(may("POST", "git/refs", { ref: "refs/heads/main" }).ok, false);
  assert.equal(may("POST", "git/refs", { ref: "refs/heads/staging" }).ok, true);
});

// ── writing content ─────────────────────────────────────────────────────────

test("an editor may write content on the working branch", () => {
  assert.equal(may("PUT", "contents/content/posts/en/hello.md", { branch: "staging" }).ok, true);
  assert.equal(may("DELETE", "contents/content/posts/en/hello.md", { branch: "staging" }).ok, true);
});

test("an editor may upload media", () => {
  assert.equal(may("PUT", "contents/public/images/uploads/cat.png", { branch: "staging" }).ok, true);
});

test("an omitted branch is production, not 'unspecified'", () => {
  // GitHub defaults a missing `branch` to the repo's default branch. Allowing it
  // through would be allowing a direct write to main.
  assert.equal(may("PUT", "contents/content/posts/en/hello.md", {}).ok, false);
  assert.equal(may("PUT", "contents/content/posts/en/hello.md", null).ok, false);
});

test("an editor cannot write content straight to production", () => {
  assert.equal(may("PUT", "contents/content/posts/en/hello.md", { branch: "main" }).ok, false);
});

// ── privilege escalation ────────────────────────────────────────────────────

test("an editor cannot edit the file that says who is an owner", () => {
  const d = may("PUT", "contents/lanza.config.json", { branch: "staging" });
  assert.equal(d.ok, false);
  assert.match(d.reason, /owner/i);
});

test("an editor cannot change settings", () => {
  for (const file of ["data/site.json", "data/schema.json", "data/menu.en.json", "data/redirects.json"]) {
    assert.equal(may("PUT", `contents/${file}`, { branch: "staging" }).ok, false, file);
  }
});

test("an editor cannot change templates, themes or build files", () => {
  for (const file of ["templates/manifesto/template.html", "themes/x.css", "package.json", "astro.config.mjs"]) {
    assert.equal(may("PUT", `contents/${file}`, { branch: "staging" }).ok, false, file);
  }
});

test("a prefix is a directory, not a string prefix", () => {
  // "content/" must not admit a sibling whose name merely starts with it.
  assert.equal(may("PUT", "contents/contentious.md", { branch: "staging" }).ok, false);
  assert.equal(may("PUT", "contents/content.md", { branch: "staging" }).ok, false);
  assert.equal(may("PUT", "contents/public/images/uploadsX/x.png", { branch: "staging" }).ok, false);
});

test("a percent-encoded settings path is still a settings path", () => {
  // The proxy forwards the path as given; GitHub decodes it. So the check has to
  // decode too, or `%64ata/site.json` writes settings while reading as allowed.
  assert.equal(may("PUT", "contents/%64ata/site.json", { branch: "staging" }).ok, false);
  assert.equal(may("PUT", "contents/lanza%2econfig.json", { branch: "staging" }).ok, false);
});

// ── the git-data route, which bypasses contents/ entirely ───────────────────

test("an editor cannot smuggle a settings change through a tree", () => {
  const d = may("POST", "git/trees", {
    tree: [
      { path: "content/posts/en/ok.md", mode: "100644", type: "blob", sha: "a" },
      { path: "lanza.config.json", mode: "100644", type: "blob", sha: "b" },
    ],
  });
  assert.equal(d.ok, false);
  assert.match(d.reason, /lanza\.config\.json/);
});

test("a tree of only content is fine", () => {
  assert.equal(
    may("POST", "git/trees", {
      tree: [{ path: "content/posts/en/ok.md", mode: "100644", type: "blob", sha: "a" }],
    }).ok,
    true,
  );
});

test("a malformed or empty tree entry is refused, not skipped", () => {
  assert.equal(may("POST", "git/trees", { tree: [{ mode: "100644" }] }).ok, false);
  assert.equal(may("POST", "git/trees", { tree: [null] }).ok, false);
  assert.equal(may("POST", "git/trees", {}).ok, false);
  assert.equal(may("POST", "git/trees", { tree: "content/x.md" }).ok, false);
});

test("blobs and commits are allowed — neither makes a change visible on its own", () => {
  assert.equal(may("POST", "git/blobs", { content: "x" }).ok, true);
  assert.equal(may("POST", "git/commits", { tree: "abc", message: "m" }).ok, true);
});

// ── everything else ─────────────────────────────────────────────────────────

test("reads are not restricted", () => {
  assert.equal(may("GET", "contents/lanza.config.json").ok, true);
  assert.equal(may("GET", "contents/data/site.json").ok, true);
  assert.equal(may("GET", "compare/main...staging").ok, true);
});

test("an unrecognised write is refused by default, not allowed by omission", () => {
  assert.equal(may("POST", "git/tags").ok, false);
  assert.equal(may("PUT", "collaborators/mallory").ok, false);
  assert.equal(may("POST", "forks").ok, false);
});

test("Cloudflare is owner-only", () => {
  assert.equal(roleMayUseCloudflare("owner"), true);
  assert.equal(roleMayUseCloudflare("editor"), false);
});

test("a malformed escape is refused, not thrown on", () => {
  // decodeURIComponent throws on a lone '%'. An authorization check that throws is
  // a 500, and a 500 is not a refusal.
  assert.doesNotThrow(() => may("PUT", "contents/content/%.md", { branch: "staging" }));
  assert.equal(may("PUT", "contents/content/%.md", { branch: "staging" }).ok, false);
  assert.equal(may("POST", "git/trees", { tree: [{ path: "content/%" }] }).ok, false);
});

test("double-encoding does not launder a settings path", () => {
  assert.equal(may("PUT", "contents/%2564ata/site.json", { branch: "staging" }).ok, false);
});

test("a backslash does not launder a settings path", () => {
  assert.equal(may("POST", "git/trees", { tree: [{ path: "content\\..\\data/site.json" }] }).ok, false);
});

test("a dot segment cannot walk out of the content directory", () => {
  for (const p of [
    "content/../data/site.json",
    "content/../../etc/passwd",
    "content/./../lanza.config.json",
    "public/images/uploads/../../../data/site.json",
  ]) {
    assert.equal(may("PUT", `contents/${p}`, { branch: "staging" }).ok, false, p);
    assert.equal(may("POST", "git/trees", { tree: [{ path: p }] }).ok, false, p);
  }
});

// ── roles from GitHub's own booleans (§10.2) ────────────────────────────────
// The migration's whole claim is that no list is needed, so these assert the
// mapping AND that an absent/blank answer never becomes a role by default.

test("GitHub's permissions map to the three roles, most-privileged first", () => {
  // GitHub sets every lower boolean too, so an admin arrives with push and pull.
  const admin = { admin: true, maintain: true, push: true, triage: true, pull: true };
  assert.equal(roleFromPermissions(admin), "owner");
  assert.equal(roleFromPermissions({ admin: false, push: true, pull: true }), "editor");
  assert.equal(roleFromPermissions({ admin: false, push: false, maintain: true, pull: true }), "editor");
  assert.equal(roleFromPermissions({ admin: false, push: false, pull: true }), "viewer");
});

test("no access, no permissions object, and a junk value all resolve to null", () => {
  assert.equal(roleFromPermissions({ admin: false, push: false, pull: false }), null);
  assert.equal(roleFromPermissions({}), null);
  assert.equal(roleFromPermissions(undefined), null);
  assert.equal(roleFromPermissions(null), null);
  assert.equal(roleFromPermissions("admin"), null);
});

test("a truthy-but-not-true value is not permission", () => {
  // GitHub answers with booleans. Anything else is a shape we do not recognise, and
  // "we did not recognise it" must not read as "yes".
  assert.equal(roleFromPermissions({ admin: "true", push: "yes", pull: 1 }), null);
});

test("a viewer may not write; the other two may", () => {
  assert.equal(roleMayWrite("viewer"), false);
  assert.equal(roleMayWrite("editor"), true);
  assert.equal(roleMayWrite("owner"), true);
  // And a viewer is not a back door into Cloudflare either.
  assert.equal(roleMayUseCloudflare("viewer"), false);
});
