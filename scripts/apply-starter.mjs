#!/usr/bin/env node
// Shared, additive planner; the CLI applies only to an explicitly selected local checkout.
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { planStarter, starterReadPaths, STARTERS } from '../functions/_lib/site-starters.mjs';
const [id, ...args] = process.argv.slice(2);
const values = {};
let includeSamples = true, dry = false;
try {
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==='--dry-run')dry=true;
    else if(arg==='--no-samples')includeSamples=false;
    else if(['--into','--locale','--look'].includes(arg) && args[i+1] && !args[i+1].startsWith('--'))values[arg]=args[++i];
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if(!id || !values['--into'])throw new Error(`Usage: node scripts/apply-starter.mjs <${STARTERS.map(s=>s.id).join('|')}> --into <checkout> [--locale en] [--look editorial] [--dry-run] [--no-samples]`);
  const root=resolve(values['--into']);
  const paths=[];
  function walk(dir, prefix='') {
    for(const entry of readdirSync(dir,{withFileTypes:true})) {
      if(['.git','node_modules','dist','.astro'].includes(entry.name))continue;
      const path=prefix+entry.name;
      paths.push(path);
      if(entry.isSymbolicLink() && ['data','content','templates'].includes(path.split('/')[0]))throw new Error(`Symlink in starter destination: ${path}`);
      if(entry.isDirectory())walk(join(dir,entry.name),path+'/');
    }
  }
  walk(root);
  const site=JSON.parse(readFileSync(join(root,'data/site.json'),'utf8'));
  const locale=values['--locale']??site.defaultLocale;
  const texts={};
  for(const path of starterReadPaths(id,locale))if(existsSync(join(root,path)))texts[path]=readFileSync(join(root,path),'utf8');
  const plan=planStarter({id,locale,look:values['--look']??'editorial',includeSamples,paths,texts});
  process.stdout.write(JSON.stringify({...plan,files:plan.files.map(({text,...file})=>file)},null,2)+'\n');
  if(!dry)for(const file of plan.files){mkdirSync(dirname(join(root,file.path)),{recursive:true});writeFileSync(join(root,file.path),file.text);}
  if(!dry)process.stdout.write('Applied locally. Review the diff and build before committing to staging.\n');
} catch(error) { console.error(error.message); process.exitCode=1; }
