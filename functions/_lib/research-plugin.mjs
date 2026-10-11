import { GitHubError } from './lanza-content';
import { createEvidenceEngine } from './research-evidence.mjs';
export async function digest(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export const evidenceEngine = createEvidenceEngine(digest);
export function validateResearch(input, repository) {
  let m; try {m=evidenceEngine.validateManifest(structuredClone(input));}catch {throw new GitHubError(400,'Check the article, source URLs and fact definitions.');}
  if(m.repository.toLowerCase()!==repository?.toLowerCase()) throw new GitHubError(400,'Research must belong to this repository.');
  if(m.sources.length<1 || m.sources.length>5 || m.facts.length>40 || !Array.isArray(m.article.generatedFactIds) || m.article.generatedFactIds.length>40 || m.article.generatedFactIds.some(id=>!m.facts.some(f=>f.id===id))) throw new GitHubError(400,'Choose 1–5 sources and up to 40 declared facts.');
  for(const s of m.sources) {
    if(s.format==='pdf') throw new GitHubError(400,'PDF extraction is available through the local CLI, not CMS refresh.');
    if(s.url.length>2000 || (s.requiredText!==undefined && (!Array.isArray(s.requiredText) || s.requiredText.length>10 || s.requiredText.some(t=>typeof t!=='string'||!t||t.length>200)))) throw new GitHubError(400,'Invalid source checks.');
  }
  for(const f of m.facts) {
    if(f.extract?.type==='text-match') throw new GitHubError(400,'Server refresh supports JSON facts and calculations; regular-expression extraction is local CLI only.');
    if((f.label!==undefined && (typeof f.label!=='string'||f.label.length>200)) || (f.unit!==undefined&&(typeof f.unit!=='string'||f.unit.length>40))) throw new GitHubError(400,'Invalid fact label or unit.');
  }
  return m;
}
export async function fetchResearchSource(source, fetcher=fetch) {
  const response=await fetcher(source.url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:source.format==='json'?'application/json':source.format==='html'?'text/html':'text/plain','User-Agent':'LanzaResearch/1.0'}});
  if(!response.ok) {await response.body?.cancel();throw new Error(`source_http_${response.status}`);}
  const type=(response.headers.get('content-type')||'').split(';')[0].trim();
  if(!(source.format==='json'?(type==='application/json'||type.endsWith('+json')):type===(source.format==='html'?'text/html':'text/plain'))) {await response.body?.cancel();throw new Error('unexpected_content_type');}
  const reader=response.body?.getReader();if(!reader)throw new Error('empty_response');
  const chunks=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256*1024){await reader.cancel();throw new Error('source_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const raw=new TextDecoder().decode(bytes);
  const text=source.format==='html'?evidenceEngine.htmlText(raw,source.selector||'main'):source.format==='json'?JSON.stringify(JSON.parse(raw),null,2):raw.trim();
  if(new TextEncoder().encode(text).length>48*1024)throw new Error('extraction_too_large');
  return {text,rawHash:await digest(bytes),contentType:type,origin:"imported-unverified"};
}
export async function researchOperation({operation,input,state,repository,assertEntry}) {
  if(operation==='configure') {
    const manifest=validateResearch(input.manifest,repository);
    await assertEntry(manifest.article.contentPath);
    // Existing evidence is retained with its original manifest hash until refresh.
    return {state:{...state,data:{...state.data,manifest,needsRefresh:true}},result:{configured:true}};
  }
  const manifest=validateResearch(state.data?.manifest,repository);
  await assertEntry(manifest.article.contentPath);
  if(operation==='refresh') {
    const snapshots=await Promise.all(manifest.sources.map(async source=>{
      try{return {id:source.id,value:await fetchResearchSource(source)};}catch(error){return {id:source.id,error};}
    }));
    const previous=state.data?.evidence;
    const evidence=await evidenceEngine.refresh(manifest,previous,async source=>{const s=snapshots.find(s=>s.id===source.id);if(s.error)throw s.error;return s.value;});
    const changes=Object.values(evidence.facts).filter(f=>JSON.stringify([f.value,f.status])!==JSON.stringify([previous?.facts?.[f.id]?.value,previous?.facts?.[f.id]?.status])).map(f=>({id:f.id,label:f.label,before:previous?.facts?.[f.id]?.value??null,after:f.value??null,status:f.status}));
    return {state:{...state,data:{manifest,evidence,changes,needsRefresh:false}},result:{changed:previous?.substantiveHash!==evidence.substantiveHash,staleFacts:Object.values(evidence.facts).filter(f=>f.status!=='current').map(f=>f.id),articleUpdated:false}};
  }
  if(operation==='propose') {
    const evidence=state.data?.evidence;
    if(!evidence || evidence.manifestHash!==await digest(manifest))throw new GitHubError(409,'Refresh the current source configuration before proposing facts.');
    if(Object.values(evidence.sources).some(s=>s.status!=='current'))throw new GitHubError(409,'Resolve stale or unavailable sources before proposing facts.');
    let html;try{html=evidenceEngine.articleBlock(evidence,manifest.article.generatedFactIds);}catch{throw new GitHubError(409,'Choose current facts before creating a proposal.');}
    return {result:{entryPath:manifest.article.contentPath,html,evidenceHash:evidence.substantiveHash,refreshedAt:evidence.refreshedAt,articleUpdated:false}};
  }
  throw new GitHubError(400,'Unknown research operation.');
}
export default researchOperation;
