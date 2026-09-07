import { GitHubClient } from './github';
import { isOwner } from './access';
import { planStarter, starterReadPaths } from '../../../functions/_lib/site-starters.mjs';

export async function prepareStarter(client: GitHubClient, options: { id: string; locale: string; look: string; includeSamples: boolean }) {
  if (!isOwner()) throw new Error('Only the site owner can install a starter.');
  const head = await client.workingHead();
  const tree = await client.getTree(head);
  if (tree.truncated) throw new Error('The repository listing is incomplete. No changes were prepared.');
  const paths = tree.tree.map(entry => entry.path);
  const texts: Record<string, string> = {};
  const shas: Record<string, string> = {};
  await Promise.all(starterReadPaths(options.id, options.locale).map(async (path: string) => {
    if (!paths.includes(path)) return;
    const file = await client.loadText(path, head);
    texts[path] = file.text; shas[path] = file.sha;
  }));
  const plan = planStarter({ ...options, paths, texts });
  return { ...plan, head, files: plan.files.map((file: { path: string; text: string; action: string }) => ({ ...file, sha: shas[file.path] })) };
}
export async function installStarter(client: GitHubClient, plan: Awaited<ReturnType<typeof prepareStarter>>) {
  if (!isOwner()) throw new Error('Only the site owner can install a starter.');
  return client.commitChecked(plan.head, plan.files, `lanza: install ${plan.label} starter (${plan.look})`);
}
