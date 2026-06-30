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

  private contentsUrl(p: string, withRef = true): string {
    const base = `/repos/${REPO.owner}/${REPO.name}/contents/${p}`;
    return withRef ? `${base}?ref=${REPO.branch}` : base;
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

  /** Load a JSON settings file. */
  async loadJson(path: string): Promise<LoadedJson> {
    const file = (await this.req(this.contentsUrl(path))) as {
      content: string;
      sha: string;
    };
    const data = JSON.parse(b64ToUtf8(file.content)) as Record<string, unknown>;
    return { path, sha: file.sha, data };
  }

  /** Save a JSON settings file (2-space indented, trailing newline). */
  async saveJson(
    path: string,
    data: Record<string, unknown>,
    message: string,
    sha?: string,
  ): Promise<string> {
    return this.putFile(path, `${JSON.stringify(data, null, 2)}\n`, message, sha);
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
    const result = (await this.req(this.contentsUrl(path, false), {
      method: "PUT",
      body: JSON.stringify({ message, content: base64, branch: REPO.branch, sha }),
    })) as { content: { sha: string } };
    return result.content.sha;
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
    const { owner, name, branch } = REPO;
    const git = `/repos/${owner}/${name}/git`;

    // 1. current branch head and the tree it points at (our base).
    const ref = (await this.req(`${git}/ref/heads/${branch}`)) as {
      object: { sha: string };
    };
    const headSha = ref.object.sha;
    const headCommit = (await this.req(`${git}/commits/${headSha}`)) as {
      tree: { sha: string };
    };

    // 2. upload each file as a blob, collecting tree entries.
    const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
    let done = 0;
    for (const f of files) {
      const blob = (await this.req(`${git}/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: f.base64, encoding: "base64" }),
      })) as { sha: string };
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
      onProgress?.(++done, files.length);
    }

    // 3. new tree on top of the current one, 4. one commit, 5. fast-forward ref.
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
}
