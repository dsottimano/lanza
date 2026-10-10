import { afterEach, expect, it, vi } from 'vitest';
import { GitHubClient } from './github';
import { planRevert } from './themeHistory';
const sha = 'a'.repeat(40), parent = 'b'.repeat(40);
const files = (length: number, start = 0) => Array.from({ length }, (_, i) => ({ filename: `templates/test/${start+i}.html`, status: 'added' }));
const detail = (entries: ReturnType<typeof files>, id = sha) => ({ sha: id, files: entries, parents: [{ sha: parent }], commit: { message: 'lanza: apply theme "Test"', tree: { sha: parent }, author: { date: '2026-10-10' } } });
afterEach(() => vi.unstubAllGlobals());
it('reads all changed-file pages and pins later reads to the returned commit', async () => {
  const fetcher=vi.fn(async (url: string) => {
    const page=Number(new URL(url,'https://test').searchParams.get('page'));
    if(page>1) expect(url).toContain(`/commits/${sha}?`);
    return Response.json(detail(files(page===4?1:100,(page-1)*100)));
  });
  vi.stubGlobal('fetch',fetcher);
  const commit=await new GitHubClient().getCommit('staging');
  expect(commit.files).toHaveLength(301);
  expect(commit.files!.at(-1)?.filename).toBe('templates/test/300.html');
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('checks the next page when the file count exactly fills a page', async () => {
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json(detail(files(100)))).mockResolvedValueOnce(Response.json(detail([])));
  vi.stubGlobal('fetch',fetcher);
  expect((await new GitHubClient().getCommit(sha)).files).toHaveLength(100);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(['missing files','different commit','duplicate files','request failure'])('refuses a partial commit after %s', async failure => {
  const second=failure==='missing files'?{sha}:failure==='different commit'?detail(files(1,100),parent):detail(files(1));
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json(detail(files(100)))).mockResolvedValueOnce(Response.json(second,{status:failure==='request failure'?503:200}));
  vi.stubGlobal('fetch',fetcher);
  await expect(new GitHubClient().getCommit(sha)).rejects.toThrow();
  expect(fetcher.mock.calls.every(([,init])=>!init?.method)).toBe(true);
});
it('refuses GitHub’s total file cap instead of returning an incomplete undo list', async () => {
  const fetcher=vi.fn(async (url: string) => {
    const page=Number(new URL(url,'https://test').searchParams.get('page'));
    return Response.json(detail(files(100,(page-1)*100)));
  });
  vi.stubGlobal('fetch',fetcher);
  await expect(new GitHubClient().getCommit(sha)).rejects.toThrow('too large to review completely');
  expect(fetcher).toHaveBeenCalledTimes(30);
});
it('theme planning includes the final page and warns when a later rename touched an undo path', async () => {
  vi.stubGlobal('fetch',vi.fn(async (url: string) => {
    if(url.includes('/git/ref/heads/')) return Response.json({object:{sha}});
    if(url.includes('/compare/')) return Response.json({status:'ahead',files:[{filename:'moved.html',previous_filename:'templates/test/300.html',status:'renamed'}]});
    if(url.includes('/git/trees/')) return Response.json({truncated:false,tree:[]});
    if(url.includes(`/commits/${parent}`)) return Response.json(detail([],parent));
    const page=Number(new URL(url,'https://test').searchParams.get('page'));
    return Response.json(detail(files(page===4?1:100,(page-1)*100)));
  }));
  const plan=await planRevert(new GitHubClient(),sha);
  expect(plan.remove).toHaveLength(301);
  expect(plan.conflicts).toEqual(['templates/test/300.html']);
});
