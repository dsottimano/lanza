import { agentFlags, segments } from '../../../frontend/lib/provenance/text.mjs';

export function markAgentHtml(before: string, after: string): string {
  const collect = (html:string) => {
    const template = document.createElement('template'); template.innerHTML = html;
    const leaves:{node:Text;start:number}[] = []; const flags:boolean[] = []; let text="";
    function walk(node:Node, agent=false) {
      if (node instanceof Element) {
        if (['SCRIPT','STYLE'].includes(node.tagName)) return;
        agent ||= node.getAttribute('data-lanza-origin') === 'agent';
      }
      if (node.nodeType === Node.TEXT_NODE) { leaves.push({node:node as Text,start:text.length});text+=node.textContent ?? '';flags.push(...Array((node.textContent ?? '').length).fill(agent)); }
      for (const child of node.childNodes) walk(child,agent);
      if (node instanceof Element && /^(P|H[1-6]|LI|BLOCKQUOTE|PRE|TD|TH|FIGCAPTION|DIV)$/.test(node.tagName)) {text+="\n";flags.push(false);}
    }
    walk(template.content); return {template,leaves,flags,text};
  };
  const previous = collect(before), next = collect(after);
  const flags = agentFlags(previous.text,next.text,previous.flags);
  for (const {node,start:offset} of next.leaves) {
    const local=flags.slice(offset,offset+node.length).map((f:boolean,i:number)=>f || next.flags[offset+i]);
    if (!local.some(Boolean)) continue;
    if (node.parentElement?.matches('pre > code')) { node.parentElement.parentElement!.setAttribute('data-lanza-origin','agent'); continue; }
    const replacement=document.createDocumentFragment();
    for(const segment of segments(node.data,local)) {
      if(segment.agent && segment.text.trim()) { const span=document.createElement('span');span.dataset.lanzaOrigin='agent';span.textContent=segment.text;replacement.append(span); }
      else replacement.append(document.createTextNode(segment.text));
    }
    node.replaceWith(replacement);
  }
  return next.template.innerHTML;
}
