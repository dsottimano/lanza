// Derive a URL/filename-safe slug from an entry title. (Lives here, not in a
// former `auth.ts` — the GitHub token is held server-side behind the
// `/admin/api/gh` proxy, so the CMS has no client-side auth to house.)
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
