import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/admin/api/people.ts';
import { onRequest as proxy } from '../functions/admin/api/gh/[[path]].ts';
import { siteIdentityFor } from '../functions/_lib/site-access.ts';
import { ContentClient } from '../functions/_lib/lanza-content.ts';
import { resetIdentityCache } from '../functions/_lib/gh-identity.ts';
import { readFileSync } from 'node:fs';
const repo = JSON.parse(readFileSync(new URL('../lanza.config.json', import.meta.url)));
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; resetIdentityCache(); });
const env = { LANZA_SITE_ADMINS: 'alice' };
const native = { token: 'github-owner', role: 'owner' };
function fixture({ permission = true, admins, broken = false, refStatus, conflict = false } = {}) {
 const calls = [], trees = new Map(), commits = new Map(); let serial = 1;
 const sha = () => (serial++).toString(16).padStart(40, '0');
 let head = admins === undefined ? null : sha();
 if (head) commits.set(head, { content: JSON.stringify({ version: 1, admins }) });
 const ref = () => ({ ref: 'refs/heads/lanza-access', object: { type: 'commit', sha: head } });
 globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), path = u.pathname;
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: init.method || 'GET', body, headers: init.headers });
  assert.equal(u.origin, 'https://api.github.com', 'no Cloudflare request');
  if (path === '/user') return Response.json({ login: init.headers.Authorization.includes('writer') ? 'alice' : 'owner' });
  if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return Response.json({ permissions: { admin: permission && !init.headers.Authorization.includes('writer'), push: true } });
  assert.ok(path.startsWith(`/repos/${repo.owner}/${repo.name}/`), 'fixed tenant repository');
  if (path.endsWith('/git/ref/heads/lanza-access')) return refStatus ? new Response(null, { status: refStatus }) : head ? Response.json(ref()) : new Response(null, { status: 404 });
  if (path.endsWith('/contents/policy.json')) {
   assert.equal(u.searchParams.get('ref'), head);
   return Response.json({ type: 'file', encoding: 'base64', content: btoa(broken ? '{' : commits.get(head).content) });
  }
  if (path.endsWith('/git/trees')) { const id = sha(); assert.equal(body.base_tree, undefined); assert.equal(body.tree[0].path, 'policy.json'); trees.set(id, body.tree[0].content); return Response.json({ sha: id }); }
  if (path.endsWith('/git/commits')) { const id = sha(); commits.set(id, { content: trees.get(body.tree), parents: body.parents }); return Response.json({ sha: id }); }
  if (path.endsWith('/git/refs') || path.endsWith('/git/refs/heads/lanza-access')) {
   if (conflict || (init.method === 'POST' ? head !== null : commits.get(body.sha).parents[0] !== head)) return new Response(null, { status: 422 });
   if (init.method === 'PATCH') assert.equal(body.force, false); else { assert.equal(body.ref, 'refs/heads/lanza-access'); assert.deepEqual(commits.get(body.sha).parents, []); }
   head = body.sha; return Response.json(ref());
  }
  throw new Error(`Unexpected request ${url}`);
 };
 return { calls, current: () => head && JSON.parse(commits.get(head).content) };
}
function request(body, data = native, options = {}) {
 return onRequest({ env, data, request: new Request('https://site.test/admin/api/people', {
  method: body ? 'POST' : 'GET', headers: { Origin: 'https://site.test', ...options.headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), ...options.context });
}
const writes = state => state.calls.filter(c => c.method !== 'GET');
test('owner loads legacy co-admins using only GitHub and migrates with one save', async () => {
 const state = fixture(); const initial = await request();
 assert.equal(initial.headers.get('cache-control'), 'no-store');
 assert.deepEqual(await initial.json(), { logins: ['alice'], revision: 'legacy:alice', source: 'legacy' });
 const response = await request({ action: 'save', expectedRevision: 'legacy:alice', logins: ['BOB', 'alice', 'bob'] });
 assert.equal(response.status, 200); const result = await response.json();
 assert.equal(result.saved, true); assert.equal(result.source, 'github'); assert.deepEqual(state.current().admins, ['alice', 'bob']);
 assert.ok(state.calls.every(c => c.headers.Authorization === 'Bearer github-owner'));
 assert.equal(result.deployment, undefined);
});
test('empty GitHub policy overrides legacy grants and subsequent saves preserve history', async () => {
 const state = fixture({ admins: ['alice'] }); const initial = await (await request()).json();
 const saved = await (await request({ action: 'save', expectedRevision: initial.revision, logins: [] })).json();
 assert.equal(saved.saved, true); assert.deepEqual((await (await request()).json()).logins, []);
 const identity = await siteIdentityFor('writer', repo.owner, repo.name, env);
 assert.equal(identity.identity.role, 'editor'); assert.deepEqual(state.current().admins, []);
 assert.equal(writes(state).at(-1).body.force, false);
});
test('policy changes apply to existing sessions without waiting for identity cache expiry', async () => {
 fixture({ admins: ['alice'] });
 assert.equal((await siteIdentityFor('writer', repo.owner, repo.name)).identity.delegated, true);
 const initial = await (await request()).json();
 await request({ action: 'save', expectedRevision: initial.revision, logins: [] });
 assert.equal((await siteIdentityFor('writer', repo.owner, repo.name, env)).identity.role, 'editor');
});
test('delegates, editors, absent sessions and forged owner contexts cannot write policy', async () => {
 const state = fixture({ permission: false });
 for (const data of [{ ...native, delegated: true }, { ...native, role: 'editor' }, {}, native]) assert.ok([401,403].includes((await request({ action: 'save', expectedRevision: 'legacy:alice', logins: ['eve'] }, data)).status));
 assert.equal(writes(state).length, 0);
});
test('cross-origin and absent-origin writes are refused before using credentials', async () => {
 const state = fixture();
 for (const Origin of ['https://evil.test', 'null', '']) assert.equal((await request({ action: 'save' }, native, { headers: { Origin } })).status, 403);
 assert.equal(state.calls.length, 0);
});
test('stale forms, invalid lists and oversized input never write', async () => {
 const state = fixture();
 for (const body of [{ action: 'save', expectedRevision: 'stale', logins: [] }, ...[['@bob'], ['bob,eve'], ['b--ob'], Array(51).fill('bob')].map(logins => ({ action: 'save', expectedRevision: 'legacy:alice', logins })), { action: 'save', padding: 'x'.repeat(9000) }, { action: 'deploy' }]) assert.ok([400,409,413].includes((await request(body)).status));
 assert.equal(writes(state).length, 0);
});
test('concurrent initialization or updates cannot overwrite another owner save', async () => {
 for (const admins of [undefined, ['alice']]) {
  const state = fixture({ admins, conflict: true }); const initial = await (await request()).json();
  const response = await request({ action: 'save', expectedRevision: initial.revision, logins: ['bob'] });
  assert.equal(response.status, 409); assert.equal((await response.json()).saved, undefined);
  assert.deepEqual(state.current(), admins ? { version: 1, admins } : null);
 }
});
test('broken policy and upstream outages never restore legacy grants or admit writers', async () => {
 for (const options of [{ admins: ['alice'], broken: true }, { admins: ['@alice'] }, { refStatus: 403 }, { refStatus: 429 }, { refStatus: 500 }]) {
  resetIdentityCache(); const state = fixture(options);
  assert.equal((await siteIdentityFor('writer', repo.owner, repo.name, env)).status, 'unavailable');
  assert.notEqual((await request({ action: 'save', expectedRevision: 'legacy:alice', logins: [] })).status, 200);
  assert.equal(writes(state).length, 0);
  assert.equal((await siteIdentityFor(native.token, repo.owner, repo.name, env)).identity.role, 'owner', 'native owner can still recover');
 }
});
test('generic proxy cannot mutate access branch through any ref-changing API, including for delegates', async () => {
 const state = fixture();
 for (const delegated of [false, true]) for (const [method, path, body] of [
  ['PUT', 'contents/policy.json', { branch: 'lanza-access', content: 'e30=' }],
  ['DELETE', 'contents/policy.json', { branch: 'lanza-access' }],
  ['POST', 'git/refs', { ref: 'refs/heads/lanza-access', sha: 'a'.repeat(40) }],
  ['POST', 'merges', { base: 'lanza-access', head: 'staging' }],
  ['PATCH', 'git/refs/heads/lanza-access', { sha: 'a'.repeat(40), force: true }],
 ]) {
  const result = await proxy({ env: {}, params: { path }, data: { ...native, delegated }, request: new Request(`https://site.test/admin/api/gh/${path}`, { method, body: JSON.stringify(body) }) });
  assert.equal(result.status, 403);
 }
 assert.equal(state.calls.length, 0);
});
test('internal transport rejects arbitrary branches, paths and forced updates without network calls', async () => {
 const state = fixture(), client = new ContentClient(repo, 'github-owner');
 for (const [method, path, body] of [ ['GET', 'contents/policy.json?ref=main'], ['PATCH', 'git/refs/heads/lanza-access', { sha: 'a'.repeat(40), force: true }], ['POST', 'git/refs', { ref: 'refs/heads/main', sha: 'a'.repeat(40) }], ['POST', 'git/trees', { base_tree: 'a'.repeat(40), tree: [] }] ]) await assert.rejects(client.siteAccessPolicy(method, path, body));
 assert.equal(state.calls.length, 0);
});

test('two simultaneous saves leave exactly one complete policy and return a conflict for the other', async () => {
 for (const admins of [undefined, ['alice']]) {
  const state = fixture({ admins }); const initial = await (await request()).json();
  const results = await Promise.all(['bob', 'eve'].map(login => request({ action: 'save', expectedRevision: initial.revision, logins: [login] })));
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
  assert.ok(['bob', 'eve'].includes(state.current().admins[0]));
  assert.equal(state.current().admins.length, 1);
 }
});
