import { test, expect, vi, beforeEach } from 'vitest';
import { access } from './access';
import { prepareStarter, installStarter } from './starters';
import { GitHubClient } from './github';
beforeEach(() => { access.role = 'owner'; });
function fixture() {
 const texts: Record<string,string> = {'data/site.json':JSON.stringify({defaultLocale:'en',locales:[{code:'en'}]}),'data/schema.json':'[]','content/pages/en/home.md':'Existing home'};
 return { workingHead: vi.fn().mockResolvedValue('pinned'), getTree:vi.fn().mockResolvedValue({tree:Object.keys(texts).map(path=>({path})),truncated:false}),loadText:vi.fn(async(path:string)=>({text:texts[path],sha:'old-'+path})),commitChecked:vi.fn().mockResolvedValue({}) };
}
const options={id:'portfolio',locale:'en',look:'editorial',includeSamples:true};
test('prepares against one head and commits the complete reviewed plan once',async()=>{
 const mock=fixture();const client=mock as unknown as GitHubClient;
 const plan=await prepareStarter(client,options);
 expect(mock.commitChecked).not.toHaveBeenCalled();
 for(const call of mock.loadText.mock.calls)expect(call).toHaveLength(2);
 expect(plan.files.find(f=>f.path==='data/schema.json')?.sha).toBe('old-data/schema.json');
 expect(plan.files.some(f=>f.path==='content/pages/en/home.md')).toBe(false);
 await installStarter(client,plan);
 expect(mock.commitChecked).toHaveBeenCalledExactlyOnceWith('pinned',plan.files,expect.any(String));
});
test('incomplete snapshot refuses before writes',async()=>{const mock=fixture();mock.getTree.mockResolvedValue({tree:[],truncated:true});await expect(prepareStarter(mock as unknown as GitHubClient,options)).rejects.toThrow('incomplete');expect(mock.commitChecked).not.toHaveBeenCalled();});
test('stale commit failure is surfaced without retry',async()=>{const mock=fixture();const client=mock as unknown as GitHubClient;const plan=await prepareStarter(client,options);mock.commitChecked.mockRejectedValue(new Error('Changed since review'));await expect(installStarter(client,plan)).rejects.toThrow('Changed since review');expect(mock.commitChecked).toHaveBeenCalledTimes(1);});
test('editor cannot prepare installation',async()=>{access.role='editor';const mock=fixture();await expect(prepareStarter(mock as unknown as GitHubClient,options)).rejects.toThrow('owner');expect(mock.workingHead).not.toHaveBeenCalled();});
