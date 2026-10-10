import { describe, it, expect, vi, afterEach } from 'vitest';
import worker, { collect, extract, bounded, sourceURL, sources, type Config } from '../src/worker';
const source = { id: 'example', url: 'https://www.usgs.gov/example', format: 'html' as const };
const config = { REPOSITORY: 'example/private-site', SOURCES_JSON: JSON.stringify([source]), SCHEDULE_ENABLED: 'false', GITHUB_TOKEN: 'fixture-github', COLLECTOR_TOKEN: 'a'.repeat(40) } as Config;
const response = (value: unknown, status = 200) => Response.json(value, { status });
afterEach(() => vi.unstubAllGlobals());
function fakeGitHub(options: { public?: boolean; conflict?: boolean; old?: unknown; privatize?: boolean; missingBranch?: boolean; sourceError?: boolean } = {}) {
  let privacyChecks = 0;
  const writes: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === source.url) { if (options.sourceError) throw new TypeError('Redirect refused'); return new Response('<main><h1>Evidence</h1><p>Two &amp; three.</p><script>secret script</script></main>', { headers: { 'Content-Type': 'text/html' } }); }
    if (url.endsWith('/example/private-site')) { privacyChecks++; return response({ private: !options.public && !(options.privatize && privacyChecks >= 3), permissions: { push: true } }); }
    if (url.includes('/git/ref/')) return response({ object: { sha: 'head' } }, options.missingBranch ? 404 : 200);
    if (init?.method === 'POST' && url.includes('/git/')) { writes.push({ url, body: JSON.parse(String(init.body)) }); return response({ sha: 'fixture-sha' }); }
    if (init?.method === 'PUT') {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      return response({}, options.conflict ? 409 : 200);
    }
    if (url.includes('/contents/')) return options.old ? response({ sha: 'previous-sha', content: btoa(JSON.stringify(options.old)) }) : response({}, 404);
    throw new Error('Unexpected request');
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, writes };
}
describe('source boundary', () => {
  it.each(['http://www.usgs.gov/', 'https://127.0.0.1/', 'https://[::1]/', 'https://2130706433/', 'https://localhost/', 'https://foo.internal/', 'https://user:password@www.usgs.gov/', 'https://www.usgs.gov:8443/'])('refuses %s', url => expect(() => sourceURL(url)).toThrow());
  it('rejects caller-controlled paths and duplicate IDs', () => {
    expect(() => sources({ ...config, SOURCES_JSON: JSON.stringify([{ ...source, id: '../other' }]) })).toThrow();
    expect(() => sources({ ...config, SOURCES_JSON: JSON.stringify([source, source]) })).toThrow();
  });
  it('bounds a chunked body with no size header', async () => {
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(12)); c.close(); } });
    await expect(bounded(new Response(body), 10)).rejects.toThrow('response_too_large');
  });
  it('extracts readable selected text without script/style content', async () => {
    const text = await extract(source, new Response('<main><h1>Title</h1><p>One &amp; two</p><script>bad()</script><style>bad{}</style></main><footer>Outside</footer>', { headers: { 'Content-Type': 'text/html' } }));
    expect(text).toContain('Title'); expect(text).toContain('One & two'); expect(text).not.toContain('bad'); expect(text).not.toContain('Outside');
  });
  it('does not mistake a PDF or empty selector for collected evidence', async () => {
    await expect(extract(source, new Response('pdf', { headers: { 'Content-Type': 'application/pdf' } }))).rejects.toThrow('unexpected_content_type');
    await expect(extract(source, new Response('<body>No main</body>', { headers: { 'Content-Type': 'text/html' } }))).rejects.toThrow('empty_extraction');
  });
});
describe('private collection', () => {
  it('does no upstream work for unauthenticated requests', async () => {
    const { fetcher } = fakeGitHub();
    const res = await worker.fetch(new Request('https://collector.example/collect', { method: 'POST' }), config);
    expect(res.status).toBe(401); expect(res.headers.get('Cache-Control')).toBe('no-store'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('fails closed on public repositories before fetching sources or writing', async () => {
    const { fetcher, writes } = fakeGitHub({ public: true });
    await expect(collect(config)).rejects.toThrow('private_repository_required');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(writes).toEqual([]);
  });
  it('preserves source provenance only on the research branch with redirects disabled', async () => {
    const { fetcher, writes } = fakeGitHub();
    expect(await collect(config)).toEqual([{ id: 'example', status: 'saved' }]);
    expect(writes).toHaveLength(1); expect(writes[0].body.branch).toBe('lanza-research');
    const saved = JSON.parse(atob(String(writes[0].body.content)));
    expect(saved).toMatchObject({ source: source.url, verified: false, origin: 'imported-source', previousHash: null });
    expect(saved.hash).toMatch(/^[a-f0-9]{64}$/); expect(Date.parse(saved.fetchedAt)).not.toBeNaN();
    expect(fetcher.mock.calls.find(([url]) => String(url) === source.url)?.[1]?.redirect).toBe('error');
  });
  it('does not commit unchanged content', async () => {
    const first = fakeGitHub(); await collect(config);
    const old = JSON.parse(atob(String(first.writes[0].body.content)));
    const next = fakeGitHub({ old });
    expect(await collect(config)).toEqual([{ id: 'example', status: 'unchanged' }]); expect(next.writes).toEqual([]);
  });
  it('initializes an orphan archive, never copies a website branch', async () => {
    const { writes } = fakeGitHub({ missingBranch: true });
    expect(await collect(config)).toEqual([{ id: 'example', status: 'saved' }]);
    expect(writes.find(w => w.url.endsWith('/git/commits'))?.body.parents).toEqual([]);
    expect(writes.find(w => w.url.endsWith('/git/refs'))?.body.ref).toBe('refs/heads/lanza-research');
    expect(writes.every(w => !JSON.stringify(w).includes('refs/heads/main') && !JSON.stringify(w).includes('refs/heads/staging'))).toBe(true);
  });
  it('does not save a blocked redirect or failed fetch', async () => {
    const { writes } = fakeGitHub({ sourceError: true });
    expect(await collect(config)).toEqual([{ id: 'example', status: 'collection_failed' }]); expect(writes).toEqual([]);
  });
  it('refuses reads after repository becomes public', async () => {
    const { fetcher } = fakeGitHub({ public: true });
    const res = await worker.fetch(new Request('https://collector.example/sources/example', { headers: { Authorization: `Bearer ${config.COLLECTOR_TOKEN}` } }), config);
    expect(res.status).toBe(503); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('marks scheduled partial failures as failed invocations', async () => {
    fakeGitHub({ sourceError: true });
    await expect(worker.scheduled({} as ScheduledController, { ...config, SCHEDULE_ENABLED: 'true' })).rejects.toThrow('scheduled_collection_failed');
  });
  it('checks privacy again before writes if visibility changed during fetch', async () => {
    const { writes } = fakeGitHub({ privatize: true });
    expect(await collect(config)).toEqual([{ id: 'example', status: 'private_repository_required' }]); expect(writes).toEqual([]);
  });
  it('reports a concurrent revision conflict without overwriting/retrying', async () => {
    const { writes } = fakeGitHub({ old: { hash: 'old' }, conflict: true });
    expect(await collect(config)).toEqual([{ id: 'example', status: 'repository_conflict' }]);
    expect(writes).toHaveLength(1); expect(writes[0].body.sha).toBe('previous-sha');
  });
  it('never schedules collection unless explicitly enabled', async () => {
    const { fetcher } = fakeGitHub();
    await worker.scheduled({} as ScheduledController, config); expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses arbitrary source identifiers on read', async () => {
    const { fetcher } = fakeGitHub();
    const res = await worker.fetch(new Request('https://collector.example/sources/other', { headers: { Authorization: `Bearer ${config.COLLECTOR_TOKEN}` } }), config);
    expect(res.status).toBe(404); expect(fetcher).not.toHaveBeenCalled();
  });
});
