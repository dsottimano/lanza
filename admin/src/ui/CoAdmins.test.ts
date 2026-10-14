import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import CoAdmins from './CoAdmins.vue';
afterEach(() => vi.unstubAllGlobals());
function fixture(source = 'github') {
 const calls: any[] = [];
 vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
  if (!init?.body) return Response.json({ logins: ['alice'], revision: 'initial', source });
  const body = JSON.parse(init.body); calls.push(body);
  return Response.json({ saved: true, logins: body.logins, revision: 'saved', source: 'github' });
 })); return calls;
}
const button = (view: ReturnType<typeof mount>, label: string) => view.findAll('button').find(b => b.text() === label)!;
it('owner adds and removes co-admins and saves directly with GitHub', async () => {
 const calls = fixture(); const view = mount(CoAdmins); await flushPromises();
 expect(view.find('input[type="password"]').exists()).toBe(false); expect(view.text()).not.toContain('Cloudflare');
 await view.find('input').setValue('bob'); await view.find('form').trigger('submit');
 await view.find('[aria-label="Remove alice"]').trigger('click');
 expect(view.text()).toContain('Unsaved co-admin changes');
 await button(view, 'Save co-admins').trigger('click'); await flushPromises();
 expect(calls.at(-1)).toEqual({ action: 'save', expectedRevision: 'initial', logins: ['bob'] });
 expect(view.text()).toContain('Access changes on the next request'); expect(view.text()).not.toContain('Unsaved co-admin changes');
 expect(button(view, 'Save co-admins').attributes('disabled')).toBeDefined(); view.unmount();
});
it('legacy list is preserved and can be migrated without changing usernames', async () => {
 const calls = fixture('legacy'); const view = mount(CoAdmins); await flushPromises();
 expect(view.text()).toContain('Your existing co-admins');
 await button(view, 'Save co-admins').trigger('click'); await flushPromises();
 expect(calls[0].logins).toEqual(['alice']); expect(view.text()).not.toContain('Your existing co-admins'); view.unmount();
});
it('API conflicts preserve edits without claiming they were saved', async () => {
 fixture(); const view = mount(CoAdmins); await flushPromises();
 await view.find('[aria-label="Remove alice"]').trigger('click');
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Co-admins changed. Reload.' }, { status: 409 })));
 await button(view, 'Save co-admins').trigger('click'); await flushPromises();
 expect(view.get('[role="alert"]').text()).toContain('Reload'); expect(view.text()).not.toContain('Co-admins saved');
 expect(view.text()).toContain('Unsaved co-admin changes'); expect(view.text()).toContain('No co-admins selected'); view.unmount();
});
it('failed initial load offers retry and does not present an empty saved list', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'GitHub unavailable' }, { status: 503 })));
 const view = mount(CoAdmins); await flushPromises();
 expect(view.text()).toContain('GitHub unavailable'); expect(view.text()).not.toContain('No co-admins selected');
 fixture(); await button(view, 'Retry loading co-admins').trigger('click'); await flushPromises();
 expect(view.text()).toContain('alice'); view.unmount();
});
