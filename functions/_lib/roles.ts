// Who may do what inside /admin. Pure decisions, no I/O, so the adversarial cases
// are testable without booting a Worker — the same split as admin-gate.ts.
//
// The roles, and the difference between them is deliberately small:
//
//   owner   — everything.
//   editor  — may write CONTENT on the working branch. May not publish, may not
//             change settings, may not touch Cloudflare, and — the one that matters
//             most — may not edit the file that says who is an owner.
//   viewer  — reads /admin, writes nothing.
//
// WHERE A ROLE COMES FROM is mid-migration (docs/security-todo.md §10.8). GitHub's
// own `permissions` booleans are the answer (roleFromPermissions, below); the list
// lookup in resolveRole is the outgoing path, still live for anyone holding a
// broker-signed session, and deleted in phase 4. Everything BELOW that point — what
// each role may actually do — is shared by both and does not change.
//
// The gate in functions/admin/_middleware.ts decides IDENTITY (a valid broker
// signature) and then ROLE (this module). Both proxies under /admin/api then ask
// this module again per request, because identity alone has never been
// authorization here (security-model.md I1) and a role is no different: the
// middleware admits an editor to /admin, and it is these checks — not that
// admission — that stop the editor from publishing.
//
// IMPORTANT: an editor is a lesser role, not an untrusted one. They can write your
// content. This bounds what a compromised or careless editor reaches; it is not a
// sandbox for someone you would not otherwise let near the site.

export type Role = "owner" | "editor" | "viewer";

/**
 * The role GitHub's own booleans imply (docs/security-todo.md §10.2). This is what
 * replaces the lists above: `GET /repos/{owner}/{repo}` → `permissions`, and no
 * record of who anyone is is kept anywhere.
 *
 * Read most-privileged first — GitHub sets every lower boolean too, so an admin
 * arrives with `push` and `pull` also true.
 *
 * On `viewer`: GitHub's collaborator `permission` parameter is documented as *"Only
 * valid on organization-owned repositories"*, defaulting to `push`. So on a personal
 * repo every collaborator gets write and this role simply never occurs. It costs one
 * boolean read to be correct the day a tenant repo is org-owned, and simulating it
 * with a list of our own is the exact move this migration exists to stop.
 */
export function roleFromPermissions(permissions: unknown): Role | null {
  const p =
    permissions && typeof permissions === "object"
      ? (permissions as Record<string, unknown>)
      : null;
  if (!p) return null;
  if (p.admin === true) return "owner";
  if (p.push === true || p.maintain === true) return "editor";
  if (p.pull === true) return "viewer";
  return null;
}

/**
 * A viewer may read the CMS and change nothing. Their token cannot write the repo
 * either — GitHub would refuse — but a 403 from us says something useful, where a
 * 403 from GitHub arrives mid-save as an unexplained failure.
 */
export function roleMayWrite(role: Role): boolean {
  return role !== "viewer";
}

