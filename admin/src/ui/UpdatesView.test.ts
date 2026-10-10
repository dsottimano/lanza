import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import UpdatesView from './UpdatesView.vue';
import { loadVersionState, setPinnedVersion, versionState, type VersionState } from '../backend/version';
import { type GitHubClient } from '../backend/github';
import { clearError } from '../errors';

vi.mock('../backend/version', async importOriginal => ({
  ...await importOriginal<typeof import('../backend/version')>(),
  loadVersionState: vi.fn(), setPinnedVersion: vi.fn(),
}));
const initial: VersionState = {
  live: '0.1.15', staged: '0.1.15', source: null, unmanaged: false, offline: false,
  registry: { latest: '0.1.16', critical: '0.1.15', releases: [{ version: '0.1.16', date: null }] },
};
beforeEach(() => {
  vi.mocked(loadVersionState).mockReset().mockResolvedValue(structuredClone(initial));
  vi.mocked(setPinnedVersion).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { clearError(); versionState.value = null; });
function setup() {
  const client = { publish: vi.fn(), compare: vi.fn().mockResolvedValue({ status: 'ahead', files: [] }) };
  const wrapper = mount(UpdatesView, { props: { client: client as unknown as GitHubClient } });
  return { wrapper, client };
}
it('stages the version and routes to review without publishing unrelated drafts', async () => {
  const { wrapper, client } = setup(); await flushPromises();
  vi.mocked(loadVersionState).mockResolvedValue({ ...initial, staged: '0.1.16' });
  await wrapper.find('button.btn-primary').trigger('click'); await flushPromises();
  expect(setPinnedVersion).toHaveBeenCalledWith(client, '0.1.16');
  expect(client.publish).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain('saved to drafts');
  expect(wrapper.text()).not.toContain('Now on');
  expect(wrapper.find('a[href="#/publish"]').text()).toBe('Review & publish');
  expect(versionState.value?.staged).toBe('0.1.16');
  wrapper.unmount();
});
it('does not claim the version is current after a failed load; retry recovers', async () => {
  vi.mocked(loadVersionState).mockRejectedValueOnce(new Error('offline'));
  const { wrapper, client } = setup(); await flushPromises();
  expect(wrapper.find('[role="alert"]').text()).toContain('Couldn’t check');
  expect(wrapper.text()).not.toContain('This is the latest version');
  expect(wrapper.find('button.btn-primary').exists()).toBe(false);
  await wrapper.find('[role="alert"] button').trigger('click'); await flushPromises();
  expect(wrapper.find('button.btn-primary').text()).toBe('Stage 0.1.16');
  expect(client.publish).not.toHaveBeenCalled(); wrapper.unmount();
});
it('blocks duplicate writes and does not claim success after a failed save', async () => {
  const { wrapper, client } = setup(); await flushPromises();
  let reject!: (error: Error) => void;
  vi.mocked(setPinnedVersion).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const button = wrapper.find('button.btn-primary');
  await button.trigger('click'); await button.trigger('click');
  expect(setPinnedVersion).toHaveBeenCalledTimes(1);
  reject(new Error('Conflict')); await flushPromises();
  expect(wrapper.text()).not.toContain('saved to drafts');
  expect(client.publish).not.toHaveBeenCalled(); wrapper.unmount();
});
