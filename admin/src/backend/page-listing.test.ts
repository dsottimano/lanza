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
  it('does not query entries for ordinary page templates', async () => {
    const client = {loadJson:vi.fn().mockResolvedValue({data:{fields:[]}}),listDir:vi.fn()} as unknown as GitHubClient;
    expect(await loadPageListing(client,'guide','en')).toEqual({});
    expect(client.listDir).not.toHaveBeenCalled();
  });
});
