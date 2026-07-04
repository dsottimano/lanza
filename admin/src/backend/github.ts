import { REPO } from "./config";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

// All GitHub traffic goes through our own proxy (prod: Pages Function at
// functions/admin/api/gh/[[path]].ts; dev: the vite middleware in vite.config.ts).
// The proxy injects the token server-side, so it never touches the browser.
const API = "/admin/api/gh";

export interface RepoFile {
  name: string; // file name, e.g. hello-world.md
  path: string; // full repo path
  sha: string; // blob sha (needed for update/delete)
}

export interface LoadedEntry {
  path: string;
  sha: string;
  data: Record<string, unknown>;
  body: string; // raw markdown body as stored in the file
}

export interface LoadedJson {
  path: string;
  sha: string;
  data: Record<string, unknown>;
}

export interface LoadedText {
  path: string;
  sha: string;
  text: string; // raw file text (no frontmatter parse)
}

// ── base64 <-> UTF-8 (GitHub content is base64 of UTF-8 bytes) ──
function b64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function utf8ToB64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class GitHubClient {
  // No token held client-side — the proxy injects it server-side.

  private async req(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      // Never serve API reads from the browser cache: a stale GET returns a stale
      // blob sha, which makes the next write fail with a 409 conflict.
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      // GitHub returns JSON like {"message":"Not Found", ...}. Surface that
      // human string, not the raw JSON, to the error dialog.
      const raw = await res.text();
      let detail = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.message === "string") detail = parsed.message;
      } catch {
        /* non-JSON body — keep raw text */
      }
      throw new GitHubError(res.status, detail);
    }
    return res.status === 204 ? null : res.json();
  }

  /** Validate the token and return the authenticated login. */
  async getLogin(): Promise<string> {
    const user = (await this.req("/user")) as { login: string };
    return user.login;
  }

  private contentsUrl(p: string, withRef = true, ref: string = REPO.branch): string {
    const base = `/contents/${p}`;
    return withRef ? `${base}?ref=${ref}` : base;
  }

  /**
   * List markdown files in a folder-collection directory. A 404 means the
   * directory doesn't exist yet (GitHub has no empty folders, so a locale
   * subfolder with no entries 404s) — treat that as an empty list, not an error.
   */
  async listDir(dir: string): Promise<RepoFile[]> {
    let items: Array<{ name: string; path: string; sha: string; type: string }>;
    try {
      items = (await this.req(this.contentsUrl(dir))) as typeof items;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return [];
      throw e;
    }
    return items
      .filter((it) => it.type === "file" && it.name.endsWith(".md"))
      .map(({ name, path, sha }) => ({ name, path, sha }));
  }

  /**
   * List the immediate SUBDIRECTORIES of a repo directory (e.g. the per-template
   * folders under `templates/`). A 404 (directory absent) is an empty list, same
   * as listDir. Returns dir name + path; a template dir's name IS its `preset`.
   */
  async listSubdirs(dir: string): Promise<{ name: string; path: string }[]> {
    let items: Array<{ name: string; path: string; type: string }>;
    try {
      items = (await this.req(this.contentsUrl(dir))) as typeof items;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return [];
      throw e;
    }
    return items
      .filter((it) => it.type === "dir")
      .map(({ name, path }) => ({ name, path }));
  }

  /** Does a file exist at `path` on the branch? Used to detect media name clashes. */
  async exists(path: string): Promise<boolean> {
    return (await this.currentSha(path)) !== undefined;
  }

  /** Load a markdown entry: parsed frontmatter + raw body. */
  async loadEntry(path: string): Promise<LoadedEntry> {
    const file = (await this.req(this.contentsUrl(path))) as {
      content: string;
      sha: string;
    };
    const raw = b64ToUtf8(file.content);
    const { data, body } = parseFrontmatter(raw);
    return { path, sha: file.sha, data, body };
  }

  /** Create or update a markdown entry. Omit `sha` to create. */
  async saveEntry(
    path: string,
    data: Record<string, unknown>,
    body: string,
    message: string,
    sha?: string,
  ): Promise<string> {
    return this.putFile(path, serializeFrontmatter(data, body), message, sha);
  }

  /** Load a JSON settings file (from `ref`, the working branch by default). */
  async loadJson(path: string, ref: string = REPO.branch): Promise<LoadedJson> {
    const file = (await this.req(this.contentsUrl(path, true, ref))) as {
      content: string;
      sha: string;
    };
    const data = JSON.parse(b64ToUtf8(file.content)) as Record<string, unknown>;
    return { path, sha: file.sha, data };
  }

  /** Save a JSON settings file (2-space indented, trailing newline). */
  async saveJson(
    path: string,
    data: Record<string, unknown> | unknown[],
    message: string,
    sha?: string,
  ): Promise<string> {
    return this.putFile(path, `${JSON.stringify(data, null, 2)}\n`, message, sha);
  }

  /** Load a raw text file (no frontmatter parse) — e.g. a template's HTML. */
  async loadText(path: string, ref: string = REPO.branch): Promise<LoadedText> {
    const file = (await this.req(this.contentsUrl(path, true, ref))) as {
      content: string;
      sha: string;
    };
    return { path, sha: file.sha, text: b64ToUtf8(file.content) };
  }

  /** Create or update a raw text file (e.g. a template's HTML). Omit `sha` to create. */
  async saveText(
    path: string,
    text: string,
    message: string,
    sha?: string,
  ): Promise<string> {
    return this.putFile(path, text, message, sha);
  }

  /**
   * Upload a binary file (image) given its raw base64 content. Creates the file,
   * or overwrites in place if a file with the same path already exists (a
   * re-upload of the same name replaces it). Its own commit — see Phase 4 notes.
   */
  async uploadBinary(path: string, base64: string, message: string): Promise<void> {
    try {
      await this.putRaw(path, base64, message);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 422) {
        const existing = (await this.req(this.contentsUrl(path))) as { sha: string };
        await this.putRaw(path, base64, message, existing.sha);
        return;
      }
      throw e;
    }
  }

  private async putFile(
    path: string,
    text: string,
    message: string,
    sha?: string,
  ): Promise<string> {
    return this.putRaw(path, utf8ToB64(text), message, sha);
  }

  private async putRaw(
    path: string,
    base64: string,
    message: string,
    sha?: string,
  ): Promise<string> {
    try {
      return await this.putRawOnce(path, base64, message, sha);
    } catch (e) {
      // Stale-sha conflict: the file moved on since we read it (another editor,
      // or an earlier save whose new sha we didn't keep). Re-fetch the current
      // sha and retry once — last-write-wins, which is fine for this
      // single-editor-mostly CMS. This is the ONE place writes recover from 409.
      if (e instanceof GitHubError && e.status === 409) {
        return this.putRawOnce(path, base64, message, await this.currentSha(path));
      }
      throw e;
    }
  }

  private async putRawOnce(
    path: string,
    base64: string,
    message: string,
    sha?: string,
  ): Promise<string> {
    const result = (await this.req(this.contentsUrl(path, false), {
      method: "PUT",
      body: JSON.stringify({ message, content: base64, branch: REPO.branch, sha }),
    })) as { content: { sha: string } };
    return result.content.sha;
  }

  /** Current blob sha of a file, or undefined if it doesn't exist. */
  private async currentSha(path: string): Promise<string | undefined> {
    try {
      const file = (await this.req(this.contentsUrl(path))) as { sha: string };
      return file.sha;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return undefined;
      throw e;
    }
  }

  async deleteFile(path: string, sha: string, message: string): Promise<void> {
    await this.req(this.contentsUrl(path, false), {
      method: "DELETE",
      body: JSON.stringify({ message, sha, branch: REPO.branch }),
    });
  }

  /**
   * Commit many files in ONE commit via the Git Data API — so a whole theme
   * lands as a single commit → a single Pages rebuild, not one commit (and one
   * build) per file. Each file's content is base64, so it's binary-safe. New
   * paths are created, existing paths overwritten; every other file in the repo
   * is left untouched (the new tree extends the current one via `base_tree`).
   * Returns the new commit sha. `onProgress` fires after each blob uploads.
   */
  async commitFiles(
    files: { path: string; base64: string }[],
    message: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<string> {
    if (files.length === 0) throw new Error("No files to commit.");
    const git = "/git";

    // Upload each file as a blob, collecting tree entries; then one commit.
    const tree: TreeEntry[] = [];
    let done = 0;
    for (const f of files) {
      const blob = (await this.req(`${git}/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: f.base64, encoding: "base64" }),
      })) as { sha: string };
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
      onProgress?.(++done, files.length);
    }
    return this.writeCommit(tree, message);
  }

  /**
   * Commit tree changes that reference EXISTING blobs (or delete paths) in one
   * commit — no blob upload. Used by revert: restored files point at the blob
   * sha they had before the apply, and added files are removed with `sha: null`
   * (the Git Data API's deletion form). Every other file is left untouched.
   */
  async commitTreeChanges(entries: TreeEntry[], message: string): Promise<string> {
    if (entries.length === 0) throw new Error("No changes to commit.");
    return this.writeCommit(entries, message);
  }

  // Build a new tree on top of the current branch head, commit it, and
  // fast-forward the branch. Shared by commitFiles / commitTreeChanges.
  private async writeCommit(tree: TreeEntry[], message: string): Promise<string> {
    const { branch } = REPO;
    const git = "/git";

    const ref = (await this.req(`${git}/ref/heads/${branch}`)) as {
      object: { sha: string };
    };
    const headSha = ref.object.sha;
    const headCommit = (await this.req(`${git}/commits/${headSha}`)) as {
      tree: { sha: string };
    };

    const newTree = (await this.req(`${git}/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
    })) as { sha: string };
    const commit = (await this.req(`${git}/commits`, {
      method: "POST",
      body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }),
    })) as { sha: string };
    await this.req(`${git}/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha }),
    });
    return commit.sha;
  }

  // ── working branch + publish ─────────────────────────────────────────────

  /**
   * Ensure the working (drafts) branch exists, branching it from production if
   * not. The CMS reads/writes REPO.branch (staging); on a fresh repo that branch
   * doesn't exist yet, so this runs at boot before the first read — otherwise
   * every read 404s and looks like an un-onboarded repo.
   */
  async ensureWorkingBranch(): Promise<void> {
    const git = "/git";
    try {
      await this.req(`${git}/ref/heads/${REPO.branch}`);
      return; // already exists
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e;
    }
    const prod = (await this.req(`${git}/ref/heads/${REPO.productionBranch}`)) as {
      object: { sha: string };
    };
    await this.req(`${git}/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${REPO.branch}`, sha: prod.object.sha }),
    });
  }

  /**
   * Publish: merge the working branch into production (which triggers the public
   * rebuild). Returns whether anything was merged (`false` = production already
   * up to date). A merge conflict surfaces as GitHubError(409) for the caller to
   * report ("resolve on GitHub") — it never silently overwrites production.
   */
  async publish(message: string): Promise<{ merged: boolean }> {
    const res = (await this.req(`/merges`, {
      method: "POST",
      body: JSON.stringify({
        base: REPO.productionBranch,
        head: REPO.branch,
        commit_message: message,
      }),
    })) as { sha: string } | null;
    // 201 → merge commit; 204 (null) → base already contains head, nothing to do.
    return { merged: res !== null };
  }

  // ── Read-only history/diff endpoints (used by theme revert) ──────────────

  /** List commits on the branch, newest first (one page). */
  async listCommits(perPage: number, page = 1): Promise<CommitListItem[]> {
    const { branch } = REPO;
    const q = `sha=${branch}&per_page=${perPage}&page=${page}`;
    return (await this.req(
      `/commits?${q}`,
    )) as CommitListItem[];
  }

  /** One commit via the REST API — includes parents and per-file statuses. */
  async getCommit(sha: string): Promise<CommitDetail> {
    return (await this.req(
      `/commits/${sha}`,
    )) as CommitDetail;
  }

  /** Diff base…head. `status` tells us whether base is an ancestor of head. */
  async compare(base: string, head: string): Promise<CompareResult> {
    return (await this.req(
      `/compare/${base}...${head}`,
    )) as CompareResult;
  }

  /** Read a tree; recursive lists every blob path under it. */
  async getTree(sha: string, recursive = true): Promise<TreeResult> {
    const q = recursive ? "?recursive=1" : "";
    return (await this.req(
      `/git/trees/${sha}${q}`,
    )) as TreeResult;
  }

  /** Read a blob (base64 content). */
  async getBlob(sha: string): Promise<BlobResult> {
    return (await this.req(
      `/git/blobs/${sha}`,
    )) as BlobResult;
  }
}

// A Git Data API tree entry: point a path at an existing blob, or delete it
// with `sha: null`.
export type TreeEntry =
  | { path: string; mode: "100644"; type: "blob"; sha: string }
  | { path: string; mode: "100644"; type: "blob"; sha: null };

export interface CommitListItem {
  sha: string;
  commit: { message: string; author: { date: string } };
}

export interface CommitFile {
  filename: string;
  status: string; // added | modified | removed | renamed | ...
  previous_filename?: string;
}

export interface CommitDetail {
  sha: string;
  commit: { message: string; tree: { sha: string }; author: { date: string } };
  parents: { sha: string }[];
  files?: CommitFile[];
}

export interface CompareResult {
  status: string; // ahead | behind | identical | diverged
  files?: { filename: string; status: string }[];
}

export interface TreeResult {
  sha: string;
  tree: { path: string; type: string; sha: string; mode: string }[];
  truncated: boolean;
}

export interface BlobResult {
  sha: string;
  content: string;
  encoding: string;
}
