import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AgentRequests,REQUEST_BRANCH} from './agent-requests.ts';
import {ContentClient} from './lanza-content.ts';
import {assertEntryPath,handleMessage,TOOL_LIST} from './mcp-core.ts';
import {onRequest} from '../admin/api/agent-requests.ts';
import repo from '../../lanza.config.json';
const ID='0199cb18-0000-7000-8000-000000000001';
const ENTRY='content/posts/en/test.md';
const INPUT={id:ID,entryPath:ENTRY,action:'verify',instruction:'',anchor:{quote:'A claim',from:1,to:8,bodyHash:'a'.repeat(64),before:'',after:''}};
const b64=text=>Buffer.from(text).toString('base64');
const sha=text=>createHash('sha1').update(text).digest('hex');
function fixture(options={}) {
 const files=new Map();const calls=[];let branch=options.branch??true;let privacyChecks=0;let raced=false;
 const respond=(status,body)=>new Response(JSON.stringify(body),{status});
 globalThis.fetch=async(url,init={})=>{
  const u=new URL(url);const route=u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/?/,'');const method=init.method||'GET';const body=init.body?JSON.parse(init.body):null;
  calls.push({route,method,body,url:String(url)});
  if(route==='') {if(u.pathname.endsWith('/')) return respond(404,{message:'Not Found'});privacyChecks++;return respond(200,{private:!options.public&&!(options.publicAfter&&privacyChecks>=options.publicAfter),permissions:{admin:!options.editor,push:true}});}
  if(route==='contents/data/schema.json')return respond(200,{content:b64(JSON.stringify([{kind:'folder',name:'posts',folder:'content/posts',body:'rich'}]))});
  if(route===`git/ref/heads/${REQUEST_BRANCH}`)return respond(branch?200:404,branch?{object:{sha:'b'.repeat(40)}}:{});
  if(method==='POST'&&route==='git/trees')return respond(201,{sha:'c'.repeat(40)});
  if(method==='POST'&&route==='git/commits')return respond(201,{sha:'d'.repeat(40)});
  if(method==='POST'&&route==='git/refs'){if(options.branchRace){branch=!options.failedRace;return respond(422,{message:'Already exists'});}branch=true;return respond(201,{object:{sha:'d'.repeat(40)}});}
  if(route==='contents/requests')return files.size?respond(200,[...files.keys()].map(id=>({name:`${id}.json`,type:'file',path:`requests/${id}.json`}))):respond(404,{});
  const id=/^contents\/requests\/([a-f0-9-]+)\.json$/.exec(route)?.[1];
  if(id){
   if(method==='GET'){const f=files.get(id);return f?respond(200,{content:b64(f.text),sha:f.sha}):respond(404,{});}
   if(method==='PUT'){
    const current=files.get(id);if(options.writeConflict)return respond(409,{message:'Conflict'});
    if(current&&body.sha!==current.sha||!current&&body.sha)return respond(409,{message:'Conflict'});
    const text=Buffer.from(body.content,'base64').toString();const file={text,sha:sha(text)};
    if(options.createRace&&!raced){raced=true;files.set(id,file);return respond(422,{message:'Already exists'});}
    files.set(id,file);return respond(200,{content:{sha:file.sha}});
   }
  }
  throw new Error(`Unexpected ${method} ${route}`);
 };
 const client=new ContentClient(repo,'fixture-token');
 const archive=new AgentRequests(client,path=>assertEntryPath(client,path),'owner');
 return {archive,client,files,calls,writes:()=>calls.filter(c=>c.method!=='GET')};
}
test('public repository and lesser GitHub role refuse without any write',async()=>{
 for(const options of [{public:true},{editor:true}]){const f=fixture(options);await assert.rejects(()=>f.archive.create(INPUT),e=>e.status===403);assert.equal(f.writes().length,0);assert.equal(f.calls.length,1);}
});
test('initial list does not create archive branch',async()=>{
 const f=fixture({branch:false});assert.deepEqual(await f.archive.list(ENTRY),{requests:[],truncated:false,nextCursor:null});assert.equal(f.writes().length,0);
});
test('capture initializes orphan branch, owns actors/timestamps and never touches website refs',async()=>{
 const f=fixture({branch:false});const saved=await f.archive.create({...INPUT,createdBy:'spoofed',createdAt:'yesterday'});
 assert.equal(saved.task.createdBy,'owner');assert.equal(saved.task.status,'open');assert.equal(saved.task.instruction,'');assert.match(saved.task.createdAt,/^\d{4}-/);
 const commit=f.calls.find(c=>c.route==='git/commits');assert.deepEqual(commit.body.parents,[]);assert.match(commit.body.message,/\[skip ci\]/);
 const write=f.calls.find(c=>c.method==='PUT');assert.equal(write.body.branch,REQUEST_BRANCH);assert.match(write.body.message,/\[skip ci\]/);
 assert.ok(f.writes().every(c=>!JSON.stringify(c).includes('refs/heads/main')&&!JSON.stringify(c).includes('refs/heads/staging')));
});
test('creation is retry-safe including simultaneous requests, different capture conflicts',async()=>{
 for(const createRace of [false,true]){const f=fixture({createRace});const first=await f.archive.create(INPUT);const writes=f.writes().length;const again=await f.archive.create(INPUT);assert.deepEqual(first,again);assert.equal(f.writes().length,writes);await assert.rejects(()=>f.archive.create({...INPUT,instruction:'different'}),e=>e.status===409);assert.equal(f.writes().length,writes);}
});
test('branch creation race succeeds only after confirming actual branch',async()=>{
 const f=fixture({branch:false,branchRace:true});await f.archive.create(INPUT);assert.equal(f.files.size,1);
 const bad=fixture({branch:false,branchRace:true,failedRace:true});await assert.rejects(()=>bad.archive.create(INPUT));assert.equal(bad.files.size,0);
});
test('visibility is rechecked before persistence and no capture is written after it becomes public',async()=>{
 const f=fixture({publicAfter:2});await assert.rejects(()=>f.archive.create(INPUT),e=>e.status===403);assert.equal(f.files.size,0);
});
test('schema path confinement and selection limits refuse before any write',async()=>{
 for(const input of [{...INPUT,entryPath:'content/posts/../../.github/x.md'},{...INPUT,entryPath:'data/site.json'},{...INPUT,entryPath:'content/pages/en/other.md'},{...INPUT,anchor:{...INPUT.anchor,quote:'x'.repeat(8001)}},{...INPUT,anchor:{...INPUT.anchor,to:0}}]){const f=fixture();await assert.rejects(()=>f.archive.create(input));assert.equal(f.writes().length,0);}
});
test('response and resolution preserve immutable capture and use expected SHA',async()=>{
 const f=fixture();const first=await f.archive.create(INPUT);
 const answered=await f.archive.update({id:ID,expectedSha:first.sha,response:{message:'Evidence',replacementHtml:'<p>Proposal</p>',createdBy:'spoofed'}});
 assert.deepEqual(answered.task.anchor,first.task.anchor);assert.equal(answered.task.createdAt,first.task.createdAt);assert.equal(answered.task.response.createdBy,'owner');assert.equal(answered.task.response.origin,'assistant');assert.equal(answered.task.status,'answered');
 const before=f.writes().length;await assert.rejects(()=>f.archive.update({id:ID,expectedSha:first.sha,status:'resolved'}),e=>e.status===409);assert.equal(f.writes().length,before);
 const resolved=await f.archive.update({id:ID,expectedSha:answered.sha,status:'resolved'});assert.equal(resolved.task.status,'resolved');assert.deepEqual(resolved.task.response,answered.task.response);
 await assert.rejects(()=>f.archive.update({id:ID,expectedSha:resolved.sha,response:{message:'Too late'}}),e=>e.status===409);
});
test('bounded newest-first pages expose continuation without unbounded reads',async()=>{
 const f=fixture();const base=(await f.archive.create(INPUT)).task;
 for(let i=2;i<=25;i++){const id=ID.slice(0,-12)+String(i).padStart(12,'0');const text=JSON.stringify({...base,id});f.files.set(id,{text,sha:sha(text)});}
 f.calls.length=0;const page=await f.archive.list(ENTRY);assert.equal(page.requests.length,20);assert.equal(page.truncated,true);assert.ok(page.nextCursor);assert.ok(f.calls.length<=23);assert.equal(page.requests[0].task.id.slice(-12),'000000000025');
 const rest=await f.archive.list(ENTRY,page.nextCursor);assert.equal(rest.requests.length,5);assert.equal(rest.truncated,false);
});
test('directory at GitHub truncation boundary is refused before reading task bodies',async()=>{
 const f=fixture();for(let i=0;i<1000;i++){const id=ID.slice(0,-12)+String(i).padStart(12,'0');f.files.set(id,{text:'{}',sha:'a'.repeat(40)});}
 await assert.rejects(()=>f.archive.list(ENTRY),e=>e.status===413);assert.equal(f.calls.filter(c=>c.route.startsWith('contents/requests/')).length,0);assert.equal(f.writes().length,0);
});
test('persisted request reads fail after visibility changes without disclosing content',async()=>{
 const f=fixture({publicAfter:3});await f.archive.create(INPUT);const before=f.calls.length;await assert.rejects(()=>f.archive.read(ID),e=>e.status===403);assert.equal(f.calls.length,before+1);
});
test('tampered archived response fails validation rather than reaching UI',async()=>{
 const f=fixture();await f.archive.create(INPUT);const file=f.files.get(ID);const task=JSON.parse(file.text);task.status='answered';task.response={message:42,createdAt:task.createdAt,createdBy:'owner',origin:'assistant'};file.text=JSON.stringify(task);file.sha=sha(file.text);await assert.rejects(()=>f.archive.read(ID));
});
test('cookie endpoint rejects cross-origin, missing-origin, oversized and non-owner writes',async()=>{
 const context={data:{role:'owner',login:'owner',token:'fixture-token'}};
 for(const origin of [undefined,'https://evil.example','http://site.example']){const f=fixture();const response=await onRequest({...context,request:new Request('https://site.example/admin/api/agent-requests',{method:'POST',headers:origin?{Origin:origin}:{},body:JSON.stringify(INPUT)})});assert.equal(response.status,403);assert.equal(f.calls.length,0);}
 const f=fixture();const oversized=await onRequest({...context,request:new Request('https://site.example/admin/api/agent-requests',{method:'POST',headers:{Origin:'https://site.example'},body:'x'.repeat(65537)})});assert.equal(oversized.status,413);assert.equal(f.calls.length,0);
 const viewer=await onRequest({data:{...context.data,role:'viewer'},request:new Request('https://site.example/admin/api/agent-requests')});assert.equal(viewer.status,403);
});
test('real cookie endpoint and persisted MCP tools share same archive',async()=>{
 const f=fixture();const response=await onRequest({data:{role:'owner',login:'owner',token:'fixture-token'},request:new Request('https://site.example/admin/api/agent-requests',{method:'POST',headers:{Origin:'https://site.example'},body:JSON.stringify(INPUT)})});assert.equal(response.status,201);const created=await response.json();assert.equal(response.headers.get('Cache-Control'),'no-store');
 const run=async(name,args)=>handleMessage({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},f.client,{origin:null,stagingUrl:null,login:'owner'});
 assert.ok(TOOL_LIST.some(t=>t.name==='list_agent_requests'));
 const result=await run('read_agent_request',{id:ID});assert.equal(JSON.parse(result.result.content[0].text).sha,created.sha);
 const answered=await run('respond_to_agent_request',{id:ID,expectedSha:created.sha,message:'Checked the source.'});assert.equal(JSON.parse(answered.result.content[0].text).task.status,'answered');
 const listing=await run('list_agent_requests',{entryPath:ENTRY});assert.equal(JSON.parse(listing.result.content[0].text).requests.length,1);
 assert.equal(f.writes().filter(c=>c.method==='PUT').length,2);
});
test('archive transport cannot target other branches or arbitrary repository endpoints',async()=>{
 const f=fixture();for(const [method,path,body] of [['PUT',`contents/requests/${ID}.json`,{branch:'main'}],['GET','contents/secrets.json?ref=lanza-agent-requests'],['POST','git/refs',{ref:'refs/heads/main'}],['PATCH','git/refs/heads/main',{sha:'x'}]])await assert.rejects(()=>f.client.agentRequestArchive(method,path,body));assert.equal(f.calls.length,0);
});
