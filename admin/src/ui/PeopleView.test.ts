import { mount } from '@vue/test-utils';
import { afterEach, expect, it } from 'vitest';
import PeopleView from './PeopleView.vue';
import { access, loadAccess } from '../backend/access';
import type { GitHubClient } from '../backend/github';

afterEach(() => Object.assign(access, { login: null, role: null, repo: null, loaded: false, delegated: false }));

it('explains delegated access without claiming a GitHub owner role or a saved grant', () => {
  Object.assign(access, { login: 'alice', role: 'owner', repo: 'owner/site', loaded: true, delegated: true });
  const view = mount(PeopleView);
  expect(view.text()).toContain('Site administrator');
  expect(view.text()).toContain('Only the GitHub repository owner');
  expect(view.text()).toContain('does not grant hosting access');
  expect(view.find('input').exists()).toBe(false);
  expect(view.find('a').attributes('href')).toBe('https://github.com/owner/site/settings/access');
});

it('loads server delegation and clears it after an identity failure', async () => {
  const client = { getIdentity: async () => ({ login: 'alice', role: 'owner', repo: 'owner/site', delegated: true }) } as unknown as GitHubClient;
  await loadAccess(client);
  expect(access.delegated).toBe(true);
  expect(access.role).toBe('owner');
  await loadAccess({ getIdentity: async () => { throw new Error('unavailable'); } } as unknown as GitHubClient);
  expect(access.role).toBe(null);
  expect(access.delegated).toBe(false);
});
