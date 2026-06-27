import { REPO, POSTS_DIR } from "./config";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

const API = "https://api.github.com";

export interface PostEntry {
  name: string; // file name, e.g. hello-world.md
  path: string; // full repo path
  sha: string; // blob sha (needed for update/delete)
}

export interface LoadedPost {
  path: string;
  sha: string;
  data: Record<string, unknown>;
  body: string; // raw body as stored in the file
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
  constructor(private token: string) {}

  private async req(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      throw new GitHubError(res.status, `GitHub ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? null : res.json();
  }

  /** Validate the token and return the authenticated login. */
  async getLogin(): Promise<string> {
    const user = (await this.req("/user")) as { login: string };
    return user.login;
  }

  private repoPath(p: string): string {
    return `/repos/${REPO.owner}/${REPO.name}/contents/${p}?ref=${REPO.branch}`;
  }

  async listPosts(): Promise<PostEntry[]> {
    const items = (await this.req(this.repoPath(POSTS_DIR))) as Array<{
      name: string;
      path: string;
      sha: string;
      type: string;
    }>;
    return items
      .filter((it) => it.type === "file" && it.name.endsWith(".md"))
      .map(({ name, path, sha }) => ({ name, path, sha }));
  }

  async loadPost(path: string): Promise<LoadedPost> {
    const file = (await this.req(this.repoPath(path))) as {
      content: string;
      sha: string;
    };
    const raw = b64ToUtf8(file.content);
    const { data, body } = parseFrontmatter(raw);
    return { path, sha: file.sha, data, body };
  }

  /** Create or update a post. Omit `sha` to create; pass it to update. */
  async savePost(
    path: string,
    data: Record<string, unknown>,
    body: string,
    message: string,
    sha?: string,
  ): Promise<string> {
    const content = utf8ToB64(serializeFrontmatter(data, body));
    const result = (await this.req(
      `/repos/${REPO.owner}/${REPO.name}/contents/${path}`,
      {
        method: "PUT",
        body: JSON.stringify({ message, content, branch: REPO.branch, sha }),
      },
    )) as { content: { sha: string } };
    return result.content.sha;
  }

  async deletePost(path: string, sha: string, message: string): Promise<void> {
    await this.req(`/repos/${REPO.owner}/${REPO.name}/contents/${path}`, {
      method: "DELETE",
      body: JSON.stringify({ message, sha, branch: REPO.branch }),
    });
  }
}
