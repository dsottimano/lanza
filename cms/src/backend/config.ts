// Repo coordinates — must match public/admin/config.yml (backend.repo/branch)
// and the posts folder Astro reads. We are NOT moving the folder.
export const REPO = {
  owner: "dsottimano",
  name: "emdash-starter",
  branch: "main",
} as const;

export const POSTS_DIR = "src/content/posts";
