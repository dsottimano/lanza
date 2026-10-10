import { afterEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import StartersView from "./StartersView.vue";
import { prepareStarter, installStarter } from "../backend/starters";
import { loadSchema } from "../backend/schema";
import type { GitHubClient } from "../backend/github";
vi.mock("../backend/starters",()=>({prepareStarter:vi.fn(),installStarter:vi.fn()}));
vi.mock("../backend/schema",()=>({loadSchema:vi.fn()}));
vi.mock("./staging",()=>({refreshPending:vi.fn()}));
const plan={label:'Test starter',homePreserved:true,overview:'/intro/',listingUrl:'/events/',notes:[],files:[{path:'test',action:'add'}]};
async function fixture(){
 vi.mocked(prepareStarter).mockResolvedValue(plan as never);vi.mocked(installStarter).mockResolvedValue({});vi.mocked(loadSchema).mockResolvedValue();
 const w=mount(StartersView,{props:{client:{} as GitHubClient}});
 await w.findAll('button').find(b=>b.text()==='Review installation →')!.trigger('click');await flushPromises();return w;
}
afterEach(()=>vi.resetAllMocks());
it('reports a completed installation separately from a failed editor refresh',async()=>{
 const w=await fixture();vi.mocked(loadSchema).mockRejectedValue(new Error('offline'));
 await w.findAll('button').find(b=>b.text()==='Install to staging')!.trigger('click');await flushPromises();
 expect(w.get('[role="status"]').text()).toContain('installed to staging');expect(w.get('[role="alert"]').text()).toContain('was installed, but the editor could not refresh');
 expect(installStarter).toHaveBeenCalledTimes(1);expect(w.find('.review').exists()).toBe(false);w.unmount();
});
it('clears uncertain installation plans and asks the user to check staging',async()=>{
 const w=await fixture();vi.mocked(installStarter).mockRejectedValue(new Error('Connection lost'));
 await w.findAll('button').find(b=>b.text()==='Install to staging')!.trigger('click');await flushPromises();
 expect(w.get('[role="alert"]').text()).toContain('Check staging');expect(w.find('[role="status"]').exists()).toBe(false);expect(w.find('.review').exists()).toBe(false);expect(loadSchema).not.toHaveBeenCalled();w.unmount();
});
it('prevents duplicate installs while the reviewed commit is pending',async()=>{
 const w=await fixture();let finish!:(v:Record<string,string>)=>void;
 vi.mocked(installStarter).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const button=w.findAll('button').find(b=>b.text()==='Install to staging')!;await button.trigger('click');await button.trigger('click');expect(installStarter).toHaveBeenCalledTimes(1);
 finish({});await flushPromises();expect(w.get('[role="status"]').text()).toContain('installed to staging');w.unmount();
});
