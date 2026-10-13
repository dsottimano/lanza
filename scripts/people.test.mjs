import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/admin/api/people.ts';
import { resetIdentityCache } from '../functions/_lib/gh-identity.ts';
import { readFileSync } from 'node:fs';
const repo = JSON.parse(readFileSync(new URL('../lanza.config.json', import.meta.url)));
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; resetIdentityCache(); });
const env = { CLOUDFLARE_API_TOKEN: 'secret-cf', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), PAGES_PROJECT: 'site', LANZA_SITE_ADMINS: 'alice' };
function fixture({ permission = true, mismatch = false, deploymentFails = false, encrypted = false } = {}) {
 const calls = []; let value = 'alice';
 globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, ...init });
  if (String(url).includes('api.github.com')) return Response.json(String(url).endsWith('/user') ? { login: 'owner' } : { permissions: { admin: permission, push: true } });
  if (init.method === 'PATCH') { const patch = JSON.parse(init.body); assert.deepEqual(Object.keys(patch.deployment_configs), ['production']); assert.deepEqual(Object.keys(patch.deployment_configs.production.env_vars), ['LANZA_SITE_ADMINS']); value = patch.deployment_configs.production.env_vars.LANZA_SITE_ADMINS.value; return Response.json({ success: true, result: {} }); }
  if (init.method === 'POST') {
   assert.equal(init.body.get('branch'), 'main');
   if (deploymentFails) return new Response('secret-cf raw failure', { status: 403 });
   return Response.json({ success: true, result: { id: 'build-1', environment: 'production', latest_stage: { name: 'build', status: 'active' } } });
  }
  if (String(url).endsWith('/deployments/build-1')) return Response.json({ success: true, result: { id: 'build-1', environment: 'production', latest_stage: { name: 'deploy', status: 'success' } } });
  return Response.json({ success: true, result: { source: { type: 'github', config: { owner: mismatch ? 'other' : repo.owner, repo_name: repo.name } }, production_branch: 'main', deployment_configs: { production: { env_vars: { SECRET: { type: 'secret_text', value: 'never-return' }, LANZA_SITE_ADMINS: { type: encrypted ? 'secret_text' : 'plain_text', value } } } } } });
 };
 return calls;
}
function request(body, data = { token: 'github', role: 'owner' }, options = {}) {
 const method = body ? 'POST' : 'GET';
 return onRequest({ env, data, request: new Request('https://site.test/admin/api/people', { method, headers: { Origin: 'https://site.test', ...options.headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), ...options.context });
}
test('native owner reads configured and active lists without exposing credentials or unrelated secrets', async () => {
 fixture(); const initial = await request(); assert.equal(initial.status, 200); assert.deepEqual((await initial.json()).active, ['alice']);
 const response = await request({ action: 'read' }); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(await response.json(), { logins: ['alice'], revision: 'alice' });
});
test('delegates, editors, absent sessions and forged owner contexts cannot access Cloudflare', async () => {
 const calls = fixture({ permission: false });
 for (const data of [{ token: 'github', role: 'owner', delegated: true }, { token: 'github', role: 'editor' }, {}, { token: 'github', role: 'owner' }]) assert.ok([401,403].includes((await request({ action: 'read' }, data)).status));
 assert.equal(calls.filter(c => c.url.includes('cloudflare')).length, 0);
});
test('rejects cross-origin writes before using credentials', async () => {
 const calls = fixture(); assert.equal((await request({ action: 'read' }, undefined, { headers: { Origin: 'https://evil.test' } })).status, 403); assert.equal(calls.length, 0);
});
test('save updates only production delegation and starts production deployment; empty list revokes all', async () => {
 const calls = fixture(); const response = await request({ action: 'save', expectedRevision: 'alice', logins: [] });
 const result = await response.json(); assert.equal(result.saved, true); assert.deepEqual(result.logins, []); assert.equal(result.deployment.status, 'active'); assert.equal(calls.filter(c => c.method === 'PATCH').length, 1);
});
test('stale revision, malformed usernames and oversized bodies never write', async () => {
 const calls = fixture();
 for (const body of [{ action: 'save', expectedRevision: 'stale', logins: [] }, { action: 'save', expectedRevision: 'alice', logins: ['@bob'] }, { action: 'save', expectedRevision: 'alice', logins: ['bob,eve'] }, { action: 'read', padding: 'x'.repeat(9000) }]) assert.ok([400,409,413].includes((await request(body)).status));
 assert.equal(calls.filter(c => c.method === 'PATCH' || c.method === 'POST').length, 0);
});
test('mismatched repository and encrypted config refuse changes without writes', async () => {
 for (const options of [{ mismatch: true }, { encrypted: true }]) { const calls = fixture(options); assert.ok([403,409].includes((await request({ action: 'save', expectedRevision: 'alice', logins: [] })).status)); assert.equal(calls.filter(c => c.method === 'PATCH').length, 0); }
});
test('server token cannot be redirected to client account or project', async () => {
 const calls = fixture(); await request({ action: 'read', connection: { account: 'b'.repeat(32), project: 'evil', token: 'evil' } });
 assert.ok(calls.filter(c => c.url.includes('cloudflare')).every(c => c.url.includes(`/accounts/${'a'.repeat(32)}/pages/projects/site`) && c.headers.Authorization === 'Bearer secret-cf'));
});
test('unconfigured owner can use request-scoped credential; path injection is rejected', async () => {
 const calls = fixture(); const context = { env: {} };
 const good = await request({ action: 'read', connection: { account: 'b'.repeat(32), project: 'site', token: 'temporary' } }, undefined, { context }); assert.equal(good.status, 200);
 const bad = await request({ action: 'read', connection: { account: '../escape', project: 'site', token: 'temporary' } }, undefined, { context }); assert.equal(bad.status, 400);
 assert.equal(calls.filter(c => c.url.includes('cloudflare')).length, 1);
});
test('deployment failure reports saved but inactive; retry does not rewrite policy', async () => {
 const calls = fixture({ deploymentFails: true });
 const result = await (await request({ action: 'save', expectedRevision: 'alice', logins: ['bob'] })).json();
 assert.equal(result.saved, true); assert.equal(result.deployment, null); assert.match(result.warning, /not changed yet/); assert.ok(!JSON.stringify(result).includes('secret-cf'));
 await request({ action: 'deploy', expectedRevision: 'bob' }); assert.equal(calls.filter(c => c.method === 'PATCH').length, 1);
});
test('deployment status returns only safe status fields', async () => {
 fixture(); const result = await (await request({ action: 'status', deploymentId: 'build-1' })).json(); assert.equal(result.deployment.status, 'success');
 assert.equal((await request({ action: 'status', deploymentId: '../escape' })).status, 400);
});
