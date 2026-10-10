import { afterEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RecordEditor from "./RecordEditor.vue";
import SaveButton from "./SaveButton.vue";
import FieldForm from "../fields/FieldForm.vue";
import type { GitHubClient } from "../backend/github";
import type { FolderCollection } from "../schema";
import { isDirty } from "./dirty";
const {replace}=vi.hoisted(()=>({replace:vi.fn()}));
vi.mock("vue-router",async original=>({...await original<typeof import("vue-router")>(),useRouter:()=>({replace}),useRoute:()=>({params:{slug:'old'}})}));
vi.mock("./staging",()=>({refreshPending:vi.fn()}));
vi.mock("../errors",()=>({reportError:vi.fn(),clearError:vi.fn()}));
const collection:FolderCollection={kind:'folder',name:'authors',label:'Authors',labelSingular:'Author',folder:'content/authors',body:'none',fields:[{name:'title',label:'Title',widget:'string'}]};
function fixture(path:string|null='content/authors/old.md', saveEntry=vi.fn().mockResolvedValue('saved'), loadEntry=vi.fn().mockResolvedValue({data:{title:'Original'},body:'Preserve this body',sha:'old-sha'})){
 const client={loadEntry,saveEntry,deleteFile:vi.fn().mockResolvedValue(undefined)};
 const w=mount(RecordEditor,{props:{client:client as unknown as GitHubClient,collection,locale:'en',path},global:{stubs:{FieldForm:true}}});return{w,client,save:()=>w.findComponent(SaveButton).props('action')()};
}
afterEach(()=>{vi.clearAllMocks();isDirty.value=false;});
it('does not navigate to a later unsaved slug and follows the next completed save',async()=>{
 let finish!:(sha:string)=>void;
 const f=fixture(undefined,vi.fn().mockReturnValueOnce(new Promise<string>(resolve=>{finish=resolve;})).mockResolvedValue('next'));await flushPromises();
 await f.w.get('input').setValue('first');const saving=f.save();await f.w.get('input').setValue('second');finish('first-sha');await saving;
 expect(f.client.saveEntry.mock.calls[0]![0]).toBe('content/authors/first.md');expect(replace).not.toHaveBeenCalled();expect(isDirty.value).toBe(true);
 await f.save();expect(f.client.saveEntry.mock.calls[1]![0]).toBe('content/authors/second.md');expect(replace).toHaveBeenCalledWith('/authors/en/second');expect(isDirty.value).toBe(false);f.w.unmount();
});
it('routes a newly created record to its saved filename',async()=>{
 const f=fixture(null);await flushPromises();f.w.findComponent(FieldForm).props('data').title='New Author';await f.save();
 expect(replace).toHaveBeenCalledWith('/authors/en/new-author');expect(f.client.deleteFile).not.toHaveBeenCalled();f.w.unmount();
});
it('hides the editable form when the record read fails',async()=>{
 const f=fixture(undefined,undefined,vi.fn().mockRejectedValue(new Error('offline')));await flushPromises();
 expect(f.w.find('[role="alert"]').exists()).toBe(true);expect(f.w.findComponent(FieldForm).exists()).toBe(false);expect(f.w.find('input').exists()).toBe(false);expect(f.w.findComponent(SaveButton).props('disabled')).toBe(true);f.w.unmount();
});
