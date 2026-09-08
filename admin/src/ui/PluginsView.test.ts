import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import PluginsView from './PluginsView.vue';
import { access } from '../backend/access';
import { isDirty } from './dirty';
import type { GitHubClient } from '../backend/github';
beforeEach(() => { access.role = 'owner'; });
afterEach(() => { isDirty.value = false; });
function fixture() {
  const loadJson = vi.fn().mockResolvedValue({ data: { logo: 'keep.svg', brand: { radius: '18px' }, plugins: { future: true, imageZoom: true } }, sha: 'original' });
  const saveJson = vi.fn().mockResolvedValue('next');
  const wrapper = mount(PluginsView, { props: { client: { loadJson, saveJson } as unknown as GitHubClient } });
  return { wrapper, loadJson, saveJson };
}
it('cancels without writes, preserves unrelated settings and uses the loaded SHA', async () => {
  const { wrapper: w, saveJson } = fixture(); await flushPromises();
  const control = w.get('input[aria-label="Reading progress"]');
  const button = (label: string) => w.findAll('button').find(b => b.text() === label)!;
  await control.setValue(true); expect(isDirty.value).toBe(true);
  await button('Cancel').trigger('click');
  expect((control.element as HTMLInputElement).checked).toBe(false); expect(saveJson).not.toHaveBeenCalled();
  await control.setValue(true); await button('Apply to staging').trigger('click'); await flushPromises();
  expect(saveJson).toHaveBeenCalledExactlyOnceWith('data/appearance.json', { logo: 'keep.svg', brand: { radius: '18px' }, plugins: { future: true, imageZoom: true, readingProgress: true } }, expect.any(String), 'original');
  expect(isDirty.value).toBe(false);
  await control.setValue(false); await button('Cancel').trigger('click');
  expect((control.element as HTMLInputElement).checked).toBe(true); w.unmount();
});
it('keeps a failed save dirty and does not retry a concurrent-edit conflict', async () => {
  const { wrapper: w, saveJson } = fixture(); await flushPromises();
  saveJson.mockRejectedValue(new Error('Changed since loading'));
  await w.get('input[aria-label="Reading progress"]').setValue(true);
  await w.findAll('button').find(b => b.text() === 'Apply to staging')!.trigger('click'); await flushPromises();
  expect(w.get('[role="alert"]').text()).toContain('Changed since loading');
  expect(saveJson).toHaveBeenCalledTimes(1); expect(isDirty.value).toBe(true); w.unmount();
});
it('refuses editor access before reading or writing settings', async () => {
  access.role = 'editor'; const { wrapper: w, loadJson, saveJson } = fixture(); await flushPromises();
  expect(w.get('[role="alert"]').text()).toContain('owner');
  expect(w.get('fieldset').attributes('disabled')).toBeDefined();
  expect(loadJson).not.toHaveBeenCalled(); expect(saveJson).not.toHaveBeenCalled(); w.unmount();
});
