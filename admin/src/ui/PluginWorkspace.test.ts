import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import PluginWorkspace from './PluginWorkspace.vue';
import { access } from '../backend/access';
import { hasUnsavedChanges } from './dirty';
import type { GitHubClient } from '../backend/github';
vi.mock('vue-router',()=>({useRouter:()=>({push:vi.fn()})}));
let wrappers:VueWrapper[]=[];
const plugin={id:'research',name:'Research',description:'Collect evidence',scope:'private',workspace:'research',settings:[],operations:['configure','refresh'],version:'1.0.0'};
const initial={sha:'a'.repeat(40),state:{version:1,enabled:false,settings:{},data:null}};
let fetcher:ReturnType<typeof vi.fn>;
beforeEach(()=>{Object.assign(access,{role:'owner',repo:'fixture/site',login:'fixture'});fetcher=vi.fn(async(url,options)=>new Response(JSON.stringify(options?.method==='POST'?{...initial,sha:'b'.repeat(40),state:{...initial.state,enabled:true}}:String(url).includes('?id=')?initial:{plugins:[plugin]})));vi.stubGlobal('fetch',fetcher);vi.stubGlobal('confirm',vi.fn().mockReturnValue(true));});
afterEach(()=>{wrappers.forEach(w=>w.unmount());wrappers=[];vi.unstubAllGlobals();});
async function fixture(){const wrapper=mount(PluginWorkspace,{props:{client:{listDir:vi.fn().mockResolvedValue([])} as unknown as GitHubClient}});wrappers.push(wrapper);await flushPromises();return wrapper;}
const button=(w:VueWrapper,label:string)=>w.findAll('button').find(b=>b.text()===label)!;
it('loads catalog, enables with the loaded revision, and keeps website publication separate',async()=>{
 const w=await fixture();await w.get('.plugin-card').trigger('click');await flushPromises();await button(w,'Enable').trigger('click');await flushPromises();
 const write=fetcher.mock.calls.find(([,options])=>options?.method==='POST')!;expect(JSON.parse(write[1].body)).toEqual({id:'research',operation:'set-enabled',input:{expectedSha:initial.sha,enabled:true}});
 expect(w.text()).toContain('Saved privately');expect(w.text()).toContain('Scheduled collection is not connected');expect(button(w,'Disable').exists()).toBe(true);
});
it('unsaved source settings guard navigation and conflicts do not erase edits',async()=>{
 const w=await fixture();await w.get('.plugin-card').trigger('click');await flushPromises();await button(w,'Add source').trigger('click');expect(hasUnsavedChanges.value).toBe(true);
 await w.get('input[type=url]').setValue('https://example.com/source');
 fetcher.mockResolvedValue(new Response(JSON.stringify({error:'Plugin data changed'}),{status:409}));
 await w.get('form').trigger('submit');await flushPromises();expect(w.text()).toContain('Plugin data changed');expect((w.get('input[type=url]').element as HTMLInputElement).value).toBe('https://example.com/source');expect(hasUnsavedChanges.value).toBe(true);
});
it('does not request plugin data for an editor',async()=>{access.role='editor';const w=await fixture();expect(w.text()).toContain('Only the site owner');expect(fetcher).not.toHaveBeenCalled();});
