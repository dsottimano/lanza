import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { siteIdentityFor } from '../functions/_lib/site-access.ts';
import { resetIdentityCache } from '../functions/_lib/gh-identity.ts';
import { onRequest as gate } from '../functions/admin/_middleware.ts';
import { onRequest as proxy } from '../functions/admin/api/gh/[[path]].ts';
import { onRequest as mcp } from '../functions/api/mcp.ts';
import { onRequest as agentPoll } from '../functions/admin/api/auth/agent/poll.ts';
import { onRequest as requests } from '../functions/admin/api/agent-requests.ts';
import { onRequest as plugins } from '../functions/admin/api/plugins.ts';

const realFetch = globalThis.fetch;
const TOKEN = 'ghu_delegated_test';
const ORIGIN = 'https://tenant.pages.dev';
let permissions, repoStatus, calls, privateRepo;
beforeEach(() => {
  resetIdentityCache();
  permissions = { admin: false, push: true, pull: true };
  repoStatus = 200;
  privateRepo = true;
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    if (path === '/user') return Response.json({ login: 'Alice' });
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return Response.json({ permissions, private: privateRepo, full_name: 'dsottimano/lanza' }, { status: repoStatus });
    if (path.endsWith('/contents/requests') || path.endsWith('/contents/plugins/research/state.json')) return Response.json({}, { status: 404 });
    if (path === '/login/oauth/access_token') return Response.json({ access_token: TOKEN });
    if (path.endsWith('/contents/data/site.json') || path.endsWith('/git/refs/heads/main')) return Response.json({ ok: true });
    throw new Error(`Unexpected request ${path}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; resetIdentityCache(); });

async function throughGate(path, env = {}, { method = 'GET', body, headers = {} } = {}) {
  let reached = false;
  const context = {
    request: new Request(`${ORIGIN}${path}`, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { cookie: `lanza_gh=${TOKEN}`, ...headers },
    }), env,
    next: async () => {
      reached = true;
      if (path.startsWith('/admin/api/agent-requests')) return requests({ request: context.request, data: context.data });
      if (path.startsWith('/admin/api/plugins')) return plugins({ request: context.request, data: context.data });
      if (path.startsWith('/admin/api/gh/')) return proxy({
        request: context.request, env: {}, data: context.data,
        params: { path: new URL(context.request.url).pathname.slice('/admin/api/gh/'.length) },
      });
      return Response.json({ reached: true });
    },
  };
  const response = await gate(context);
  return { response, reached, data: context.data };
}

test('listed writer sees delegated administration and can update settings and publish using their own token', async () => {
  const env = { LANZA_SITE_ADMINS: 'bob, aLiCe' };
  const identity = await throughGate('/admin/api/gh/user', env);
  assert.equal(identity.response.status, 200);
  assert.deepEqual(await identity.response.json(), { login: 'Alice', role: 'owner', delegated: true, repo: 'dsottimano/lanza' });
  for (const [method, path, body] of [
    ['PUT', '/admin/api/gh/contents/data/site.json', { branch: 'staging', content: 'e30=' }],
    ['PATCH', '/admin/api/gh/git/refs/heads/main', { sha: 'reviewed-sha', force: false }],
  ]) {
    const result = await throughGate(path, env, { method, body });
    assert.equal(result.response.status, 200);
    assert.equal(calls.at(-1).init.headers.get('Authorization'), `Bearer ${TOKEN}`);
  }
});

test('unlisted writer cannot gain administration through headers, query, or a settings write', async () => {
  const result = await throughGate('/admin/api/gh/contents/data/site.json?LANZA_SITE_ADMINS=Alice', {}, {
    method: 'PUT', body: { branch: 'staging', LANZA_SITE_ADMINS: 'Alice' },
    headers: { 'LANZA_SITE_ADMINS': 'Alice' },
  });
  assert.equal(result.response.status, 403);
  assert.ok(calls.every(call => !call.init.method || call.init.method === 'GET'));
  assert.equal(result.data.role, 'editor');
});

test('delegation cannot grant Cloudflare access, while native GitHub admins retain it', async () => {
  const delegated = await throughGate('/admin/api/cf/accounts/self/pages/projects/self', { LANZA_SITE_ADMINS: 'Alice' });
  assert.equal(delegated.response.status, 403);
  assert.equal(delegated.reached, false);
  assert.ok(calls.every(call => !call.init.method || call.init.method === 'GET'));
  resetIdentityCache(); permissions.admin = true;
  const owner = await throughGate('/admin/api/cf/accounts/self/pages/projects/self');
  assert.equal(owner.reached, true);
});

test('delegation never admits a viewer, removed collaborator, expired token, or unavailable GitHub', async () => {
  permissions = { admin: false, push: false, pull: true };
  const viewer = await throughGate('/admin/api/gh/contents/data/site.json', { LANZA_SITE_ADMINS: 'Alice' }, {
    method: 'PUT', body: { branch: 'staging' },
  });
  assert.equal(viewer.response.status, 403);
  for (const status of [401, 403, 404, 429, 500]) {
    resetIdentityCache(); repoStatus = status;
    const removed = await throughGate('/admin/api/gh/user', { LANZA_SITE_ADMINS: 'Alice' });
    assert.equal(removed.reached, false, String(status));
  }
  assert.ok(calls.every(call => !call.init.method || call.init.method === 'GET'));
});

test('policy changes are applied outside the cache and never contaminate another environment', async () => {
  const delegated = await siteIdentityFor(TOKEN, 'o', 'r', { LANZA_SITE_ADMINS: 'Alice' });
  assert.equal(delegated.identity.delegated, true);
  const removed = await siteIdentityFor(TOKEN, 'o', 'r', {});
  assert.equal(removed.identity.role, 'editor');
  assert.equal(removed.identity.delegated, undefined);
  assert.equal(calls.length, 2, 'GitHub answer is cached, elevated answer is not');
});

test('removed GitHub access overrides a retained delegation after the existing cache expires', async () => {
  const now = Date.now;
  try {
    const first = await siteIdentityFor(TOKEN, 'o', 'r', { LANZA_SITE_ADMINS: 'Alice' });
    assert.equal(first.identity.role, 'owner');
    repoStatus = 404;
    Date.now = () => now() + 61_000;
    assert.equal((await siteIdentityFor(TOKEN, 'o', 'r', { LANZA_SITE_ADMINS: 'Alice' })).status, 'denied');
  } finally { Date.now = now; }
});

test('invalid lists fail closed without overriding native GitHub administrators', async () => {
  for (const value of ['*', 'ali', '@Alice', 'Alice,', 'Alice,*', 'Alice\nBob', 'Alice,b--ob', ['Alice'], 'x'.repeat(2049)]) {
    const result = await siteIdentityFor(TOKEN, 'o', 'r', { LANZA_SITE_ADMINS: value });
    assert.equal(result.identity.role, 'editor', JSON.stringify(value));
  }
  resetIdentityCache(); permissions.admin = true;
  const owner = await siteIdentityFor(TOKEN, 'o', 'r', { LANZA_SITE_ADMINS: '*' });
  assert.equal(owner.identity.role, 'owner');
  assert.equal(owner.identity.delegated, undefined);
});

test('delegated writes still enforce CSRF and repository confinement', async () => {
  const result = await throughGate('/admin/api/gh/contents/data/site.json', { LANZA_SITE_ADMINS: 'Alice' }, {
    method: 'PUT', headers: { origin: 'https://attacker.test' }, body: {},
  });
  assert.equal(result.response.status, 403);
  const outside = await throughGate('/admin/api/gh/repos/other/site/contents/data/site.json', { LANZA_SITE_ADMINS: 'Alice' }, {
    method: 'PUT', body: {},
  });
  assert.equal(outside.response.status, 403);
  assert.ok(calls.every(call => !call.init.method || call.init.method === 'GET'));
});

test('direct MCP and agent token readiness use the same delegation as the CMS', async () => {
  const request = () => new Request(`${ORIGIN}/api/mcp`, { method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
  });
  assert.equal((await mcp({ request: request() })).status, 403);
  const env = { LANZA_SITE_ADMINS: 'Alice' };
  assert.equal((await mcp({ request: request(), env })).status, 200);
  assert.equal((await mcp({ request: request(), env: {} })).status, 403);
  const ready = await agentPoll({ request: new Request(`${ORIGIN}/admin/api/auth/agent/poll`, {
    method: 'POST', headers: { cookie: 'lanza_agent_device=example' },
  }), env, data: { role: 'owner' } });
  assert.equal((await ready.json()).ready, true);
});

test('private requests and research accept delegates while preserving live privacy and write checks', async () => {
  const env = { LANZA_SITE_ADMINS: 'Alice' };
  for (const path of ['/admin/api/agent-requests', '/admin/api/plugins?id=research']) {
    assert.equal((await throughGate(path, env)).response.status, 200);
  }
  // The initial identity remains cached but private archive guards recheck GitHub.
  permissions.push = false;
  for (const path of ['/admin/api/agent-requests', '/admin/api/plugins?id=research']) {
    assert.equal((await throughGate(path, env)).response.status, 403);
  }
  permissions.push = true; privateRepo = false;
  for (const path of ['/admin/api/agent-requests', '/admin/api/plugins?id=research']) {
    assert.equal((await throughGate(path, env)).response.status, 403);
  }
  assert.ok(calls.every(call => !call.init.method || call.init.method === 'GET'));
});
