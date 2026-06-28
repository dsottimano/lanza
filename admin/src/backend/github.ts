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
  // The token is no longer held client-side — the proxy injects it. The optional
  // param is kept so existing call sites compile until Phase 2 removes the login
  // flow that still constructs the client with a pasted token.
  constructor(_token?: string) {}

  private async req(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
      ...init,
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
}
