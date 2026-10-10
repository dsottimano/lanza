import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ThemeHistory from './ThemeHistory.vue';
import { listAppliedThemes, planRevert, executeRevert, type RevertPlan } from '../backend/themeHistory';
import type { GitHubClient } from '../backend/github';
import { errorState, clearError } from '../errors';
vi.mock('../backend/themeHistory',()=>({listAppliedThemes:vi.fn(),planRevert:vi.fn(),executeRevert:vi.fn()}));
const theme={sha:'apply',title:'Test',date:'2026-10-10'};
const plan:RevertPlan={head:'head',applySha:'apply',title:'Test',restore:[],remove:['theme.html'],conflicts:[]};
const client={} as GitHubClient;
beforeEach(()=>{
 vi.mocked(listAppliedThemes).mockReset().mockResolvedValue([theme]);
 vi.mocked(planRevert).mockReset().mockResolvedValue(plan);
 vi.mocked(executeRevert).mockReset().mockResolvedValue('reverted');
});
afterEach(clearError);
const button=(wrapper:ReturnType<typeof mount>,name:string)=>wrapper.findAll('button').find(b=>b.text()===name)!;
it('shows retry after a failed history load, never an empty history claim',async()=>{
 vi.mocked(listAppliedThemes).mockRejectedValueOnce(new Error('Offline'));
 const wrapper=mount(ThemeHistory,{props:{client}});await flushPromises();
 expect(wrapper.find('[role="alert"]').text()).toContain('Couldn’t load theme history');
 expect(wrapper.text()).not.toContain('No theme applications');
 await button(wrapper,'Try again').trigger('click');await flushPromises();
 expect(button(wrapper,'Revert').exists()).toBe(true);expect(executeRevert).not.toHaveBeenCalled();wrapper.unmount();
});
it('describes the limited history window honestly',async()=>{
 vi.mocked(listAppliedThemes).mockResolvedValue([]);
 const wrapper=mount(ThemeHistory,{props:{client}});await flushPromises();
 expect(wrapper.text()).toContain('latest 30 commits');expect(wrapper.text()).not.toContain('No themes have been applied yet');wrapper.unmount();
});
it('cancellation cannot write and confirmation requires another plan',async()=>{
 const wrapper=mount(ThemeHistory,{props:{client}});await flushPromises();
 await button(wrapper,'Revert').trigger('click');await flushPromises();
 await button(wrapper,'Cancel').trigger('click');
 expect(executeRevert).not.toHaveBeenCalled();
 expect(wrapper.text()).not.toContain('Revert theme');
 await button(wrapper,'Revert').trigger('click');await flushPromises();
 expect(planRevert).toHaveBeenCalledTimes(2);wrapper.unmount();
});
it('an uncertain write clears its old plan and keeps an actionable warning',async()=>{
 vi.mocked(executeRevert).mockRejectedValue(new Error('Connection lost'));
 const wrapper=mount(ThemeHistory,{props:{client}});await flushPromises();
 await button(wrapper,'Revert').trigger('click');await flushPromises();
 await button(wrapper,'Revert theme').trigger('click');await flushPromises();
 expect(wrapper.find('[role="alert"]').text()).toContain('Check staging');
 expect(wrapper.text()).not.toContain('no changes were committed');
 expect(wrapper.text()).not.toContain('Revert theme');
 await button(wrapper,'Revert').trigger('click');await flushPromises();
 expect(planRevert).toHaveBeenCalledTimes(2);expect(executeRevert).toHaveBeenCalledTimes(1);wrapper.unmount();
});
it('duplicate confirmation clicks issue only one write',async()=>{
 let finish!:(sha:string)=>void;
 vi.mocked(executeRevert).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const wrapper=mount(ThemeHistory,{props:{client}});await flushPromises();
 await button(wrapper,'Revert').trigger('click');await flushPromises();
 const confirm=button(wrapper,'Revert theme');await confirm.trigger('click');await confirm.trigger('click');
 expect(executeRevert).toHaveBeenCalledTimes(1);
 finish('saved');await flushPromises();expect(wrapper.text()).toContain('Theme reverted');wrapper.unmount();
});
it('does not report late planning failures after leaving the screen',async()=>{
 let reject!:(e:Error)=>void;
 vi.mocked(planRevert).mockImplementation(()=>new Promise((_,fail)=>{reject=fail;}));
 const wrapper=mount(ThemeHistory,{props:{client}});await flushPromises();
 await button(wrapper,'Revert').trigger('click');wrapper.unmount();
 reject(new Error('Late failure'));await flushPromises();
 expect(errorState.message).toBeNull();expect(executeRevert).not.toHaveBeenCalled();
});
