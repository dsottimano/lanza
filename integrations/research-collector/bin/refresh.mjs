#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename, mkdtemp, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { hash, validateManifest, htmlText, refresh, report, applyArticle } from './evidence.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node bin/refresh.mjs --manifest <manifest.json> --output <private-directory> [--apply --site-root <checkout> --expected-article-hash <sha256>]\nRequires gh authentication and private manifest.repository. Default writes only private evidence. --apply changes only the reserved fact block locally; never publishes.');
  process.exit(0);
}
function option(name) { const index = args.indexOf(name); if (index < 0 || !args[index+1] || args[index+1].startsWith('--')) throw new Error(`Missing ${name}`); return args[index+1]; }
async function bytes(response) {
  const reader = response.body?.getReader(); const chunks = []; let size = 0;
  const limit = 8 * 1024 * 1024;
  if (!reader) throw new Error('empty_response');
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > limit) { await reader.cancel(); throw new Error('response_too_large'); } chunks.push(chunk.value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
async function privateRepository(repository) {
  const metadata = JSON.parse(execFileSync('gh',['api',`repos/${repository}`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000}));
  if (metadata.private !== true || metadata.permissions?.push !== true) throw new Error('private_repository_required');
}
async function main() {
  const manifest = validateManifest(JSON.parse(await readFile(option('--manifest'),'utf8')));
  const output = path.resolve(option('--output'));
  if (output.split(path.sep).some(s => ['public','dist','content','.git'].includes(s))) throw new Error('output_must_not_be_public_or_content');
  await privateRepository(manifest.repository);
  await mkdir(output,{recursive:true,mode:0o700});
  const resolved = await realpath(output);
  if (resolved.split(path.sep).some(s => ['public','dist','content','.git'].includes(s))) throw new Error('output_symlink_to_public_path');
  // Exclusive lock prevents two refreshes racing and losing the latest snapshot.
  const lock = path.join(output,'.refresh.lock');
  try { await mkdir(lock); } catch { throw new Error('refresh_already_running_or_stale_lock'); }
  try {
    let previous;
    try { previous = JSON.parse(await readFile(path.join(output,'evidence.json'),'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const rawSnapshots = new Map();
    const evidence = await refresh(manifest,previous,async source => {
      const response = await fetch(source.url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{'User-Agent':'LanzaResearchCollector/1.0',Accept: source.format === 'pdf' ? 'application/pdf' : source.format === 'json' ? 'application/json' : source.format === 'html' ? 'text/html' : 'text/plain'}});
      if (!response.ok) { await response.body?.cancel(); throw new Error(`source_http_${response.status}`); }
      const type = (response.headers.get('content-type') || '').split(';')[0].trim();
      if (source.format === 'pdf' ? type !== 'application/pdf' : source.format === 'json' ? type !== 'application/json' && !type.endsWith('+json') : source.format === 'html' ? type !== 'text/html' : type !== 'text/plain') { await response.body?.cancel(); throw new Error('unexpected_content_type'); }
      const raw = await bytes(response); const rawHash = hash(raw); let text;
      if (source.format === 'pdf') {
        const temp = await mkdtemp(path.join(os.tmpdir(),'lanza-evidence-'));
        try {
          await writeFile(path.join(temp,'source.pdf'),raw,{mode:0o600});
          text = execFileSync('pdftotext',['-layout','-enc','UTF-8',path.join(temp,'source.pdf'),'-'],{encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
        } finally { await rm(temp,{recursive:true,force:true}); }
      } else if (source.format === 'html') text = htmlText(raw.toString('utf8'),source.selector);
      else if (source.format === 'json') text = JSON.stringify(JSON.parse(raw.toString('utf8')),null,2);
      else text = raw.toString('utf8').trim();
      rawSnapshots.set(rawHash,raw);
      return { text, rawHash, contentType:type };
    });
    await privateRepository(manifest.repository);
    await mkdir(path.join(output,'snapshots'),{recursive:true,mode:0o700});
    for (const [rawHash,raw] of rawSnapshots) await writeFile(path.join(output,'snapshots',`${rawHash}.bin`),raw,{mode:0o600,flag:'wx'}).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const revision = `${evidence.refreshedAt.replace(/[:.]/g,'-')}-${evidence.substantiveHash.slice(0,12)}.json`;
    await mkdir(path.join(output,'history'),{recursive:true,mode:0o700});
    await writeFile(path.join(output,'history',revision),JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});
    for (const [file,body] of [['evidence.json',JSON.stringify(evidence,null,2)+'\n'],['evidence.md',report(evidence)]]) {
      const tmp = path.join(output,`.${file}.tmp`); await writeFile(tmp,body,{mode:0o600}); await rename(tmp,path.join(output,file));
    }
    const stale = Object.values(evidence.facts).filter(f => f.status !== 'current').map(f => f.id);
    let articleUpdated = false;
    if (args.includes('--apply')) {
      const root = await realpath(option('--site-root'));
      const gitRoot = execFileSync('git',['-C',root,'rev-parse','--show-toplevel'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
      const origin = execFileSync('git',['-C',root,'config','--get','remote.origin.url'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
      const repo = origin.match(/github\.com[:/]([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/)?.[1];
      if (await realpath(gitRoot) !== root || repo?.toLowerCase() !== manifest.repository.toLowerCase()) throw new Error('site_repository_mismatch');
      const articlePath = await realpath(path.resolve(root,manifest.article.contentPath));
      if (!articlePath.startsWith(root + path.sep)) throw new Error('article_outside_site');
      const before = await readFile(articlePath,'utf8');
      const after = applyArticle(before,option('--expected-article-hash'),evidence,manifest.article.generatedFactIds);
      if (after !== before) {
        const tempArticle = articlePath + '.research-refresh.tmp';
        try {
          await writeFile(tempArticle,after,{mode:0o600,flag:'wx'});
          if (hash(await readFile(articlePath,'utf8')) !== hash(before)) throw new Error('article_changed');
          await rename(tempArticle,articlePath); articleUpdated = true;
        } finally { await rm(tempArticle,{force:true}); }
      }
    }
    console.log(JSON.stringify({article:evidence.article.id,substantiveHash:evidence.substantiveHash,changed:previous?.substantiveHash !== evidence.substantiveHash,staleFacts:stale,articleUpdated,output},null,2));
    if (stale.length || Object.values(evidence.sources).some(s => s.status !== 'current')) process.exitCode=2;
  } finally { await rm(lock,{recursive:true,force:true}); }
}
main().catch(error => { console.error(`Refresh failed: ${error.message}`); process.exitCode=1; });
