import { afterEach, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import TemplateEditor from "./TemplateEditor.vue";
import SaveButton from "./SaveButton.vue";
import type { GitHubClient } from "../backend/github";
import { reportError } from "../errors";
vi.mock("../errors",()=>({reportError:vi.fn(),clearError:vi.fn()}));
const templates=['first','second'].map(name=>({name,label:name,fields:[],body:false}));
function fixture(loadText=vi.fn().mockResolvedValue({text:'<p>First</p>',sha:'one'}),saveText=vi.fn().mockResolvedValue('saved')) {
 const data=reactive({preset:'first',slots:{}});
 const w=mount(TemplateEditor,{props:{client:{loadText,saveText} as unknown as GitHubClient,data,locale:'en',templates,loading:false}});
 const open=async()=>{const details=w.get('details');(details.element as HTMLDetailsElement).open=true;await details.trigger('toggle');await flushPromises();};
 return {w,data,open,loadText,saveText};
}
afterEach(()=>vi.clearAllMocks());
it('blocks failed loads and retries with the loaded file version',async()=>{
 const f=fixture(vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({text:'<p>Recovered</p>',sha:'recovered'}));await f.open();
 expect(f.w.find('textarea').exists()).toBe(false);expect(f.w.findComponent(SaveButton).exists()).toBe(false);
 await f.w.get('[role="alert"] button').trigger('click');await flushPromises();await f.w.findComponent(SaveButton).props('action')();
 expect(f.saveText).toHaveBeenCalledWith('templates/first/template.html','<p>Recovered</p>','Edit template first','recovered');f.w.unmount();
});
it('ignores a stale read after switching templates',async()=>{
 let finish!:(v:{text:string;sha:string})=>void;
 const load=vi.fn().mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValue({text:'<p>Second</p>',sha:'two'});
 const f=fixture(load);await f.open();f.data.preset='second';await flushPromises();await f.open();
 finish({text:'<p>Stale</p>',sha:'stale'});await flushPromises();
 expect((f.w.get('textarea').element as HTMLTextAreaElement).value).toBe('<p>Second</p>');
 await f.w.findComponent(SaveButton).props('action')();expect(f.saveText.mock.calls[0]![0]).toBe('templates/second/template.html');expect(f.saveText.mock.calls[0]![3]).toBe('two');f.w.unmount();
});
it('a late save cannot replace the next template version',async()=>{
 let finish!:(sha:string)=>void;
 const f=fixture(vi.fn().mockResolvedValueOnce({text:'First',sha:'one'}).mockResolvedValue({text:'Second',sha:'two'}),vi.fn().mockReturnValueOnce(new Promise<string>(resolve=>{finish=resolve;})).mockResolvedValue('second-saved'));
 await f.open();const saving=f.w.findComponent(SaveButton).props('action')();f.data.preset='second';await flushPromises();await f.open();finish('first-saved');await saving;
 await f.w.findComponent(SaveButton).props('action')();expect(f.saveText.mock.calls[1]![3]).toBe('two');f.w.unmount();
});
it('ignores a failed read after unmount',async()=>{
 let fail!:(error:Error)=>void;const f=fixture(vi.fn().mockReturnValue(new Promise((_resolve,reject)=>{fail=reject;})));await f.open();f.w.unmount();fail(new Error('late'));await flushPromises();expect(reportError).not.toHaveBeenCalled();
});