/** Parse a comma list (the `adminLogin` form) or an array (the `editors` form). */
function loginSet(value: unknown): Set<string> {
  const raw =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [];
  return new Set(raw.map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/**
 * The role this login holds, or null if none. Owner wins when a login appears in
 * both lists — a demotion has to be an explicit removal from `adminLogin`, never a
 * side effect of also being listed as an editor.
 */
export function resolveRole(
  login: string | null | undefined,
  adminLogin: unknown,
  editors: unknown,
): Role | null {
  if (typeof login !== "string" || !login) return null;
  const who = login.toLowerCase();
  if (loginSet(adminLogin).has(who)) return "owner";
  if (loginSet(editors).has(who)) return "editor";
  return null;
}

// The only paths an editor may WRITE. Everything else in the repo — lanza.config.json
// (who is an owner), data/*.json (settings, the content model, redirects, menus),
// templates/, themes/, and every build file — is owner-only.
//
// Trailing slashes are load-bearing: "content/" must not admit "contentious.md",
// and a bare "content" is a file path, not the directory.
const EDITOR_WRITE_PREFIXES = ["content/", "public/images/uploads/"];

// A dot segment defeats a prefix test outright: `content/../data/site.json` starts
// with "content/" and lands in settings. The proxy's own allowlist rejects these in
// the URL path, but a git-data TREE ENTRY path travels in the request BODY and is
// never seen by that check — so it has to be rejected here too, for both.
const DOT_SEGMENT = /(^|\/)\.\.?(\/|$)/;

function underEditorPrefix(path: string): boolean {
  if (DOT_SEGMENT.test(path)) return false;
  return EDITOR_WRITE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Decode a path the way the thing downstream will, before testing it against the
 * prefixes — otherwise `%64ata/site.json` reads as "not settings" here and lands as
 * `data/site.json` at GitHub. Looped because `%2564` decodes to `%64` decodes to
 * `d`, and bounded so a hostile input cannot spin.
 *
 * A malformed escape returns null and the caller REFUSES. Throwing here would turn
 * an authorization question into a 500, and "the server errored" is not "no".
 */
function decodePath(path: string): string | null {
  let p = path.replace(/\\/g, "/");
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(p);
    } catch {
      return null;
    }
    if (next === p) return p;
    p = next.replace(/\\/g, "/");
  }
  return p;
}

/**
 * The branch an editor is allowed to move or write to. Publishing is a merge into
 * production, so keeping an editor off `main` entirely is what makes "cannot
 * publish" true — refusing `POST /merges` alone would not, because the contents and
 * git-data APIs can both target a branch directly.
 */
export interface EditorPolicy {
  workingBranch: string;
  productionBranch: string;
}

export interface Decision {
  ok: boolean;
  /** Why it was refused — surfaced to the CMS so it can say something useful. */
  reason?: string;
}

const ALLOW: Decision = { ok: true };
const deny = (reason: string): Decision => ({ ok: false, reason });

/**
 * May an EDITOR make this call to the GitHub proxy? Owners skip this entirely.
 *
 * `body` is the already-parsed JSON request body (or null for a GET/DELETE without
 * one). The caller must pass the SAME bytes it is about to forward — checking a
 * re-read or re-serialized body would be checking a different request than the one
 * GitHub executes.
 *
 * Reads are not restricted: the CMS cannot render without the schema, the menus and
 * the settings files, and an editor is someone you have already let into /admin.
 */
export function editorMayCall(
  method: string,
  path: string,
  body: unknown,
  policy: EditorPolicy,
): Decision {
  const m = method.toUpperCase();
  const p = path.replace(/[?#].*$/, "").replace(/^\/+/, "");
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;

  if (m === "GET" || m === "HEAD") return ALLOW;

  // Publish. The obvious one, and the least sufficient — see the branch checks below.
  if (m === "POST" && p === "merges") {
    return deny("Only an owner can publish.");
  }

  // contents/*: create, update, delete a single file.
  if ((m === "PUT" || m === "DELETE") && p.startsWith("contents/")) {
    const filePath = decodePath(p.slice("contents/".length));
    if (filePath === null) return deny("Malformed path.");
    if (!underEditorPrefix(filePath)) {
      return deny(`Only an owner can change ${filePath}.`);
    }
    // GitHub defaults an absent `branch` to the repository's DEFAULT branch, which
    // is production. So an omitted branch is not "unspecified", it is "main" —
    // it has to be refused explicitly rather than allowed through as a no-op.
    const branch = record?.branch;
    if (branch !== policy.workingBranch) {
      return deny("An editor can only write to the working branch.");
    }
    return ALLOW;
  }

  // git-data. This is the path that makes a `contents/` prefix check on its own
  // worthless: commitFiles builds a tree and fast-forwards a ref, never touching
  // contents/*. A tree may name ANY path in the repo, so the entries are checked
  // with the same prefix rule, and the ref update is pinned to the working branch.
  if (m === "POST" && p === "git/blobs") return ALLOW; // content-addressed; commits nothing
  if (m === "POST" && p === "git/commits") return ALLOW; // dangling until a ref moves

  if (m === "POST" && p === "git/trees") {
    const entries = record?.tree;
    if (!Array.isArray(entries)) return deny("Malformed tree.");
    for (const entry of entries) {
      const entryPath = (entry as Record<string, unknown> | null)?.path;
      if (typeof entryPath !== "string") return deny("Malformed tree.");
      const decoded = decodePath(entryPath);
      if (decoded === null || !underEditorPrefix(decoded)) {
        return deny(`Only an owner can change ${entryPath}.`);
      }
    }
    return ALLOW;
  }

  // Moving a ref is the moment a commit becomes real. Working branch only, both for
  // creating it and for fast-forwarding it.
  if (m === "POST" && p === "git/refs") {
    const ref = record?.ref;
    if (ref !== `refs/heads/${policy.workingBranch}`) {
      return deny("An editor can only write to the working branch.");
    }
    return ALLOW;
  }
  if (m === "PATCH" && p === `git/refs/heads/${policy.workingBranch}`) return ALLOW;
  if (m === "PATCH" && p.startsWith("git/refs/")) {
    return deny("An editor can only write to the working branch.");
  }

  return deny("An editor is not allowed to make this change.");
}

/**
 * The Cloudflare proxy (/admin/api/cf/*) is owner-only, with no per-path nuance:
 * it carries an ACCOUNT-scoped Cloudflare token and performs no authorization of
 * its own (security-model.md I1), so role is the whole gate.
 */
export function roleMayUseCloudflare(role: Role): boolean {
  return role === "owner";
}
