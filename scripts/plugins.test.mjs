import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentClient } from '../functions/_lib/lanza-content.ts';
import { PluginRuntime } from '../functions/_lib/plugin-runtime.mjs';
import { validatePlugin } from '../functions/_lib/plugin-contract.mjs';
import { researchOperation, evidenceEngine, digest, fetchResearchSource } from '../functions/_lib/research-plugin.mjs';
import { onRequest } from '../functions/admin/api/plugins.ts';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPlugins } from './build-plugins.mjs';
const manifest=JSON.parse(await readFile(new URL('../plugins/research/plugin.json',import.meta.url)));
const source={id:'catalog',url:'https://example.com/data',format:'json'};
const configuration={version:1,repository:'example/private',article:{id:'article',contentPath:'content/posts/en/article.md',generatedFactIds:['magnitude']},sources:[source],facts:[{id:'magnitude',label:'Magnitude',sourceId:'catalog',extract:{type:'json-pointer',pointer:'/magnitude'}}]};
function fixture(run=researchOperation) {
 let state=null,sha=null,revision=0,branch=false,privateRepo=true,owner=true;
 const writes=[];
 const client={pluginArchive:async(id,method,route,body)=>{
  assert.equal(id,'research');
  if(route==='')return {private:privateRepo,full_name:'example/private',permissions:{admin:owner,push:true}};
  if(route==='git/ref/heads/lanza-research')return branch?{object:{sha:'a'.repeat(40)}}:null;
  if(method==='GET')return state?{sha,content:Buffer.from(JSON.stringify(state)).toString('base64')}:null;
  writes.push({method,route,body});
  if(route==='git/refs'){branch=true;return {};}
  if(method==='POST')return {sha:'a'.repeat(40)};
  assert.equal(body.branch,'lanza-research');assert.equal(route,'contents/plugins/research/state.json');
  if((body.sha??null)!==sha)throw Object.assign(new Error('Conflict'),{status:409});
  state=JSON.parse(Buffer.from(body.content,'base64'));sha=(++revision).toString(16).padStart(40,'0');return {content:{sha}};
 },read:async()=>{throw Error('No article reads needed');}};
 const runtime=new PluginRuntime(client,'owner',async p=>{assert.equal(p,'content/posts/en/article.md');return p;},[{manifest,run}]);
 return {runtime,client,writes,get state(){return state;},get sha(){return sha;},setPrivate:value=>privateRepo=value,setOwner:value=>owner=value};
}
test('private and owner checks fail closed without any write',async()=>{
 for(const key of ['setPrivate','setOwner']){const f=fixture();f[key](false);await assert.rejects(f.runtime.run('research','set-enabled',{expectedSha:null,enabled:true}),/private repository/);assert.equal(f.writes.length,0);}
});
test('configure, enable and disable preserve evidence; stale writes refuse',async()=>{
 const f=fixture();await f.runtime.run('research','configure',{expectedSha:null,manifest:configuration});
 const original=f.sha;
 await f.runtime.run('research','set-enabled',{expectedSha:f.sha,enabled:true});
 await assert.rejects(f.runtime.run('research','set-enabled',{expectedSha:original,enabled:false}),/changed/);
 await f.runtime.run('research','set-enabled',{expectedSha:f.sha,enabled:false});
 assert.deepEqual(f.state.data.manifest,configuration);assert.equal(f.state.enabled,false);
 await assert.rejects(f.runtime.run('research','refresh',{expectedSha:f.sha}),/Enable/);
});
test('concurrent disable during refresh refuses result and preserves disabled state',async()=>{
 let unlock;const wait=new Promise(resolve=>unlock=resolve);
 const f=fixture(async context=>{if(context.operation==='configure')return researchOperation(context);await wait;return {state:{...context.state,data:{bad:'should never save'}}};});
 await f.runtime.run('research','set-enabled',{expectedSha:null,enabled:true});
 const pending=f.runtime.run('research','refresh',{expectedSha:f.sha});
 await new Promise(resolve=>setImmediate(resolve));
 await f.runtime.run('research','set-enabled',{expectedSha:f.sha,enabled:false});unlock();
 await assert.rejects(pending,/changed during/);assert.equal(f.state.enabled,false);assert.equal(f.state.data,null);
});
test('refresh stores private evidence, proposal changes no article, stale sources block proposal',async()=>{
 const f=fixture();await f.runtime.run('research','configure',{expectedSha:null,manifest:configuration});await f.runtime.run('research','set-enabled',{expectedSha:f.sha,enabled:true});
 const originalFetch=globalThis.fetch;
 try {
  globalThis.fetch=async()=>Response.json({magnitude:7.7});
  await f.runtime.run('research','refresh',{expectedSha:f.sha});
  assert.equal(f.state.data.evidence.facts.magnitude.value,7.7);
  const writes=f.writes.length;
  const p=await f.runtime.run('research','propose',{expectedSha:f.sha});assert.equal(p.articleUpdated,false);assert.match(p.html,/7.7/);assert.equal(f.writes.length,writes);
  globalThis.fetch=async()=>new Response('down',{status:503});
  await f.runtime.run('research','refresh',{expectedSha:f.sha});assert.equal(f.state.data.evidence.facts.magnitude.status,'stale');assert.equal(f.state.data.evidence.facts.magnitude.value,7.7);
  await assert.rejects(f.runtime.run('research','propose',{expectedSha:f.sha}),/stale/);
 } finally{globalThis.fetch=originalFetch;}
});
test('source fetch refuses redirects and oversized responses without forwarding credentials',async()=>{
 await assert.rejects(fetchResearchSource(source,async(url,init)=>{assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,undefined);return new Response('',{status:302,headers:{location:'http://localhost/'}});}),/302/);
 await assert.rejects(fetchResearchSource(source,async()=>new Response('x'.repeat(270000),{headers:{'content-type':'application/json'}})),/too_large/);
});
test('Web Crypto refresh matches the Node engine and rejects changed source configurations',async()=>{
 const node=await import('../integrations/research-collector/bin/evidence.mjs');
 const snapshot=async()=>({text:'{"magnitude":7.7}'});
 const a=await node.refresh(configuration,null,snapshot,'2026-10-11T00:00:00Z');const b=await evidenceEngine.refresh(configuration,null,snapshot,'2026-10-11T00:00:00Z');assert.deepEqual(a,b);assert.equal(await digest('hello'),node.hash('hello'));
});
test('HTTP endpoint rejects anonymous, editor and cross-origin requests before execution',async()=>{
 for(const [data,origin,status] of [[{},'https://site.test',401],[{token:'test',login:'owner',role:'editor'},'https://site.test',403],[{token:'test',login:'owner',role:'owner'},'https://evil.test',403]]){
  const res=await onRequest({request:new Request('https://site.test/admin/api/plugins',{method:'POST',headers:{Origin:origin},body:'{}'}),data});assert.equal(res.status,status);
 }
});
test('transport refuses website refs, traversal and arbitrary Contents writes',async()=>{
 const client=new ContentClient({owner:'example',name:'private'},'not-used');
 for(const args of [['../x','GET',''],['research','GET','contents/content/posts/en/x.md?ref=main'],['research','PUT','contents/plugins/research/state.json',{branch:'main'}],['research','POST','git/refs',{ref:'refs/heads/main'}]])await assert.rejects(client.pluginArchive(...args));
});
test('manifest rejects incompatible API and unknown public adapters',()=>{
 assert.throws(()=>validatePlugin({...manifest,apiVersion:2}));assert.throws(()=>validatePlugin({...manifest,scope:'site',runtime:'browser',appearanceKey:'unknown'}));
});
test('tenant plugin survives repeated registry generation without changing source',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lanza-plugins-'));
 try{
  await mkdir(path.join(dir,'plugins/example'),{recursive:true});const m={...manifest,id:'example',workspace:'settings',operations:['check']};
  await writeFile(path.join(dir,'plugins/example/plugin.json'),JSON.stringify(m));
  const code='export default async function run({state}) { return {state,result:{message:"Done"}}; }\n';await writeFile(path.join(dir,'plugins/example/server.mjs'),code);
  await buildPlugins(dir);await buildPlugins(dir);
  assert.match(await readFile(path.join(dir,'functions/_lib/plugin-registry.mjs'),'utf8'),/plugins\/example\/server.mjs/);assert.equal(await readFile(path.join(dir,'plugins/example/server.mjs'),'utf8'),code);
  await writeFile(path.join(dir,'plugins/example/plugin.json'),JSON.stringify({...m,apiVersion:2}));await assert.rejects(buildPlugins(dir),/incompatible/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('authenticated HTTP read reaches the confined private runtime without website reads',async()=>{
 const previous=globalThis.fetch;const urls=[];
 try{
  globalThis.fetch=async url=>{urls.push(String(url));return String(url).endsWith('/repos/dsottimano/lanza')?Response.json({private:true,permissions:{admin:true},full_name:'dsottimano/lanza'}):new Response('',{status:404});};
  const res=await onRequest({request:new Request('https://site.test/admin/api/plugins?id=research'),data:{token:'test',login:'owner',role:'owner'}});
  assert.equal(res.status,200);assert.equal((await res.json()).state.enabled,false);
  assert.equal(urls.length,2);assert.match(urls[1],/contents\/plugins\/research\/state.json\?ref=lanza-research$/);
 }finally{globalThis.fetch=previous;}
});

test('MCP uses the same read and revision-checked mutation service as the CMS',async()=>{
 const {handleMessage}=await import('../functions/_lib/mcp-core.ts');const f=fixture();
 const call=(operation,input)=>handleMessage({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'run_plugin',arguments:{id:'research',operation,input}}},f.client,{login:'owner'});
 const read=await call('read',{});assert.equal(JSON.parse(read.result.content[0].text).state.enabled,false);
 const enabled=await call('set-enabled',{expectedSha:null,enabled:true});assert.equal(enabled.result.isError,undefined);assert.equal(f.state.enabled,true);
 const stale=await call('set-enabled',{expectedSha:null,enabled:false});assert.equal(stale.result.isError,true);assert.equal(f.state.enabled,true);
});
