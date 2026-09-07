import { roleFromPermissions } from "../../functions/_lib/roles";

// Vite has no session gate to supply identity. Ask GitHub using the server's
// token and return the same contract as the production /user endpoint.
export async function githubIdentity(token: string, repo: { owner: string; name: string }): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "lanza-cms-dev",
  };
  const [userResponse, repoResponse] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`, { headers }),
  ]);
  if (!userResponse.ok) return userResponse;
  if (!repoResponse.ok) return repoResponse;
  const user = await userResponse.json() as { login: string };
  const repository = await repoResponse.json() as { permissions?: unknown };
  return Response.json({
    login: user.login,
    role: roleFromPermissions(repository.permissions),
    repo: `${repo.owner}/${repo.name}`,
  });
}
