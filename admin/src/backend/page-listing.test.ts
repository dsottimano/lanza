import { describe, it, expect, vi } from 'vitest';
import { loadPageListing } from './page-listing';
import type { GitHubClient } from './github';

describe('CMS page listing preview', () => {
  it('uses the declared collection, excludes drafts and sorts published posts', async () => {
    const listDir = vi.fn().mockResolvedValue([
      {name:'older.md',path:'content/posts/es/older.md'},
      {name:'draft.md',path:'content/posts/es/draft.md'},
      {name:'newer.md',path:'content/posts/es/newer.md'},
    ]);
    const client = {
      loadJson: vi.fn().mockResolvedValue({data:{listing:{of:'posts',item:['title'],sortBy:'pubDate',order:'desc'}}}),
      listDir,
      loadEntry: vi.fn(async (path:string) => ({ data: {title:path, draft:path.includes('draft'), pubDate:new Date(path.includes('newer')?'2026-09-07':'2026-09-01')} })),
    } as unknown as GitHubClient;
    const scope = await loadPageListing(client,'journal','es');
    expect(listDir).toHaveBeenCalledWith('content/posts/es');
    expect(scope.count).toBe(2);
    expect(scope.isEmpty).toBe(false);
    expect((scope.entries as {slug:string}[]).map(e=>e.slug)).toEqual(['newer','older']);
  });
  it('previews the latest/rest split and long dates from JSON frontmatter, like the build', async () => {
    const files = ['a','b','c'].map(n=>({name:`${n}.md`,path:`content/posts/en/${n}.md`}));
    const dates: Record<string,string> = {a:'2026-06-09T00:00:00Z',b:'2026-05-01T00:00:00Z',c:'2025-01-01T00:00:00Z'};
    const client = {
      loadJson: vi.fn().mockResolvedValue({data:{listing:{of:'posts',item:['title'],sortBy:'pubDate',order:'desc',date:'pubDate',latest:2}}}),
      listDir: vi.fn().mockResolvedValue(files),
      loadEntry: vi.fn(async (path:string) => { const n = path.slice(-4,-3); return { data: {title:n, pubDate:dates[n]} }; }),
    } as unknown as GitHubClient;
    const scope = await loadPageListing(client,'insights','en');
    expect((scope.latest as {title:string}[]).map(e=>e.title)).toEqual(['a','b']);
    expect((scope.rest as {dateLong:string}[])[0].dateLong).toBe('January 1, 2025');
    expect([scope.latestIsEmpty, scope.restIsEmpty]).toEqual([false, false]);
  });
  it('refuses listing options the build refuses', async () => {
    const client = {loadJson:vi.fn().mockResolvedValue({data:{listing:{of:'posts',item:[],latest:0}}}),listDir:vi.fn()} as unknown as GitHubClient;
    await expect(loadPageListing(client,'insights','en')).rejects.toThrow('listing.latest');
  });
  it('does not query entries for ordinary page templates', async () => {
    const client = {loadJson:vi.fn().mockResolvedValue({data:{fields:[]}}),listDir:vi.fn()} as unknown as GitHubClient;
    expect(await loadPageListing(client,'guide','en')).toEqual({});
    expect(client.listDir).not.toHaveBeenCalled();
  });
});
