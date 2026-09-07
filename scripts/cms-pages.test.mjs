import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { render } from '../frontend/lib/template-render.ts';
import { checkContent } from './check-content.mjs';
const root = new URL('../', import.meta.url).pathname;
const read = p => readFileSync(join(root,p),'utf8');

for (const locale of ['en', 'es']) for (const slug of ['agents','architecture','how-it-works','start','posts']) {
  test(`${locale}/${slug}: editable CMS fields drive the public template`, () => {
    const collection = JSON.parse(read('data/schema.json')).find(c => c.name === 'pages');
    assert.equal(collection.kind, 'folder');
    const raw = read(`${collection.folder}/${locale}/${slug}.md`);
    const page = yaml.load(raw.match(/^---\n([\s\S]*?)\n---/)[1]);
    assert.equal(page.draft, false);
    const source = read(`templates/${page.preset}/template.html`);
    const fields = JSON.parse(read(`templates/${page.preset}/fields.json`)).fields;
    const key = slug === 'architecture' ? 'headline' : slug === 'posts' ? 'heading' : 'title';
    assert(fields.some(f => f.name === key));
    const changed = { ...page.slots, [key]: 'CMS edit <must be escaped>' };
    const html = render(source, changed);
    assert(html.includes('CMS edit &lt;must be escaped&gt;'));
    assert(!html.includes(page.slots[key]));
    if (page.slots.sections) {
      changed.sections = structuredClone(page.slots.sections);
      changed.sections[0].paragraphs[0].text = 'Changed nested paragraph';
      assert(render(source, changed).includes('Changed nested paragraph'));
    }
  });
}

test('real content belongs to the CMS and every stored slot is declared', () => {
  assert.deepEqual(checkContent(root), []);
});

test('build gate rejects orphan content, missing presets and undeclared nested slots', () => {
  const dir = mkdtempSync(join(tmpdir(),'lanza-schema-'));
  const put=(p,s)=>{mkdirSync(join(dir,p,'..'),{recursive:true});writeFileSync(join(dir,p),s);};
  try {
    put('data/schema.json', JSON.stringify([{kind:'folder',name:'pages',folder:'content/pages'}]));
    put('frontend/pages/pricing.astro','<h1>Bypasses the CMS</h1>');
    put('content/forgotten/page.md','---\ntitle: Invisible in CMS\n---\n');
    put('content/pages/missing.md','---\npreset: absent\n---\n');
    put('templates/example/fields.json',JSON.stringify({fields:[{name:'cards',widget:'list',fields:[{name:'heading',widget:'string'}]}]}));
    put('templates/example/template.html','{{#each cards}}{{ heading }}{{/each}}');
    put('content/pages/bad.md','---\npreset: example\nslots:\n  cards:\n    - typo: Invisible field\n---\n');
    assert.deepEqual(new Set(checkContent(dir).map(p=>p.code)),new Set(['route-outside-schema','content-outside-schema','content-template-missing','undeclared-content-field']));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

// Execute the actual static-path builder with content-query fixtures. This catches
// the old silent shadowing without relying on assertions about source spelling.
import vm from 'node:vm';
for (const localized of [false, true]) test(`${localized ? 'localized' : 'root'} routes preserve CMS ownership, including draft and moved blog pages`, async () => {
  const path = localized ? 'frontend/pages/[locale]/[...slug].astro' : 'frontend/pages/[...slug].astro';
  const frontmatter = read(path).split('---')[1];
  const source = frontmatter.slice(frontmatter.indexOf('export async function'), frontmatter.indexOf('const { page, fixed'))
    .replace('export async function', 'async function');
  const locale = localized ? 'es' : 'en';
  for (const state of ['published', 'draft', 'moved', 'absent']) {
    const page = {id:`${locale}/posts`,slug:state === 'moved' ? 'journal' : 'posts'};
    const entries = state === 'absent' ? [] : [page];
    const context = {
      publishedPages:async()=>state === 'draft' ? [] : entries,
      getCollection:async()=>entries,
      splitEntries:items=>({root:items.map(entry=>({entry,locale,slug:entry.slug})),localized:items.map(entry=>({entry,locale,slug:entry.slug}))}),
      otherLocales:()=>['es'], FIXED_PAGES:[{slug:'posts'}],
    };
    const paths = await vm.runInNewContext(source+'\ngetStaticPaths()', context);
    assert.equal(paths.filter(p=>p.props.fixed).length, state === 'absent' ? 1 : 0, state);
    assert.equal(paths.filter(p=>p.props.page).length, ['published','moved'].includes(state) ? 1 : 0, state);
    if (state === 'moved') assert.equal(paths[0].params.slug, 'journal');
  }
});

// Fixed marketing pages caused this regression: only the generic blog fallback
// may bypass Pages, and its CMS ownership is tested above.
import { stripTypeScriptTypes } from 'node:module';
test('fixed registry cannot silently grow non-CMS product pages', () => {
  const source = stripTypeScriptTypes(read('frontend/lib/fixed-pages.ts'))
    .replace(/^import .*;$/gm, '').replace(/export /g, '');
  const pages = vm.runInNewContext(source + '\nFIXED_PAGES');
  assert.deepEqual(Array.from(pages, page => page.slug), ['posts']);
});
