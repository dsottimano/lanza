import { parseFragment, serialize } from 'parse5';
import { agentFlags, markedText } from '../../frontend/lib/provenance/text.mjs';

/** Server adapter. Parse HTML without executing it; sanitization remains separate. */
export function markAgentHtml(before: string, after: string): string {
  if (before === after) return before;
  const collect = (root:any) => {
    const leaves:any[] = []; const flags:boolean[] = []; let text = "";
    function walk(node:any, agent = false) {
      if (['script','style'].includes(node.tagName)) return;
      agent ||= node.attrs?.some((a:any) => a.name === 'data-lanza-origin' && a.value === 'agent');
      if (node.nodeName === '#text') { leaves.push({node,start:text.length}); text += node.value; flags.push(...Array(node.value.length).fill(agent)); }
      for (const child of node.childNodes ?? []) walk(child,agent);
      if (/^(p|h[1-6]|li|blockquote|pre|td|th|figcaption|div)$/.test(node.tagName)) {text += "\n";flags.push(false);}
    }
    walk(root); return {leaves,flags,text};
  };
  const previous = collect(parseFragment(before));
  const doc = parseFragment(after); const next = collect(doc);
  const flags = agentFlags(previous.text,next.text,previous.flags);
  for (const {node,start:offset} of next.leaves) {
    const local = flags.slice(offset,offset+node.value.length).map((f:boolean,i:number) => f || next.flags[offset+i]);
    if (!local.some(Boolean)) continue;
    // Code blocks cannot contain marks in TipTap; retain origin on their block.
    if (node.parentNode?.tagName === 'code' && node.parentNode.parentNode?.tagName === 'pre') {
      const pre = node.parentNode.parentNode;
      pre.attrs = pre.attrs.filter((a:any)=>a.name!=='data-lanza-origin');
      pre.attrs.push({name:'data-lanza-origin',value:'agent'}); continue;
    }
    const children = parseFragment(markedText(node.value,local)).childNodes;
    const parent = node.parentNode;
    parent.childNodes.splice(parent.childNodes.indexOf(node),1,...children);
    for (const child of children) child.parentNode = parent;
  }
  return serialize(doc);
}
