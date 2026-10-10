// Content operations against the tenant's own GitHub repo, mirroring the exact
// endpoints the Vue CMS uses (admin/src/backend/github.ts): the Contents API on the
// WORKING_BRANCH (staging) for reads/writes, and reviewed fast-forwards to publish.
// Repo identity (owner/name) is passed in from lanza.config.json — deliberately NOT
// hard-coded here, the same discipline as gh-proxy.ts, so this ships tenant-agnostic
// in lanza-site. Consumed by the MCP server (functions/api/mcp.ts).
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";
import { BRANCH, WORKING_BRANCH } from "./gh-proxy";

const GITHUB_API = "https://api.github.com";

export interface Repo {
  owner: string;
  name: string;
}

export interface Entry {
  path: string;
  sha: string;
  data: Record<string, unknown>;
  body: string;
}

export interface ChangedFile {
  path: string;
  status: string;
}

export interface PublishHeads {
  productionSha: string;
  stagingSha: string;
}

export interface PublishReview extends PublishHeads {
  status: "ahead" | "behind" | "diverged" | "identical";
  files: ChangedFile[];
  complete: boolean;
}

function assertPublishHeads(review: PublishHeads): void {
  if (!review || !/^[a-f0-9]{40}$/.test(review.productionSha) || !/^[a-f0-9]{40}$/.test(review.stagingSha)) {
    throw new GitHubError(400, "Pass the productionSha and stagingSha returned by list_changes. Review the changes before publishing or updating drafts.");
  }
}

// A GitHub error the MCP layer can surface verbatim to the calling agent.
export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

