import { afterEach, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useImageUpload } from "./useImageUpload";
import { uploadImage } from "../backend/media";
import type { GitHubClient } from "../backend/github";
import ImageInput from "./ImageInput.vue";
import { CLIENT_KEY } from "./context";
vi.mock("../backend/media",()=>({uploadImage:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
function inputEvent(){const input={files:[new File(['image'],'photo.png')],value:'photo.png'};return{input,event:{target:input} as unknown as Event};}
it('runs one upload at a time and allows retry after failure',async()=>{
 let reject!:(e:Error)=>void;vi.mocked(uploadImage).mockReturnValueOnce(new Promise((_r,no)=>{reject=no;})).mockResolvedValue('/image.png');
 let flow!:ReturnType<typeof useImageUpload>;const w=mount(defineComponent({setup(){flow=useImageUpload({} as GitHubClient);return()=>null;}}));
 const {input,event}=inputEvent(),success=vi.fn(),error=vi.fn();const pending=flow.pick(event,success,error);await flow.pick(event,success,error);
 expect(uploadImage).toHaveBeenCalledTimes(1);reject(new Error('offline'));await pending;expect(error).toHaveBeenCalledTimes(1);expect(input.value).toBe('');expect(flow.uploading.value).toBe(false);
 await flow.pick(event,success,error);expect(success).toHaveBeenCalledWith('/image.png');w.unmount();
});
it.each(['success','failure'])('suppresses a late %s callback after unmount',async outcome=>{
 let resolve!:(url:string)=>void, reject!:(e:Error)=>void;vi.mocked(uploadImage).mockReturnValue(new Promise((yes,no)=>{resolve=yes;reject=no;}));
 let flow!:ReturnType<typeof useImageUpload>;const w=mount(defineComponent({setup(){flow=useImageUpload({} as GitHubClient);return()=>null;}}));
 const {event}=inputEvent(),success=vi.fn(),error=vi.fn();const pending=flow.pick(event,success,error);w.unmount();
 if(outcome==='success')resolve('/uploaded.png');else reject(new Error('late'));await pending;expect(success).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
});
it('does not replace an externally changed form image when upload completes',async()=>{
 let finish!:(url:string)=>void;vi.mocked(uploadImage).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const w=mount(ImageInput,{props:{modelValue:'/old.png'},global:{provide:{[CLIENT_KEY as symbol]:{} as GitHubClient}}});
 const file=w.get('input[type="file"]');Object.defineProperty(file.element,'files',{value:[new File(['image'],'photo.png')]});await file.trigger('change');
 await w.setProps({modelValue:'/newer.png'});finish('/uploaded.png');await flushPromises();expect(w.emitted('update:modelValue')).toBeUndefined();expect(w.get('img').attributes('src')).toBe('/newer.png');w.unmount();
});
