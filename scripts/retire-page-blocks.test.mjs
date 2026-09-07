import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkContent } from './check-content.mjs';
import { legacyPageBlocks } from '../frontend/lib/legacy-page-blocks.ts';

test('Pages offers presets and slots, with no separate block builder', () => {
  const schema = JSON.parse(readFileSync(new URL('../data/schema.json', import.meta.url), 'utf8'));
  const fields = schema.find(c => c.name === 'pages').fields.map(f => f.name);
  assert(fields.includes('preset') && fields.includes('slots'));
  assert(!fields.includes('blocks'));
});

test('removing the old schema field cannot silently discard existing page content', () => {
  const root = mkdtempSync(join(tmpdir(), 'lanza-retire-blocks-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'content/pages/en'), { recursive: true });
    const collection = { name: 'pages', kind: 'folder', folder: 'content/pages', fields: [] };
    const schemaPath = join(root, 'data/schema.json');
    writeFileSync(schemaPath, JSON.stringify([collection]));
    writeFileSync(join(root, 'content/pages/en/about.md'), '---\ntitle: About\nblocks:\n  - type: text\n    body: Keep this content\n---\n<p>Keep this body too.</p>\n');
    assert(checkContent(root).some(p => p.code === 'legacy-blocks-without-schema'));
    // An old tenant remains supported until its content is migrated.
    collection.fields.push({ name: 'blocks', widget: 'list' });
    writeFileSync(schemaPath, JSON.stringify([collection]));
    assert.deepEqual(checkContent(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy compatibility preserves block order and needs no field on new pages', () => {
  const blocks = [{ type: 'hero', heading: 'Hello' }, { type: 'text', body: 'Keep me' }];
  assert.strictEqual(legacyPageBlocks({ blocks }), blocks);
  assert.deepEqual(legacyPageBlocks({ title: 'New page', preset: 'example', slots: {} }), []);
});