// Base64 <-> UTF-8 string. GitHub returns base64 with embedded newlines and expects
// base64 on write; atob/btoa are byte-oriented, so round-trip through TextEncoder/
// Decoder to keep multibyte content (accents, emoji) intact.
function decodeBase64(b64: string): string {
  const bytes = Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// Structural path guard — the same discipline as gh-proxy.ts's dot-segment check,
// and for the same reason: encodeURIComponent does NOT escape dots, so `..` sails
// through encodePath and fetch() then normalizes it, escaping the
// repos/<owner>/<name>/ namespace entirely. Every path reaching the Contents API
// funnels through encodePath, so this is the one place that has to hold.
// Confining a path to a *collection* is a separate, higher-level concern — see
// assertEntryPath in mcp-core.ts. This only enforces "is a sane repo path".
export function assertSafePath(path: string): void {
  const p = String(path);
  if (!p || p !== p.trim()) throw new GitHubError(400, "Invalid path: empty or padded with whitespace.");
  if (p.startsWith("/")) throw new GitHubError(400, `Invalid path "${p}": must be repo-relative.`);
  if (p.includes("\\")) throw new GitHubError(400, `Invalid path "${p}": backslashes are not allowed.`);
  // Reject % outright: a legitimate repo path is literal, never pre-encoded, and
  // allowing it would let %2e%2e reconstitute a dot segment after decoding.
  if (p.includes("%")) throw new GitHubError(400, `Invalid path "${p}": percent-encoding is not allowed.`);
  if (p.includes("\0")) throw new GitHubError(400, "Invalid path: contains a null byte.");
  const segments = p.split("/");
  if (segments.some((s) => s === "." || s === ".."))
    throw new GitHubError(400, `Invalid path "${p}": path traversal is not allowed.`);
  if (segments.some((s) => s === ""))
    throw new GitHubError(400, `Invalid path "${p}": contains an empty segment.`);
  if (segments.some((s) => s.toLowerCase() === ".git"))
    throw new GitHubError(400, `Invalid path "${p}": the .git directory is off limits.`);
}

// Encode a repo path for the Contents API: percent-encode each segment but keep the
// slashes. CMS paths are slugged (no spaces), but this is safe for any input.
function encodePath(path: string): string {
  assertSafePath(path);
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export class ContentClient {
  private repo: Repo;
  private token: string;
  constructor(repo: Repo, token: string) {
    this.repo = repo;
    this.token = token;
  }

  private async gh(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${GITHUB_API}/repos/${this.repo.owner}/${this.repo.name}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "lanza-cms-mcp",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  }

  private async fail(res: Response, action: string): Promise<GitHubError> {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string };
      detail = body.message ? ` — ${body.message}` : "";
    } catch {
      /* non-JSON error body */
    }
    return new GitHubError(res.status, `Failed to ${action} (HTTP ${res.status})${detail}`);
  }

  // Create the staging branch off main if it doesn't exist yet (CMS boot does the
  // same). Idempotent: a concurrent create races to 422, which we treat as success.
  async ensureWorkingBranch(): Promise<void> {
    const ref = await this.gh(`git/ref/heads/${WORKING_BRANCH}`);
    if (ref.ok) return;
    if (ref.status !== 404) throw await this.fail(ref, "check the staging branch");
    const base = await this.gh(`git/ref/heads/${BRANCH}`);
    if (!base.ok) throw await this.fail(base, "read the main branch");
    const sha = ((await base.json()) as { object: { sha: string } }).object.sha;
    const created = await this.gh("git/refs", {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${WORKING_BRANCH}`, sha }),
    });
    if (!created.ok && created.status !== 422) {
      throw await this.fail(created, "create the staging branch");
    }
  }

  // List the .md entries directly under `dir` on staging. Missing dir → [].
  async list(dir: string): Promise<string[]> {
    const res = await this.gh(`contents/${encodePath(dir)}?ref=${WORKING_BRANCH}`);
    if (res.status === 404) return [];
    if (!res.ok) throw await this.fail(res, `list ${dir}`);
    const items = (await res.json()) as Array<{ type: string; name: string; path: string }>;
    return items
      .filter((i) => i.type === "file" && i.name.endsWith(".md"))
      .map((i) => i.path);
  }

  // Every immediate child of `dir`, with its type — directories included.
  // `list()` above filters to .md files, which is right for entries and useless for
  // the site system: validating templates means enumerating templates/<name>/ DIRS.
  // Falls back to main like readRaw, because templates/ may not have been touched on
  // staging. Missing dir on both → [].
  async listAll(dir: string): Promise<Array<{ type: string; name: string; path: string }>> {
    for (const ref of [WORKING_BRANCH, BRANCH]) {
      const res = await this.gh(`contents/${encodePath(dir)}?ref=${ref}`);
      if (res.ok) {
        const items = (await res.json()) as unknown;
        // A file (not a directory) comes back as an object, not an array.
        return Array.isArray(items) ? (items as Array<{ type: string; name: string; path: string }>) : [];
      }
      if (res.status !== 404) throw await this.fail(res, `list ${dir}`);
    }
    return [];
  }

  // Read one entry (frontmatter + HTML body + sha) from staging.
  async read(path: string): Promise<Entry> {
    const res = await this.gh(`contents/${encodePath(path)}?ref=${WORKING_BRANCH}`);
    if (!res.ok) throw await this.fail(res, `read ${path}`);
    const file = (await res.json()) as { content: string; sha: string };
    const { data, body } = parseFrontmatter(decodeBase64(file.content));
    return { path, sha: file.sha, data, body };
  }

  // Read a raw text file (e.g. data/schema.json) from staging, falling back to main
  // if it hasn't been touched on staging yet. Null if it exists on neither.
  async readRaw(path: string): Promise<string | null> {
    for (const ref of [WORKING_BRANCH, BRANCH]) {
      const res = await this.gh(`contents/${encodePath(path)}?ref=${ref}`);
      if (res.ok) {
        const file = (await res.json()) as { content: string };
        return decodeBase64(file.content);
      }
      if (res.status !== 404) throw await this.fail(res, `read ${path}`);
    }
    return null;
  }

  // Does this path already exist on staging? Lets create_content refuse to
  // clobber rather than upsert.
  async exists(path: string): Promise<boolean> {
    return (await this.currentSha(path)) !== undefined;
  }

  private async currentSha(path: string): Promise<string | undefined> {
    const res = await this.gh(`contents/${encodePath(path)}?ref=${WORKING_BRANCH}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw await this.fail(res, `stat ${path}`);
    return ((await res.json()) as { sha: string }).sha;
  }

  // Write a .md entry (create or update) to staging. Resolves the current sha so an
  // update never fails on a stale/missing sha (last-write-wins, like the CMS).
  //
  // `knownSha` lets a caller that ALREADY looked the path up skip the second lookup:
  // create_content calls exists() first to refuse a clobber, which fetched the exact
  // same endpoint this method would. Pass `null` for "I checked, it isn't there".
  // Omit it and the lookup happens as before.
  async save(
    path: string,
    data: Record<string, unknown>,
    body: string,
    message: string,
    knownSha?: string | null,
  ): Promise<string> {
    const content = encodeBase64(serializeFrontmatter(data, body));
    const sha = knownSha === undefined ? await this.currentSha(path) : (knownSha ?? undefined);
    const res = await this.gh(`contents/${encodePath(path)}`, {
      method: "PUT",
      body: JSON.stringify({ message, content, branch: WORKING_BRANCH, sha }),
    });
    if (!res.ok) throw await this.fail(res, `save ${path}`);
    return ((await res.json()) as { commit: { sha: string } }).commit.sha;
  }

  // Write a raw text file to staging. `save()` above serializes frontmatter + body for
  // a .md entry; a template.html or a fields.json is neither, and round-tripping one
  // through the frontmatter serializer would corrupt it.
  async saveText(path: string, text: string, message: string): Promise<string> {
    const res = await this.gh(`contents/${encodePath(path)}`, {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: encodeBase64(text),
        branch: WORKING_BRANCH,
        sha: await this.currentSha(path),
      }),
    });
    if (!res.ok) throw await this.fail(res, `save ${path}`);
    return ((await res.json()) as { commit: { sha: string } }).commit.sha;
  }

  async remove(path: string, message: string): Promise<void> {
    const sha = await this.currentSha(path);
    if (!sha) throw new GitHubError(404, `Cannot delete ${path}: it does not exist on staging.`);
    const res = await this.gh(`contents/${encodePath(path)}`, {
      method: "DELETE",
      body: JSON.stringify({ message, sha, branch: WORKING_BRANCH }),
    });
    if (!res.ok) throw await this.fail(res, `delete ${path}`);
  }

  private async publishHeads(): Promise<PublishHeads> {
    const readHead = async (branch: string): Promise<string> => {
      const res = await this.gh(`git/ref/heads/${branch}`);
      if (!res.ok) throw await this.fail(res, `read the ${branch} branch`);
      return ((await res.json()) as { object?: { sha?: string } }).object?.sha ?? "";
    };
    const [productionSha, stagingSha] = await Promise.all([readHead(BRANCH), readHead(WORKING_BRANCH)]);
    const heads = { productionSha, stagingSha };
    assertPublishHeads(heads);
    return heads;
  }

  private async requireReviewedHeads(review: PublishHeads): Promise<void> {
    assertPublishHeads(review);
    const current = await this.publishHeads();
    if (current.productionSha !== review.productionSha || current.stagingSha !== review.stagingSha) {
      throw new GitHubError(409, "The site or drafts changed since review. Call list_changes and review the new changes before continuing.");
    }
  }

  private async compareReview(heads: PublishHeads): Promise<PublishReview> {
    assertPublishHeads(heads);
    const res = await this.gh(`compare/${heads.productionSha}...${heads.stagingSha}?per_page=1`);
    if (!res.ok) throw await this.fail(res, "compare staging against main");
    const data = (await res.json()) as { status?: string; files?: Array<{ filename: string; status: string }> };
    if (!Array.isArray(data.files) || !["ahead", "behind", "diverged", "identical"].includes(data.status ?? "") ||
        data.files.some(file => !file || typeof file.filename !== "string" || typeof file.status !== "string")) {
      throw new GitHubError(502, "Could not verify the comparison. No branch was changed; retry list_changes.");
    }
    // GitHub returns at most 300 changed files, regardless of commit pagination.
    // At the limit we cannot prove the list is complete. Never bless a partial review.
    return { ...heads, status: data.status as PublishReview["status"],
      files: data.files.map(file => ({ path: file.filename, status: file.status })),
      complete: data.files.length < 300 };
  }

  async pendingChanges(): Promise<PublishReview> {
    return this.compareReview(await this.publishHeads());
  }

  // Reconcile only into drafts. A normal merge preserves concurrent staging work;
  // the resulting combined tree must be reviewed again before publication.
  async updateDrafts(review: PublishHeads): Promise<boolean> {
    await this.requireReviewedHeads(review);
    const res = await this.gh("merges", {
      method: "POST",
      body: JSON.stringify({ base: WORKING_BRANCH, head: review.productionSha,
        commit_message: "lanza: bring published changes into drafts via MCP" }),
    });
    if (res.status === 204) return false;
    if (res.status === 409) {
      throw new GitHubError(409, "Draft reconciliation has a merge conflict. Both branches are preserved. Resolve the conflict on staging, then call list_changes and review again.");
    }
    if (!res.ok) throw await this.fail(res, "update drafts");
    return true;
  }

  // Never trust a caller-supplied comparison status or publish a moving branch.
  async publish(review: PublishHeads): Promise<boolean> {
    await this.requireReviewedHeads(review);
    const diff = await this.compareReview(review);
    if (!diff.complete) throw new GitHubError(409, "The changed-file list may be truncated at GitHub's 300-file limit. Review and publish this change from a local Git checkout; MCP cannot verify a complete review.");
    if (diff.status === "diverged" || diff.status === "behind") {
      throw new GitHubError(409, "Production changed separately from drafts. Call update_drafts with the reviewed commits, then validate and review list_changes again before publishing.");
    }
    if (diff.status === "identical") return false;
    // Recheck after the comparison. GitHub's fast-forward check also protects the
    // final write from a concurrent production commit; later drafts remain drafts.
    await this.requireReviewedHeads(review);
    const res = await this.gh(`git/refs/heads/${BRANCH}`, {
      method: "PATCH", body: JSON.stringify({ sha: review.stagingSha, force: false }),
    });
    if (!res.ok) throw await this.fail(res, "publish the reviewed commit; call list_changes and review again");
    return true;
  }
}

// Slugify a title into a filename stem — matches the CMS's entry-path derivation.
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}
