import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContentClient } from '../functions/_lib/lanza-content.ts';
import { handleMessage, TOOL_LIST } from '../functions/_lib/mcp-core.ts';

const productionSha = 'a'.repeat(40), stagingSha = 'b'.repeat(40), newer = 'c'.repeat(40);
const review = { productionSha, stagingSha };
const response = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status });
function github(t, options = {}) {
  const state = { main: productionSha, staging: stagingSha, calls: [], writes: [] };
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const path = new URL(url).pathname.replace('/repos/o/n/', '');
    const method = init.method ?? 'GET';
    const body = init.body && JSON.parse(init.body);
    const call = { path, method, body };
    state.calls.push(call);
    if (method !== 'GET') state.writes.push(call);
    if (path.startsWith('git/ref/heads/')) return response(200, { object: { sha: state[path.split('/').at(-1)] } });
    if (path.startsWith('compare/')) {
      assert.equal(path, `compare/${productionSha}...${stagingSha}`);
      options.onCompare?.(state);
      return response(200, options.comparison ?? { status: options.status ?? 'ahead', files: options.files ?? [{ filename: 'data/menu.json', status: 'modified' }] });
    }
    if (path === 'git/refs/heads/main' && method === 'PATCH') {
      options.onPublish?.(state);
      assert.deepEqual(body, { sha: stagingSha, force: false });
      // Simulate GitHub refusing a concurrent sibling production commit.
      if (state.main !== productionSha) return response(422, { message: 'Update is not a fast forward' });
      state.main = body.sha;
      return response(200, { object: { sha: body.sha } });
    }
    if (path === 'merges' && method === 'POST') {
      assert.equal(body.base, 'staging');
      assert.equal(body.head, productionSha);
      const status = options.mergeStatus ?? 201;
      if (status === 201) state.staging = newer;
      return response(status, status === 204 ? undefined : { message: 'Merge conflict' });
    }
    throw new Error(`Unexpected ${method} ${path}`);
  });
  return { state, client: new ContentClient({ owner: 'o', name: 'n' }, 'fake-token') };
}
async function tool(client, name, args = {}) {
  const result = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, client);
  assert.equal(result.result.isError, undefined, JSON.stringify(result));
  return JSON.parse(result.result.content[0].text);
}

test('MCP review captures immutable heads and publishes exactly that commit', async t => {
  const { client, state } = github(t);
  const pending = await tool(client, 'list_changes');
  assert.deepEqual(pending, { ...review, status: 'ahead', files: [{ path: 'data/menu.json', status: 'modified' }], complete: true, pending: 1 });
  assert.equal(state.writes.length, 0);
  const published = await tool(client, 'publish', pending);
  assert.equal(published.commit, stagingSha);
  assert.equal(published.published, true);
  assert.match(published.note, /Deployment completion has not been verified/);
  assert.equal(state.main, stagingSha);
  assert.equal(state.writes.length, 1);
});

test('both mutating tools require reviewed heads in their advertised schemas', () => {
  for (const name of ['publish', 'update_drafts']) assert.deepEqual(TOOL_LIST.find(t => t.name === name).inputSchema.required, ['productionSha', 'stagingSha']);
});

for (const method of ['publish', 'updateDrafts']) {
  test(`${method} rejects missing and invalid reviews before fetching`, async t => {
    const { client, state } = github(t);
    for (const invalid of [undefined, {}, { ...review, stagingSha: 'staging' }, { ...review, productionSha: '../main' }]) {
      await assert.rejects(client[method](invalid), /returned by list_changes/);
    }
    assert.equal(state.calls.length, 0);
  });
  for (const branch of ['main', 'staging']) test(`${method} rejects a stale ${branch} without writing`, async t => {
    const { client, state } = github(t);
    state[branch] = newer;
    await assert.rejects(client[method](review), /changed since review/);
    assert.equal(state.writes.length, 0);
  });
}

test('publishing rechecks draft changes during comparison', async t => {
  const { client, state } = github(t, { onCompare: s => { s.staging = newer; } });
  await assert.rejects(client.publish(review), /changed since review/);
  assert.equal(state.writes.length, 0);
});
test('draft changes after preflight stay drafts', async t => {
  const { client, state } = github(t, { onPublish: s => { s.staging = newer; } });
  assert.equal(await client.publish(review), true);
  assert.equal(state.main, stagingSha);
  assert.equal(state.staging, newer);
});
test('production races are refused without retry or overwrite', async t => {
  const { client, state } = github(t, { onPublish: s => { s.main = newer; } });
  await assert.rejects(client.publish(review), /fast forward/);
  assert.equal(state.main, newer);
  assert.equal(state.writes.length, 1);
});
for (const status of ['behind', 'diverged']) test(`${status} drafts require reconciliation without publishing`, async t => {
  const { client, state } = github(t, { status });
  await assert.rejects(client.publish(review), /update_drafts/);
  assert.equal(state.writes.length, 0);
  const result = await tool(client, 'update_drafts', review);
  assert.equal(result.updated, true);
  assert.equal(result.published, false);
  assert.equal(state.main, productionSha);
  assert.equal(state.staging, newer);
  await assert.rejects(client.publish(review), /changed since review/);
  assert.equal(state.writes.length, 1);
});
test('identical comparison needs no write', async t => {
  const { client, state } = github(t, { status: 'identical', files: [] });
  assert.equal(await client.publish(review), false);
  assert.equal(state.writes.length, 0);
});
for (const mergeStatus of [204, 409]) test(`draft reconciliation handles ${mergeStatus} without changing production`, async t => {
  const { client, state } = github(t, { mergeStatus });
  if (mergeStatus === 409) await assert.rejects(client.updateDrafts(review), /Both branches are preserved/);
  else assert.equal(await client.updateDrafts(review), false);
  assert.equal(state.main, productionSha);
  assert.equal(state.staging, stagingSha);
});
test('the GitHub changed-file limit is reported as incomplete and blocks publication', async t => {
  const files = Array.from({ length: 300 }, (_, i) => ({ filename: `content/posts/en/${i}.md`, status: 'added' }));
  const { client, state } = github(t, { files });
  const pending = await tool(client, 'list_changes');
  assert.equal(pending.complete, false);
  assert.equal(pending.pending, null);
  await assert.rejects(client.publish(review), /300-file limit/);
  assert.equal(state.writes.length, 0);
});
for (const comparison of [{ status: 'ahead' }, { files: [] }, { status: 'ahead', files: [null] }]) {
  test(`malformed comparison fails closed: ${JSON.stringify(comparison)}`, async t => {
    const { client, state } = github(t, { comparison });
    await assert.rejects(client.publish(review), /Could not verify/);
    assert.equal(state.writes.length, 0);
  });
}
