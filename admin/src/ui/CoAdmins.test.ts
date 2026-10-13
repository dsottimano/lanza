import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import CoAdmins from './CoAdmins.vue';
afterEach(() => vi.unstubAllGlobals());
function fixture(configured = true, failure = false) {
 const calls: any[] = [];
 vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
  if (!init?.body) return Response.json({ configured, active: ['alice'], project: 'site' });
  const body = JSON.parse(init.body); calls.push(body);
  if (body.action === 'read') return Response.json({ logins: ['alice'], revision: 'alice' });
  if (body.action === 'status') return Response.json({ deployment: { id: 'build', environment: 'production', stage: 'deploy', status: 'success' } });
  return Response.json({ saved: true, logins: body.logins, revision: body.logins.join(','), deployment: failure ? null : { id: 'build', stage: 'build', status: 'active' }, warning: failure ? 'Co-admins are saved, but the deployment could not start.' : undefined });
 }));
 return calls;
}
const button = (view: ReturnType<typeof mount>, label: string) => view.findAll('button').find(b => b.text() === label)!;
it('owner adds and removes co-admins, saves and distinguishes pending from successful deployment', async () => {
 const calls = fixture(); const view = mount(CoAdmins); await flushPromises();
 await view.find('input').setValue('bob'); await view.find('form').trigger('submit');
 expect(view.text()).toContain('bob'); await view.find('[aria-label="Remove alice"]').trigger('click');
 await button(view, 'Save and deploy').trigger('click'); await flushPromises();
 expect(calls.at(-1)).toMatchObject({ action: 'save', expectedRevision: 'alice', logins: ['bob'] });
 expect(view.text()).toContain('Deployment started'); expect(view.text()).toContain('Active on this deployment: alice');
 await button(view, 'Check deployment').trigger('click'); await flushPromises(); expect(view.text()).toContain('Deployment succeeded'); view.unmount();
});
it('failed deployment offers a retry that does not save again', async () => {
 const calls = fixture(true, true); const view = mount(CoAdmins); await flushPromises();
 await button(view, 'Save and deploy').trigger('click'); await flushPromises();
 expect(view.text()).toContain('saved, but the deployment could not start');
 await button(view, 'Retry deployment').trigger('click'); await flushPromises(); expect(calls.at(-1).action).toBe('deploy'); view.unmount();
});
it('unconfigured owner connects in the CMS with a password field and no browser persistence', async () => {
 const calls = fixture(false); const view = mount(CoAdmins); await flushPromises();
 expect(view.find('input[type="password"]').exists()).toBe(true); expect(view.text()).not.toContain('Save and deploy');
 const inputs = view.findAll('input'); await inputs[0]!.setValue('a'.repeat(32)); await inputs[2]!.setValue('temporary');
 await view.find('form').trigger('submit'); await flushPromises(); expect(calls[0].connection.token).toBe('temporary');
 expect(view.text()).toContain('Save and deploy'); view.unmount();
});
it('API refusals remain errors and do not show a saved state', async () => {
 fixture(); const view = mount(CoAdmins); await flushPromises();
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Co-admins changed. Reload.' }, { status: 409 })));
 await button(view, 'Save and deploy').trigger('click'); await flushPromises(); expect(view.get('[role="alert"]').text()).toContain('Reload'); expect(view.text()).not.toContain('Co-admins saved'); view.unmount();
});
