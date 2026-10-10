import { afterEach, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import BlocksView from "./BlocksView.vue";
import SaveButton from "./SaveButton.vue";
import { GitHubError, type GitHubClient } from "../backend/github";
import { loadBlocks } from "../backend/blocks";
import { isDirty } from "./dirty";
vi.mock("../errors", () => ({ reportError: vi.fn(), clearError: vi.fn() }));
const original = { blocks: [{id:"one",name:"First",html:"<p>Before</p>"}] };
const EditorStub = defineComponent({ props:["initialHtml"], emits:["change"], setup(props, {expose}) { expose({ getHTML: () => props.initialHtml }); }, template:`<button @click="$emit('change')">Edit text</button>` });
function fixture(loadJson = vi.fn().mockResolvedValue({data:original,sha:"old"}), saveJson = vi.fn().mockResolvedValue("new")) {
 const w = mount(BlocksView,{props:{client:{loadJson,saveJson} as unknown as GitHubClient},global:{stubs:{Editor:EditorStub}}});
 return {w,saveJson,save:()=>w.findComponent(SaveButton).props("action")()};
}
afterEach(()=>{isDirty.value=false;vi.clearAllMocks();});
it("blocks failed reads and recovers on retry",async()=>{
 const f=fixture(vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({data:original,sha:"recovered"}));await flushPromises();
 expect(f.w.find('input').exists()).toBe(false);await f.save();expect(f.saveJson).not.toHaveBeenCalled();
 await f.w.get('[role="alert"] button').trigger('click');await flushPromises();await f.save();expect(f.saveJson.mock.calls[0]![3]).toBe("recovered");f.w.unmount();
});
it("keeps later text and name edits dirty and saves a detached snapshot",async()=>{
 let finish!:(sha:string)=>void;const save=vi.fn().mockReturnValueOnce(new Promise<string>(resolve=>{finish=resolve;})).mockResolvedValue("latest");
 const f=fixture(undefined,save);await flushPromises();await f.w.get('input').setValue('Submitted');const saving=f.save();
 await f.w.get('input').setValue('Later');await f.w.findComponent(EditorStub).get('button').trigger('click');
 expect(save.mock.calls[0]![1].blocks[0].name).toBe('Submitted');finish('first-sha');await saving;expect(isDirty.value).toBe(true);
 await f.save();expect(save.mock.calls[1]![3]).toBe('first-sha');expect(save.mock.calls[1]![1].blocks[0].name).toBe('Later');expect(isDirty.value).toBe(false);f.w.unmount();
});
it("does not clear a new editor after an unmounted save",async()=>{
 let finish!:(sha:string)=>void;const f=fixture(undefined,vi.fn().mockReturnValue(new Promise<string>(resolve=>{finish=resolve;})));await flushPromises();
 const saving=f.save();f.w.unmount();isDirty.value=true;finish('saved');await saving;expect(isDirty.value).toBe(true);
});
it.each([null,{}, {blocks:[{id:'bad',name:'Broken'}]}, {blocks:[...original.blocks,...original.blocks]}])("refuses malformed files instead of discarding snippets",async data=>{
 await expect(loadBlocks({loadJson:vi.fn().mockResolvedValue({data,sha:'old'})} as unknown as GitHubClient)).rejects.toThrow(/snippets file/);
});
it("treats a missing file as an empty list",async()=>{
 await expect(loadBlocks({loadJson:vi.fn().mockRejectedValue(new GitHubError(404,'Not Found'))} as unknown as GitHubClient)).resolves.toEqual({blocks:[]});
});
