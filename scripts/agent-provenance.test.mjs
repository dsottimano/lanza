import test from 'node:test';
import assert from 'node:assert/strict';
import { markAgentHtml } from '../functions/_lib/agent-provenance.ts';
import { recordAgentFields, fieldAgentHtml } from '../frontend/lib/provenance/text.mjs';
import { sanitizeBody } from '../frontend/lib/sanitize.ts';
import { render } from '../frontend/lib/template-render.ts';

test('agent additions are marked while original text, formatting and links survive',()=>{
 const before='<h2>Human heading</h2><p>My original words.</p>';
 const after=markAgentHtml(before,before+'<p>A <strong>new</strong> sentence &amp; <a href="https://example.com">source</a>.</p>');
 assert.ok(after.startsWith(before)); assert.match(after,/data-lanza-origin="agent">new/);
 assert.match(after,/href="https:\/\/example.com"/); assert.equal(sanitizeBody(after),after);
});
test('unchanged marked text cannot be laundered by omitting the marker',()=>{
 assert.match(markAgentHtml('<p><span data-lanza-origin="agent">Agent words</span></p>','<p>Agent words</p>'),/data-lanza-origin="agent"/);
 assert.equal(markAgentHtml('<p>Unknown</p>','<p>Unknown</p>'),'<p>Unknown</p>');
});
test('editing a word preserves surrounding unmarked words',()=>{
 assert.equal(markAgentHtml('<p>The old building.</p>','<p>The new building.</p>'),'<p>The <span data-lanza-origin="agent">new</span> building.</p>');
});
test('plain fields and nested slot origins preserve unchanged fields and escape hostile text',()=>{
 const before={title:'Human',slots:{items:[{label:'Kept'}]}};
 const after={...before,slots:{items:[{label:'New <text>'}]}};
 after.lanzaProvenance=recordAgentFields(before,after);
 assert.equal(after.lanzaProvenance.fields.title,undefined);
 assert.equal(fieldAgentHtml(after,'slots.items.0.label','New <text>'),'<span data-lanza-origin="agent">New &lt;text&gt;</span>');
 const inherited={...after,title:'Another title'};inherited.lanzaProvenance=recordAgentFields(after,inherited);
 assert.ok(inherited.lanzaProvenance.fields['slots.items.0.label']);
 const output=render('<p>{{title}}</p><a href="{{title}}">link</a>',{title:'<unsafe>',lanzaProvenance:recordAgentFields({},{title:'<unsafe>'})});
 assert.match(output,/<span data-lanza-origin="agent">&lt;unsafe&gt;<\/span>/);assert.ok(!output.includes('href="<span'));
});
test('code block provenance survives without invalid inline marks',()=>{
 assert.match(markAgentHtml('', '<pre><code>let x = 1;</code></pre>'),/<pre data-lanza-origin="agent"><code>let x = 1;/);
});
