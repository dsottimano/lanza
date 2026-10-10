import { afterEach, expect, it, vi } from 'vitest';
import { GitHubClient } from './github';
import { setPinnedVersion } from './version';
const head='a'.repeat(40);
afterEach(()=>vi.unstubAllGlobals());
function api(options:{lock?:boolean;fail?:string;race?:boolean}={}) {
 const published:{tree:unknown[]|null;head:string}={tree:null,head};
 let proposed:unknown[]=[];
 const fetcher=vi.fn(async (url:string,init?:RequestInit)=>{
  const path=new URL(url,'https://test').pathname.replace('/admin/api/gh','');
  const body=init?.body?JSON.parse(String(init.body)):null;
  if(path===options.fail)return Response.json({message:'Failed'},{status:503});
  if(path==='/git/ref/heads/staging')return Response.json({object:{sha:head}});
  if(path==='/contents/package.json'){
   expect(new URL(url,'https://test').searchParams.get('ref')).toBe(head);
   return Response.json({sha:'package-blob',content:btoa(JSON.stringify({name:'tenant',dependencies:{'lanza-site':'0.1.15',other:'1.2.3'}}))});
  }
  if(path==='/contents/package-lock.json'){
   expect(new URL(url,'https://test').searchParams.get('ref')).toBe(head);
   return Response.json({sha:'lock-blob'},{status:options.lock===false?404:200});
  }
  if(path==='/git/blobs'){
   expect(JSON.parse(atob(body.content))).toEqual({name:'tenant',dependencies:{'lanza-site':'0.1.16',other:'1.2.3'}});
   return Response.json({sha:'new-package'});
  }
  if(path===`/git/commits/${head}`)return Response.json({tree:{sha:'base-tree'}});
  if(path==='/git/trees'){
   expect(body.base_tree).toBe('base-tree');proposed=body.tree;return Response.json({sha:'new-tree'});
  }
  if(path==='/git/commits'){
   expect(body.parents).toEqual([head]);return Response.json({sha:'new-commit'});
  }
  if(path==='/git/refs/heads/staging'){
   expect(body).toEqual({sha:'new-commit',force:false});
   if(options.race){published.head='concurrent-edit';return Response.json({message:'Not a fast forward'},{status:422});}
   published.tree=proposed;published.head='new-commit';return Response.json({});
  }
  throw Error(`Unexpected ${path}`);
 });vi.stubGlobal('fetch',fetcher);return {fetcher,published};
}
it.each([true,false])('updates the pin and existing lockfile together (lock exists: %s)',async lock=>{
 const {fetcher,published}=api({lock});await setPinnedVersion(new GitHubClient(),'0.1.16');
 expect(published.tree).toEqual([
  ...(lock?[{path:'package-lock.json',mode:'100644',type:'blob',sha:null}]:[]),
  {path:'package.json',mode:'100644',type:'blob',sha:'new-package'},
 ]);
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(1);
 expect(fetcher.mock.calls.some(([url,init])=>url.includes('/contents/')&&init?.method)).toBe(false);
});
it.each(['/contents/package-lock.json','/git/blobs','/git/trees','/git/commits'])('a failure at %s leaves both tracked files untouched',async fail=>{
 const {published}=api({fail});await expect(setPinnedVersion(new GitHubClient(),'0.1.16')).rejects.toThrow('Failed');
 expect(published).toEqual({tree:null,head});
});
it('a racing branch update refuses the entire change without retry',async()=>{
 const {published,fetcher}=api({race:true});await expect(setPinnedVersion(new GitHubClient(),'0.1.16')).rejects.toThrow('Not a fast forward');
 expect(published).toEqual({tree:null,head:'concurrent-edit'});
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(1);
});
