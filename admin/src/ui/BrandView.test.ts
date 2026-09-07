import {afterEach,expect,it,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import BrandView from './BrandView.vue';
import type {GitHubClient} from '../backend/github';
import {clearError} from '../errors';
afterEach(clearError);
it('does not offer to save default branding after a failed load, and can retry',async()=>{
 const loadJson=vi.fn().mockRejectedValueOnce(new Error('Transient read failure')).mockResolvedValue({data:{brand:{colors:{accent:'#123456'}}},sha:'existing'});
 const saveJson=vi.fn().mockResolvedValue('saved');
 const w=mount(BrandView,{props:{client:{loadJson,saveJson} as unknown as GitHubClient}});await flushPromises();
 expect(w.get('[role="alert"]').text()).toContain('Saving is paused');
 const save=w.findAll('button').find(b=>b.text()==='Save')!;expect(save.attributes('disabled')).toBeDefined();await save.trigger('click');expect(saveJson).not.toHaveBeenCalled();
 await w.findAll('button').find(b=>b.text()==='Retry loading')!.trigger('click');await flushPromises();expect(w.find('[role="alert"]').exists()).toBe(false);expect(save.attributes('disabled')).toBeUndefined();
 expect(w.findAll('input').some(i=>i.element.value==='#123456')).toBe(true);w.unmount();
});
