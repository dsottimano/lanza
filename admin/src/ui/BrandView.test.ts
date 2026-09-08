import {afterEach,expect,it,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import BrandView from './BrandView.vue';
import type {GitHubClient} from '../backend/github';
import {clearError} from '../errors';
vi.mock('../backend/brand', async importOriginal => ({ ...await importOriginal<typeof import('../backend/brand')>(), previewFontHref: () => null }));
afterEach(clearError);
it('does not offer to save default branding after a failed load, and can retry',async()=>{
 const loadJson=vi.fn().mockRejectedValueOnce(new Error('Transient read failure')).mockResolvedValue({data:{brand:{colors:{accent:'#123456'}}},sha:'existing'});
 const saveJson=vi.fn().mockResolvedValue('saved');
 const w=mount(BrandView,{props:{client:{loadJson,saveJson} as unknown as GitHubClient}});await flushPromises();
 expect(w.get('[role="alert"]').text()).toContain('Saving is paused');
 const save=w.findAll('button').find(b=>b.text()==='Apply to staging')!;expect(save.attributes('disabled')).toBeDefined();await save.trigger('click');expect(saveJson).not.toHaveBeenCalled();
 await w.findAll('button').find(b=>b.text()==='Retry loading')!.trigger('click');await flushPromises();expect(w.find('[role="alert"]').exists()).toBe(false);expect(save.attributes('disabled')).toBeDefined();
 expect(w.findAll('input').some(i=>i.element.value==='#123456')).toBe(true);w.unmount();
});

it('Cancel restores all starting brand values without writing; Apply establishes the next baseline',async()=>{
 const initial={colors:{bg:'#112233',surface:'#223344',ink:'#ffffff',muted:'#aabbcc',accent:'#ddeeff',border:'#334455'},fonts:{heading:'lora',body:'inter'},radius:'18px',motion:'off',scheme:'dark'};
 const loadJson=vi.fn().mockResolvedValue({data:{brand:initial,logo:'keep.svg'},sha:'existing'});
 const saveJson=vi.fn().mockResolvedValue('saved');
 const w=mount(BrandView,{props:{client:{loadJson,saveJson} as unknown as GitHubClient}});await flushPromises();
 const button=(label:string)=>w.findAll('button').find(b=>b.text()===label)!;
 const originalStyle=w.get('.brand-preview').attributes('style');
 await button('Midnight').trigger('click');await button('Light').trigger('click');
 expect(w.get('.brand-preview').attributes('style')).not.toBe(originalStyle);
 await button('Cancel').trigger('click');
 expect(w.get('.brand-preview').attributes('style')).toBe(originalStyle);
 expect(button('Dark').classes()).toContain('segment-btn--active');
 expect(saveJson).not.toHaveBeenCalled();
 await button('Editorial').trigger('click');
 const appliedStyle=w.get('.brand-preview').attributes('style');
 await button('Apply to staging').trigger('click');await flushPromises();
 expect(saveJson).toHaveBeenCalledTimes(1);
 await button('Midnight').trigger('click');await button('Cancel').trigger('click');
 expect(w.get('.brand-preview').attributes('style')).toBe(appliedStyle);
 expect(saveJson).toHaveBeenCalledTimes(1);w.unmount();
});
