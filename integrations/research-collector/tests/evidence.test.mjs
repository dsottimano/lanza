import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, htmlText, refresh, applyArticle, validateManifest } from '../bin/evidence.mjs';
const source = {id:'catalog',url:'https://earthquake.usgs.gov/example',format:'json'};
const fact = {id:'main-magnitude',sourceId:'catalog',extract:{type:'json-pointer',select:{pointer:'/features',key:'/id',value:'main'},pointer:'/properties/mag'}};
const manifest = {version:1,repository:'example/private',article:{id:'article',contentPath:'content/posts/en/article.md',generatedFactIds:[fact.id]},sources:[source],facts:[fact]};
const data = {features:[{id:'other',properties:{mag:3}},{id:'main',properties:{mag:7.7}}]};
const snapshot = async () => ({text:JSON.stringify(data),rawHash:'raw'});
test('event ID selection is stable when catalog order changes',async () => {
 const a=await refresh(manifest,null,snapshot,'2026-10-10T00:00:00Z');
 const b=await refresh(manifest,null,async()=>({text:JSON.stringify({features:[...data.features].reverse()})}));
 assert.equal(a.facts['main-magnitude'].value,7.7);assert.equal(b.facts['main-magnitude'].value,7.7);
});
test('same source input has same substantive hash across fetch times',async()=>{
 const a=await refresh(manifest,null,snapshot,'2026-10-10T00:00:00Z');
 const b=await refresh(manifest,a,snapshot,'2026-10-11T00:00:00Z');
 assert.equal(a.substantiveHash,b.substantiveHash);assert.notEqual(a.refreshedAt,b.refreshedAt);
});
test('source failure retains evidence and flags stale; new URL never borrows old evidence',async()=>{
 const a=await refresh(manifest,null,snapshot);
 const fail=async()=>{throw new Error('source_http_503');};
 const b=await refresh(manifest,a,fail);
 assert.equal(b.facts['main-magnitude'].value,7.7);assert.equal(b.facts['main-magnitude'].status,'stale');assert.equal(b.sources.catalog.fetchedAt,a.sources.catalog.fetchedAt);
 const c=await refresh({...manifest,sources:[{...source,url:'https://earthquake.usgs.gov/changed'}]},a,fail);
 assert.equal(c.sources.catalog.status,'unavailable');
 assert.equal(c.facts['main-magnitude'].status,'unavailable');
});
test('HTTP success without expected source content is not valid evidence',async()=>{
 const m={...manifest,sources:[{...source,requiredText:['main']}]};
 const a=await refresh(m,null,async()=>({text:'Please enable JavaScript. Checking your browser.'}));
 assert.equal(a.sources.catalog.status,'unavailable');assert.equal(a.sources.catalog.error,'source_validation_failed');
});
test('failed re-extraction keeps the old fact linked to its original snapshot',async()=>{
 const a=await refresh(manifest,null,snapshot,'2026-10-10T00:00:00Z');
 const b=await refresh(manifest,a,async()=>({text:JSON.stringify({features:[]}),rawHash:'new'}),'2026-10-11T00:00:00Z');
 assert.equal(b.facts['main-magnitude'].status,'stale');
 assert.equal(b.facts['main-magnitude'].provenance[0].rawHash,'raw');
 assert.equal(b.facts['main-magnitude'].provenance[0].fetchedAt,'2026-10-10T00:00:00Z');
});
test('missing event never silently substitutes a different earthquake',async()=>{
 const a=await refresh(manifest,null,async()=>({text:JSON.stringify({features:[data.features[0]]})}));
 assert.equal(a.facts['main-magnitude'].status,'unavailable');
 assert.equal(a.facts['main-magnitude'].error,'selection_not_unique');
});
test('deterministic calculation, UTC formatting and count filter',async()=>{
 const m={...manifest,facts:[fact,{id:'double',calculate:{operation:'multiply',inputs:['main-magnitude',2],digits:1}},{id:'count',sourceId:'catalog',extract:{type:'json-count',pointer:'/features',filter:{pointer:'/properties/mag',operation:'gte',value:6}}},{id:'utc',sourceId:'catalog',extract:{type:'json-pointer',pointer:'/time',transform:'epoch-ms-iso'}}]};
 const a=await refresh(m,null,async()=>({text:JSON.stringify({...data,time:0})}));
 assert.equal(a.facts.double.value,15.4);assert.equal(a.facts.count.value,1);assert.equal(a.facts.utc.value,'1970-01-01T00:00:00.000Z');
});
test('text extraction rejects ambiguity rather than using first occurrence',async()=>{
 const m={...manifest,sources:[{...source,format:'text'}],facts:[{id:'number',sourceId:'catalog',extract:{type:'text-match',pattern:'value ([0-9]+)',group:1,numeric:true}}]};
 const a=await refresh(m,null,async()=>({text:'value 1, value 2'}));assert.equal(a.facts.number.error,'ambiguous_match');
});
test('HTML extraction separates blocks and removes scripts/navigation',()=>{
 assert.equal(htmlText('<body><nav>Menu</nav><main><p>A &amp; B</p><p>C</p><script>evil</script></main></body>','main'),'A & B\nC');
});
test('article refresh preserves frontmatter and prose, is repeatable, and refuses stale or changed articles',async()=>{
 const a=await refresh(manifest,null,snapshot);
 const before='---\ntitle: Draft\ndraft: true\n---\n<p>Original introduction.</p><h2>Verified earthquake data</h2><p>Old</p><h2>What those numbers do—and do not—tell us</h2><p>Original conclusion.</p>';
 const after=applyArticle(before,hash(before),a,[fact.id]);
 assert.ok(after.startsWith(before.slice(0,before.indexOf('<p>Old'))));assert.ok(after.endsWith('<p>Original conclusion.</p>'));assert.ok(after.includes('7.7'));
 assert.equal(applyArticle(after,hash(after),a,[fact.id]),after);
 assert.throws(()=>applyArticle(before,'wrong',a,[fact.id]),/article_changed/);
 const stale=structuredClone(a);stale.facts[fact.id].status='stale';assert.throws(()=>applyArticle(before,hash(before),stale,[fact.id]),/fact_not_current/);
 assert.throws(()=>applyArticle(before+before,hash(before+before),a,[fact.id]),/boundaries_not_unique/);
});
test('invalid targets and forward calculation references fail validation',()=>{
 assert.throws(()=>validateManifest({...manifest,sources:[{...source,url:'https://127.0.0.1/'}]}));
 assert.throws(()=>validateManifest({...manifest,article:{...manifest.article,contentPath:'public/x.html'}}));
 assert.throws(()=>validateManifest({...manifest,facts:[{id:'bad',calculate:{operation:'divide',inputs:['future',0]}}]}));
});
