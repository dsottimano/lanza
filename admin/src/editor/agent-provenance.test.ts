import { afterEach, expect, it } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import Editor from './Editor.vue';
import { prepareBodyProposal } from './body-proposal';
const wrappers:VueWrapper[]=[];
afterEach(()=>wrappers.splice(0).forEach(w=>w.unmount()));
async function open(html:string) {const wrapper=mount(Editor,{props:{initialHtml:html}});wrappers.push(wrapper);await flushPromises();return wrapper.vm.editor!;}
it('retains attribution after editor reload and only marks the proposed word',async()=>{
 const editor=await open('<p>The old building.</p><p>My account.</p>');
 prepareBodyProposal(editor,'body','<p>The new building.</p><p>My account.</p>').apply();
 expect(editor.getHTML()).toContain('<p>The <span data-lanza-origin="agent" title="Agent-written text">new</span> building.</p><p>My account.</p>');
 const reloaded=await open(editor.getHTML()); expect(reloaded.getHTML()).toBe(editor.getHTML());
});
it('does not relabel unrelated headings, table cells or inline formatting',async()=>{
 const before='<h2>Original title</h2><p>Original <strong>words</strong> here.</p><table><tbody><tr><td><p>Keep cell</p></td></tr></tbody></table>';
 const editor=await open(before);prepareBodyProposal(editor,'body',editor.getHTML()+'<p>Added finding.</p>').apply();
 expect(editor.getHTML()).toContain('<h2>Original title</h2>');expect(editor.getHTML()).toContain('<strong>words</strong>');expect(editor.getHTML()).toContain('<p>Keep cell</p>');
 expect(editor.getHTML()).toContain('data-lanza-origin="agent"');
});
it('human typing inside agent text is not attributed to the agent',async()=>{
 const editor=await open('<p><span data-lanza-origin="agent">Agent text</span></p>');
 editor.view.someProp('handleTextInput',handler=>handler(editor.view,6,6,'human ',()=>editor.state.tr));
 const html=editor.getHTML();expect(html).toContain('</span>human <span');
});
it('plain formatting changes do not create provenance',async()=>{
 const editor=await open('<p>Original words</p>');prepareBodyProposal(editor,'body','<p>Original <strong>words</strong></p>').apply();expect(editor.getHTML()).not.toContain('data-lanza-origin');
});
