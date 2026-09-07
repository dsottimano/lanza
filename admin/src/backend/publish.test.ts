import { afterEach, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubError, PublishReviewError } from './github';
const review = { productionSha:'a'.repeat(40), stagingSha:'b'.repeat(40), diff:{status:'ahead',files:[{filename:'page.md',status:'modified'}]} };
afterEach(()=>vi.unstubAllGlobals());
function mockApi(staging=review.stagingSha, production=review.productionSha) {
  const fetcher=vi.fn(async (url:string, init?:RequestInit)=>{
    if (url.includes('/git/ref/heads/main')) return Response.json({object:{sha:production}});
    if (url.includes('/git/ref/heads/staging')) return Response.json({object:{sha:staging}});
    if (url.includes('/compare/')) return Response.json(review.diff);
    if (init?.method==='POST' || init?.method==='PATCH') return Response.json({sha:'merged'},{status:201});
    throw new Error(url);
  });
  vi.stubGlobal('fetch',fetcher); return fetcher;
}
it('compares fixed commits and publishes the reviewed SHA, never a moving branch', async()=>{
  const fetcher=mockApi(); const client=new GitHubClient();
  expect(await client.publishReview()).toEqual(review);
  expect(fetcher.mock.calls.some(([url])=>url.endsWith(`/compare/${review.productionSha}...${review.stagingSha}`))).toBe(true);
  await client.publish('publish',review);
  const request=fetcher.mock.calls.find(([,init])=>init?.method==='PATCH')!;
  expect(request[0]).toBe('/admin/api/gh/git/refs/heads/main');
  expect(JSON.parse(request[1]!.body as string)).toEqual({sha:review.stagingSha,force:false});
});
it.each(['staging','production'])('refuses a stale %s review without writing',async branch=>{
  const fetcher=mockApi(branch==='staging'?'c'.repeat(40):review.stagingSha,branch==='production'?'d'.repeat(40):review.productionSha);
  await expect(new GitHubClient().publish('publish',review)).rejects.toBeInstanceOf(PublishReviewError);
  expect(fetcher.mock.calls.every(([,init])=>!init?.method || init.method==='GET')).toBe(true);
});
it('requires reconciliation when both branches changed',async()=>{
  const fetcher=mockApi();
  await expect(new GitHubClient().publish('publish',{...review,diff:{status:'diverged'}})).rejects.toMatchObject({code:'diverged'});
  expect(fetcher.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
});
it('updates drafts using a normal merge without publishing or force-resetting',async()=>{
  const fetcher=mockApi(); await new GitHubClient().updateDrafts(review);
  const writes=fetcher.mock.calls.filter(([,init])=>init?.method==='POST');
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]![1]!.body as string)).toMatchObject({base:'staging',head:review.productionSha});
  expect(fetcher.mock.calls.some(([,init])=>init?.method==='PATCH')).toBe(false);
});
it('leaves a conflict unresolved instead of falling back to overwrite',async()=>{
  const fetcher=mockApi(); const normal=fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url,init)=>init?.method==='POST'?Response.json({message:'Merge conflict'},{status:409}):normal(url,init));
  await expect(new GitHubClient().updateDrafts(review)).rejects.toBeInstanceOf(GitHubError);
  expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});
it('refuses a production race after preflight without forcing or retrying the write',async()=>{
  const fetcher=mockApi(); const normal=fetcher.getMockImplementation()!;
  let attempted=false;
  fetcher.mockImplementation(async(url,init)=>{
    if(init?.method==='PATCH'){attempted=true;return Response.json({message:'Update is not a fast forward'},{status:422});}
    if(attempted && url.includes('/git/ref/heads/main'))return Response.json({object:{sha:'c'.repeat(40)}});
    return normal(url,init);
  });
  await expect(new GitHubClient().publish('publish',review)).rejects.toMatchObject({code:'stale'});
  const writes=fetcher.mock.calls.filter(([,init])=>init?.method==='PATCH');expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]![1]!.body as string).force).toBe(false);
});
