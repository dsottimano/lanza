import { Plugin } from '@tiptap/pm/state';
import { Mark, Extension } from '@tiptap/core';
export const AgentOrigin = Mark.create({
  name: 'agentOrigin', inclusive: false,
  parseHTML: () => [{ tag: 'span[data-lanza-origin="agent"]' }],
  addProseMirrorPlugins() {
    return [new Plugin({props:{handleTextInput:(view,from,to,text)=>{
      const mark = view.state.schema.marks.agentOrigin;
      const transaction = view.state.tr.insertText(text,from,to).removeMark(from,from+text.length,mark);
      view.dispatch(transaction); return true;
    }}})];
  },
  renderHTML: () => ['span', { 'data-lanza-origin': 'agent', title: 'Agent-written text' }, 0],
});
export const AgentCodeOrigin = Extension.create({
  name: 'agentCodeOrigin',
  addGlobalAttributes() { return [{ types:['codeBlock'], attributes:{ agentOrigin:{
    default:null,
    parseHTML:(element:HTMLElement)=>element.getAttribute('data-lanza-origin') === 'agent' ? 'agent' : null,
    renderHTML:(attributes:Record<string,unknown>)=>attributes.agentOrigin === 'agent' ? {'data-lanza-origin':'agent'} : {},
  }}}]; },
});
