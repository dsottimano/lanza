// Slug helper for deriving filenames from entry titles.
//
// Auth no longer lives here: the GitHub token is held server-side behind the
// `/admin/api/gh` proxy (Cloudflare Pages Function in prod, Vite middleware in
// dev). Past Cloudflare Access the CMS boots straight in — there is no browser
// token and no "Sign in with Token" screen.
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
