import { afterEach, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import PublishView from './PublishView.vue';
import { GitHubError, PublishReviewError, type GitHubClient } from '../backend/github';
import { clearError, errorState } from '../errors';
const snapshot={productionSha:'a',stagingSha:'b',diff:{status:'ahead',files:[{filename:'page.md',status:'modified'}]}};
afterEach(clearError);
function setup(status='ahead') {
  const client={publishReview:vi.fn().mockResolvedValue({...snapshot,diff:{...snapshot.diff,status}}),publish:vi.fn().mockResolvedValue({merged:true}),updateDrafts:vi.fn().mockResolvedValue(undefined)};
  const wrapper=mount(PublishView,{props:{client:client as unknown as GitHubClient}});
  return {client,wrapper};
}
it('one publish click sends one request and blocks duplicate clicks while pending',async()=>{
  const {client,wrapper}=setup();await flushPromises();
  let finish!:(value:{merged:boolean})=>void;
  client.publish.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const button=wrapper.find('header .btn-primary');
  await button.trigger('click');await button.trigger('click');
  expect(client.publish).toHaveBeenCalledTimes(1);
  expect(client.publish).toHaveBeenCalledWith(expect.any(String),snapshot);
  expect(button.text()).toBe('Publishing…');
  finish({merged:true});await flushPromises();wrapper.unmount();
});
it('shows an actionable conflict inline instead of the raw GitHub modal',async()=>{
  const {client,wrapper}=setup();await flushPromises();
  client.publish.mockRejectedValue(new GitHubError(409,'Merge conflict'));
  await wrapper.find('header .btn-primary').trigger('click');await flushPromises();
  expect(wrapper.find('[role="alert"]').text()).toContain('Your drafts are safe');
  expect(wrapper.text()).toContain('Check again');expect(errorState.message).toBeNull();wrapper.unmount();
});
it('requires updating divergent drafts, then a separate review and publish',async()=>{
  const {client,wrapper}=setup('diverged');await flushPromises();
  expect(wrapper.find('header .btn-primary').attributes('disabled')).toBeDefined();
  client.publishReview.mockResolvedValue(snapshot);
  await wrapper.findAll('button').find(b=>b.text()==='Update drafts')!.trigger('click');await flushPromises();
  expect(client.updateDrafts).toHaveBeenCalledTimes(1);expect(client.publish).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain('Review the combined changes');wrapper.unmount();
});
it('requires another review when drafts change before publishing',async()=>{
  const {client,wrapper}=setup();await flushPromises();
  client.publish.mockRejectedValue(new PublishReviewError('stale','Drafts changed. Review again.'));
  await wrapper.find('header .btn-primary').trigger('click');await flushPromises();
  expect(wrapper.text()).toContain('Drafts changed');expect(client.publishReview).toHaveBeenCalledTimes(2);wrapper.unmount();
});
it('does not show a failed refresh as nothing to publish',async()=>{
  const {client,wrapper}=setup();client.publishReview.mockRejectedValue(new Error('Network down'));await flushPromises();
  await wrapper.find('header .btn-primary').trigger('click');await flushPromises();
  expect(wrapper.text()).toContain('Couldn’t check unpublished changes');
  expect(wrapper.text()).not.toContain('staging matches production');
  expect(wrapper.find('header .btn-primary').attributes('disabled')).toBeDefined();wrapper.unmount();
});
