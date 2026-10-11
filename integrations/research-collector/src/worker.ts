// Portable, tenant-owned integration. Never imported by the public site build.
import { decodeHTML } from 'entities';
type Secrets = { GITHUB_TOKEN: string; COLLECTOR_TOKEN: string };
export type Config = Env & Secrets;
export type Source = { id: string; url: string; format: 'html' | 'json' | 'text'; selector?: string };
const BRANCH = 'lanza-research';
const MAX_BYTES = 256 * 1024;
const encoder = new TextEncoder();
export class Failure extends Error { constructor(public code: string) { super(code); } }
const fail = (code: string): never => { throw new Failure(code); };
export async function digest(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))), b => b.toString(16).padStart(2, '0')).join('');
}
export function sourceURL(value: string) {
  const url = new URL(value);
  // Configuration is owner-controlled, never supplied by an HTTP caller. Restrict
  // to public DNS names, HTTPS/default port, no credentials, no redirects.
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) ||
      /\.(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) fail('invalid_source_url');
  return url;
}
export function sources(env: Config): Source[] {
  const list: unknown = JSON.parse(env.SOURCES_JSON);
  if (!Array.isArray(list) || list.length > 4) throw new Failure('invalid_sources');
  const ids = new Set<string>();
  for (const source of list) {
    if (!source || typeof source !== 'object' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(source.id) || ids.has(source.id) ||
        !['html','json','text'].includes(source.format) || typeof source.url !== 'string' ||
        (source.selector !== undefined && (typeof source.selector !== 'string' || source.selector.length > 200))) fail('invalid_sources');
    sourceURL(source.url); ids.add(source.id);
  }
  return list as Source[];
}
export async function bounded(response: Response, limit = MAX_BYTES) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); fail('response_too_large'); }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); fail('response_too_large'); }
      parts.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder().decode(bytes);
}
export async function extract(source: Source, response: Response) {
  const type = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (source.format === 'json' && type !== 'application/json' && !type.endsWith('+json')) fail('unexpected_content_type');
  if (source.format === 'html' && type !== 'text/html') fail('unexpected_content_type');
  if (source.format === 'text' && type !== 'text/plain') fail('unexpected_content_type');
  const raw = await bounded(response);
  if (source.format === 'json') return JSON.stringify(JSON.parse(raw), null, 2);
  if (source.format === 'text') return raw.trim();
  // Two passes keep script/style/template text out even inside the selection.
  const cleaned = await new HTMLRewriter().on('script,style,noscript,template,svg', { element(e) { e.remove(); } })
    .on('p,h1,h2,h3,h4,h5,h6,li,br,div,section,article,tr', { element(e) { e.before('\n'); e.after('\n'); } })
    .transform(new Response(raw)).text();
  let text = '';
  await new HTMLRewriter().on(source.selector || 'main', {
    text(chunk) { text += chunk.text; },
    element(element) { if (/^(?:p|h[1-6]|li|br|div|section|article|tr)$/.test(element.tagName)) text += '\n'; },
  }).transform(new Response(cleaned)).text();
  text = decodeHTML(text).replace(/[\t ]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  if (!text) fail('empty_extraction');
  return text;
}
async function github(env: Config, path: string, method = 'GET', body?: unknown) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(env.REPOSITORY) || env.REPOSITORY.split('/').some(s => s === '.' || s === '..')) fail('invalid_repository');
  if (!env.GITHUB_TOKEN) fail('missing_github_secret');
  const response = await fetch(`https://api.github.com/repos/${env.REPOSITORY}${path}`, {
    method, redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'LanzaResearchCollector', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 404 && method === 'GET') { await response.body?.cancel(); return null; }
  if (!response.ok) { await response.body?.cancel(); fail(response.status === 409 || response.status === 422 ? 'repository_conflict' : 'github_unavailable'); }
  return JSON.parse(await bounded(response, 1024 * 1024));
}
async function privateRepo(env: Config) {
  const repo = await github(env, '');
  if (!repo || repo.private !== true || repo.permissions?.push !== true) fail('private_repository_required');
}
async function branch(env: Config) {
  const existing = await github(env, `/git/ref/heads/${BRANCH}`);
  if (existing) return;
  // Orphan branch: cannot be merged accidentally into website main/staging.
  const tree = await github(env, '/git/trees', 'POST', { tree: [{ path: 'notes/research/README.md', mode: '100644', type: 'blob', content: 'Private source evidence. Never merge this branch into website branches.\n' }] });
  const commit = await github(env, '/git/commits', 'POST', { message: 'Initialize private research archive', tree: tree.sha, parents: [] });
  await privateRepo(env);
  await github(env, '/git/refs', 'POST', { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
}
const pathFor = (id: string) => `/contents/notes/research/${id}.json`;
function decode(content: string) { return new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\n/g, '')), c => c.charCodeAt(0))); }
function encode(content: string) { return btoa(Array.from(encoder.encode(content), c => String.fromCharCode(c)).join('')); }
export async function collect(env: Config) {
  const configured = sources(env); await privateRepo(env);
  if (!configured.length) return [];
  await branch(env);
  const outcomes: { id: string; status: string }[] = [];
  for (const source of configured) {
    try {
      await privateRepo(env);
      const old = await github(env, `${pathFor(source.id)}?ref=${BRANCH}`);
      const previous = old ? JSON.parse(decode(old.content)) : null;
      const response = await fetch(sourceURL(source.url), { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'LanzaResearchCollector/1.0', Accept: source.format === 'json' ? 'application/json' : source.format === 'html' ? 'text/html' : 'text/plain' } });
      if (!response.ok) { await response.body?.cancel(); fail('source_unavailable'); }
      const content = await extract(source, response);
      const hash = await digest(JSON.stringify({ url: source.url, format: source.format, selector: source.selector || null, content }));
      if (previous?.hash === hash) { outcomes.push({ id: source.id, status: 'unchanged' }); continue; }
      const record = { version: 1, id: source.id, source: source.url, format: source.format, selector: source.selector || null, fetchedAt: new Date().toISOString(), hash, previousHash: previous?.hash || null, origin: 'imported-source', verified: false, content };
      await privateRepo(env); // Recheck immediately before every write; no privacy cache.
      await github(env, pathFor(source.id), 'PUT', { branch: BRANCH, message: `Collect research source ${source.id}`, content: encode(JSON.stringify(record, null, 2) + '\n'), ...(old ? { sha: old.sha } : {}) });
      outcomes.push({ id: source.id, status: 'saved' });
    } catch (error) { outcomes.push({ id: source.id, status: error instanceof Failure ? error.code : 'collection_failed' }); }
  }
  return outcomes;
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
async function authorized(request: Request, env: Config) {
  if (!env.COLLECTOR_TOKEN || env.COLLECTOR_TOKEN.length < 32) return false;
  const provided = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] || '';
  const [a,b] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(provided)), crypto.subtle.digest('SHA-256', encoder.encode(env.COLLECTOR_TOKEN))]);
  return crypto.subtle.timingSafeEqual(a,b);
}
export default {
  async fetch(request: Request, env: Config) {
    if (!await authorized(request, env)) return json({ error: 'unauthorized' }, 401);
    try {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/collect') {
        const outcomes = await collect(env);
        return json({ outcomes }, outcomes.some(o => !['saved','unchanged'].includes(o.status)) ? 502 : 200);
      }
      if (request.method === 'GET' && url.pathname === '/sources') { await privateRepo(env); return json({ sources: sources(env) }); }
      const id = /^\/sources\/([a-z0-9][a-z0-9-]{0,63})$/.exec(url.pathname)?.[1];
      if (request.method === 'GET' && id && sources(env).some(s => s.id === id)) {
        await privateRepo(env);
        const file = await github(env, `${pathFor(id)}?ref=${BRANCH}`);
        return file ? json(JSON.parse(decode(file.content))) : json({ error: 'not_collected' }, 404);
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) { return json({ error: error instanceof Failure ? error.code : 'collector_unavailable' }, 503); }
  },
  async scheduled(_controller: ScheduledController, env: Config) {
    if (env.SCHEDULE_ENABLED !== 'true') return;
    const outcomes = await collect(env);
    console.log(JSON.stringify({ event: 'research_collection', outcomes }));
    if (outcomes.some(o => !['saved','unchanged'].includes(o.status))) fail('scheduled_collection_failed');
  },
} satisfies ExportedHandler<Config>;
