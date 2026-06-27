// Token-only auth: a GitHub fine-grained PAT (Contents: read/write on the repo)
// kept in localStorage. No OAuth Worker — same model Sveltia endorses for a solo
// editor. The token never leaves the browser except as a GitHub Bearer header.
const TOKEN_KEY = "studio:token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}
