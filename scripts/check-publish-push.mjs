// A local pre-push guard against deploying code/content over unreconciled CMS
// drafts. Fetch the actual staging tip; a stale remote-tracking ref is insufficient.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkPublishPush(remote, updates, cwd = process.cwd()) {
  const main = updates.find(row => row.remoteRef === 'refs/heads/main');
  if (!main) return;
  if (/^0+$/.test(main.sha)) throw new Error('Refusing to delete the production branch.');
  const git = args => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const remoteTip = git(['ls-remote', '--heads', remote, 'refs/heads/staging']);
  if (remoteTip.status !== 0) throw new Error('Cannot check CMS drafts. Fetch the remote successfully before publishing.');
  if (!remoteTip.stdout.trim()) return; // Fresh site without a draft branch.
  const fetched = git(['fetch', '--no-tags', remote, 'refs/heads/staging']);
  if (fetched.status !== 0) throw new Error('Cannot fetch CMS drafts. Nothing was pushed.');
  const contains = git(['merge-base', '--is-ancestor', 'FETCH_HEAD', main.sha]);
  if (contains.status !== 0) {
    throw new Error('CMS staging contains work that this production commit does not include. Merge main into staging, preserve the CMS edits, validate the combined result, then publish that commit. Do not force-push or bypass this guard.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const updates = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean).map(line => {
      const [, sha, remoteRef] = line.split(/\s+/); return { sha, remoteRef };
    });
    checkPublishPush(process.argv[2] ?? 'origin', updates);
  } catch (error) { console.error(`Publish stopped: ${error.message}`); process.exitCode = 1; }
}
