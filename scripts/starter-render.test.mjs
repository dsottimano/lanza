import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { planStarter, STARTERS } from '../functions/_lib/site-starters.mjs';
import { render } from '../frontend/lib/template-render.ts';
import { resolveSitePlugins } from '../frontend/lib/site-plugins.ts';

for (const starter of STARTERS) for (const locale of ['en', 'es']) {
  test(`${starter.id}/${locale}: installed content, fields and URLs render human edits`, () => {
    const texts = { 'data/site.json': JSON.stringify({ defaultLocale: 'en', locales: [{ code: 'en' }, { code: 'es' }] }), 'data/schema.json': '[]' };
    const plan = planStarter({ id: starter.id, locale, paths: Object.keys(texts), texts });
    const text = path => plan.files.find(file => file.path === path).text;
    const page = yaml.load(text(`content/pages/${locale}/home.md`).split('---')[1]);
    assert.equal(page.preset, starter.home.preset);
    const prefix = locale === 'en' ? '' : '/es';
    assert.equal(page.slots.browseUrl, `${prefix}/${starter.contentType.route.base}/`);
    const fields = JSON.parse(text(`templates/${page.preset}/fields.json`));
    assert.ok(fields.fields.some(field => field.name === 'heading'));
    page.slots.heading = `Owner headline ${locale}`;
    assert.ok(render(text(`templates/${page.preset}/template.html`), page.slots).includes(page.slots.heading));
    const sample = starter.samples[0];
    const entry = yaml.load(text(`content/${starter.contentType.name}/${locale}/${sample.stem}.md`).split('---')[1]);
    entry.title = `Owner entry ${locale}`;
    entry.backLabel = `Owner back link ${locale}`;
    const html = render(text(`templates/${starter.contentType.route.template}/template.html`), { ...entry, body: '<p>Preserved body</p>', indexUrl: plan.listingUrl });
    assert.ok(html.includes(entry.title));
    assert.ok(html.includes(entry.backLabel));
    assert.ok(html.includes('<p>Preserved body</p>'));
    const listing = starter.contentType.route.list;
    const listHtml = render(text(`templates/${listing.template}/template.html`), { ...listing.slots, heading: 'Owner listing', entries: [{ ...entry, url: `${plan.listingUrl}${sample.stem}/` }], count: 1, isEmpty: false });
    assert.ok(listHtml.includes('Owner listing'));
    assert.ok(listHtml.includes(entry.title));
    assert.ok(listHtml.includes(`href="${plan.listingUrl}${sample.stem}/"`));
  });
}
test('plugins require explicit booleans; unknown configuration cannot enable code', () => {
  assert.deepEqual(resolveSitePlugins(null), { readingProgress: false, imageZoom: false });
  assert.deepEqual(resolveSitePlugins({ readingProgress: 'true', imageZoom: 1, script: 'https://example.org/code.js' }), { readingProgress: false, imageZoom: false });
  assert.deepEqual(resolveSitePlugins({ readingProgress: true, imageZoom: true }), { readingProgress: true, imageZoom: true });
});

for (const starter of STARTERS) test(`${starter.id}: existing homepage leaves distinct overview and listing URLs`, () => {
  const texts = { 'data/site.json': JSON.stringify({ defaultLocale: 'en', locales: [{ code: 'en' }] }), 'data/schema.json': '[]', 'content/pages/en/home.md': 'Owner home' };
  const plan = planStarter({ id: starter.id, locale: 'en', paths: Object.keys(texts), texts });
  assert.notEqual(plan.overview, plan.listingUrl);
  assert.equal(plan.files.some(file => file.path === 'content/pages/en/home.md'), false);
});
