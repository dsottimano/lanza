import { afterEach, expect, it, vi } from 'vitest';
import { GitHubClient } from './github';
import { planRevert, executeRevert, type RevertPlan } from './themeHistory';
const review={productionSha:'a'.repeat(40),stagingSha:'b'.repeat(40)};
afterEach(()=>vi.unstubAllGlobals());
function api(options:{head?:string;race?:boolean}={}) {
 const fetcher=vi.fn(async(url:string,init?:RequestInit):Promise<Response>=>{
  if(init?.method==='PATCH')return Response.json({}, {status:options.race?422:200});
  if(init?.method==='POST')return Response.json({sha:url.endsWith('/git/commits')?'recovery-commit':'new-tree'});
  if(url.endsWith('/git/ref/heads/staging'))return Response.json({object:{sha:options.head??review.stagingSha}});
  if(url.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:review.productionSha}});
  if(url.includes('/git/commits/'))return Response.json({tree:{sha:url.endsWith(review.productionSha)?'published-tree':'draft-tree'}});
  throw Error(url);
 });vi.stubGlobal('fetch',fetcher);return fetcher;
}
const writes=(fetcher:ReturnType<typeof api>)=>fetcher.mock.calls.filter(([,init])=>init?.method==='POST'||init?.method==='PATCH');
it.each(['saveJson','saveText'] as const)('%s refuses stale writes without fetching a newer SHA or retrying',async method=>{
 const fetcher=vi.fn(async()=>Response.json({message:'Conflict'},{status:409}));vi.stubGlobal('fetch',fetcher);
 const client=new GitHubClient();
 const save=method==='saveJson'?client.saveJson('data/menu.en.json',{header:[]},'save','old'):client.saveText('templates/part.html','local edit','save','old');
 await expect(save).rejects.toMatchObject({status:409});expect(fetcher).toHaveBeenCalledTimes(1);
});
it('discard restores the reviewed tree in a new commit preserving both histories',async()=>{
 const fetcher=api();await new GitHubClient().discardDraft(review);
 const calls=writes(fetcher);expect(calls).toHaveLength(2);
 expect(JSON.parse(calls[0]![1]!.body as string)).toMatchObject({tree:'published-tree',parents:[review.stagingSha,review.productionSha]});
 expect(calls[1]![0]).toContain('/git/refs/heads/staging');expect(JSON.parse(calls[1]![1]!.body as string)).toEqual({sha:'recovery-commit',force:false});
});
it('discard refuses a stale review without creating a commit',async()=>{
 const fetcher=api({head:'new-draft'});await expect(new GitHubClient().discardDraft(review)).rejects.toMatchObject({code:'stale'});expect(writes(fetcher)).toEqual([]);
});
it('discard never retries or forces a race after the preflight',async()=>{
 const fetcher=api({race:true});await expect(new GitHubClient().discardDraft(review)).rejects.toMatchObject({status:422});
 const updates=writes(fetcher).filter(([,init])=>init?.method==='PATCH');expect(updates).toHaveLength(1);expect(JSON.parse(updates[0]![1]!.body as string).force).toBe(false);
});
const plan:RevertPlan={head:review.stagingSha,applySha:'apply',title:'Review',restore:[{path:'data/appearance.json',sha:'old-brand'}],remove:['content/pages/en/added.md'],conflicts:[]};
it('theme rollback refuses an edit made after its review before writing',async()=>{
 const fetcher=api({head:'owner-edited-after-review'});await expect(executeRevert(new GitHubClient(),plan)).rejects.toMatchObject({status:409});expect(writes(fetcher)).toEqual([]);
});
it('theme rollback parents the reviewed commit and preserves a racing sibling',async()=>{
 const fetcher=api({race:true});await expect(executeRevert(new GitHubClient(),plan)).rejects.toMatchObject({status:422});
 const commits=writes(fetcher).filter(([url])=>url.endsWith('/git/commits'));expect(JSON.parse(commits[0]![1]!.body as string).parents).toEqual([plan.head]);
 const refs=writes(fetcher).filter(([,init])=>init?.method==='PATCH');expect(refs).toHaveLength(1);expect(JSON.parse(refs[0]![1]!.body as string).force).toBe(false);
});
it('theme planning compares immutable commits and retains the reviewed head',async()=>{
 const compare=vi.fn(async()=>({status:'identical',files:[]}));
 const client={workingHead:async()=>review.stagingSha,compare,getCommit:async(sha:string)=>({sha,parents:[{sha:'parent'}],files:[{filename:'content/pages/en/added.md',status:'added'}],commit:{message:'lanza: apply theme "Review"',author:{date:'2026-09-07'},tree:{sha:'parent-tree'}}}),getTree:async()=>({truncated:false,tree:[]})} as unknown as GitHubClient;
 const p=await planRevert(client,'apply');expect(p.head).toBe(review.stagingSha);expect(compare).toHaveBeenCalledWith('apply',review.stagingSha);
});
it('theme installation refuses a stale review before uploading blobs',async()=>{
 const fetcher=api({head:'newer'});await expect(new GitHubClient().commitFiles([{path:'data/appearance.json',base64:'e30='}],'theme',undefined,review.stagingSha)).rejects.toMatchObject({status:409});expect(writes(fetcher)).toEqual([]);
});
