import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/admin/api/gh/[[path]].ts';
const id = (n) => n.repeat(40);
const head=id('a'), candidate=id('b'), beforeTree=id('c'), afterTree=id('d');
const leaf=(path,sha=id('e'),mode='100644',type='blob')=>({path,sha,mode,type});
const base=[leaf('package.json'),leaf('data/site.json'),leaf('content/posts/en/a.md')];
async function request({before=base,after=base,parents=[{sha:head}],body={sha:candidate,force:false},method='PATCH',path='git/refs/heads/staging',role='editor',truncated=false,failRead=false,race=false}={}) {
 const original=globalThis.fetch, writes=[], reads=[];
 globalThis.fetch=async(url,init={})=>{
  if(init.method==='PATCH'||init.method==='POST'||init.method==='PUT'){writes.push({url,body:JSON.parse(new TextDecoder().decode(init.body))});return Response.json({}, {status:race?422:200});}
  reads.push(url);if(failRead)return Response.json({}, {status:503});
  if(url.endsWith('/git/ref/heads/staging')||url.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:head}});
  if(url.endsWith('/git/commits/'+candidate))return Response.json({parents,tree:{sha:afterTree}});
  if(url.endsWith('/git/commits/'+head))return Response.json({tree:{sha:beforeTree}});
  if(url.includes('/git/trees/'+beforeTree))return Response.json({truncated,tree:before});
  if(url.includes('/git/trees/'+afterTree))return Response.json({truncated,tree:after});
  throw Error('Unexpected read '+url);
 };
 try {
  const response=await onRequest({request:new Request('https://example.test/admin/api/gh/'+path,{method,headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify(body)}),params:{path},env:{},data:{role,login:'fixture',token:'synthetic'}});
  return {response,writes,reads};
 }finally{globalThis.fetch=original;}
}
for(const [name,after] of [
 ['omitted base tree deletes settings',[leaf('content/posts/en/a.md',id('f'))]],
 ['reused tree edits settings',[leaf('package.json'),leaf('data/site.json',id('f')),leaf('content/posts/en/a.md')]],
 ['symlink under content',[...base,leaf('content/link.md',id('f'),'120000')]],
 ['submodule under content',[...base,leaf('content/repo.md',id('f'),'160000','commit')]],
 ['active uploaded document',[...base,leaf('public/images/uploads/page.html')]],
 ['executable content mode',[...base,leaf('content/executable.md',id('f'),'100755')]],
])test('refuses '+name+' before moving any ref',async()=>{const r=await request({after});assert.equal(r.response.status,403);assert.deepEqual(r.writes,[]);});
test('a legitimate multi-file edit preserves settings and advances drafts',async()=>{const after=[...base.slice(0,2),leaf('content/posts/en/a.md',id('f')),leaf('public/images/uploads/picture.png')];const r=await request({after});assert.equal(r.response.status,200);assert.equal(r.writes.length,1);assert.equal(r.writes[0].body.force,false);});
test('content deletions are permitted without deleting owner-only files',async()=>{const r=await request({after:base.slice(0,2)});assert.equal(r.response.status,200);});
for(const parents of [[],[{sha:id('f')}],[{sha:head},{sha:id('f')}]])test('refuses foreign or merged commit ancestry '+JSON.stringify(parents),async()=>{const r=await request({parents});assert.equal(r.response.status,403);assert.deepEqual(r.writes,[]);});
test('refuses editor force resets without upstream work',async()=>{const r=await request({body:{sha:candidate,force:true}});assert.equal(r.response.status,403);assert.deepEqual(r.writes,[]);assert.deepEqual(r.reads,[]);});
for(const option of [{truncated:true},{failRead:true}])test('fails closed on incomplete verification '+JSON.stringify(option),async()=>{const r=await request(option);assert.equal(r.response.status,503);assert.deepEqual(r.writes,[]);});
test('a race after verification is not forced or retried',async()=>{const r=await request({race:true});assert.equal(r.response.status,422);assert.equal(r.writes.length,1);assert.equal(r.writes[0].body.force,false);});
test('new staging can only copy the current production commit',async()=>{for(const sha of [head,candidate]){const r=await request({method:'POST',path:'git/refs',body:{ref:'refs/heads/staging',sha}});assert.equal(r.response.status,sha===head?200:403);assert.equal(r.writes.length,sha===head?1:0);}});
test('a direct HTML upload is refused by the production route',async()=>{const r=await request({method:'PUT',path:'contents/public/images/uploads/page.html',body:{branch:'staging',content:'PGgxPnRlc3Q8L2gxPg=='}});assert.equal(r.response.status,403);assert.deepEqual(r.writes,[]);});
test('missing role remains read-only',async()=>{const r=await request({role:null});assert.equal(r.response.status,403);assert.deepEqual(r.writes,[]);});
test('owner writes retain their existing authority',async()=>{const r=await request({role:'owner',body:{sha:candidate,force:true}});assert.equal(r.response.status,200);assert.deepEqual(r.reads,[]);});
