import { diffWordsWithSpace } from 'diff';
export const ORIGIN_ATTRIBUTE = 'data-lanza-origin';
export const escapeText = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Origin declarations, not identity verification. Equal text keeps its previous
// origin; only additions from an agent operation acquire the agent marker.
export function agentFlags(before, after, previousFlags = [], additionsAreAgent = true) {
  const changes = diffWordsWithSpace(before, after, { maxEditLength: 4000, timeout: 100 });
  if (!changes) throw new Error('The text change is too large to attribute safely. Submit smaller changes.');
  let oldOffset = 0;
  const flags = [];
  for (const change of changes) {
    if (change.removed) { oldOffset += change.value.length; continue; }
    for (let i = 0; i < change.value.length; i++) flags.push(change.added ? additionsAreAgent : !!previousFlags[oldOffset + i]);
    if (!change.added) oldOffset += change.value.length;
  }
  return flags;
}

export function segments(text, flags) {
  const result = [];
  for (let start = 0; start < text.length;) {
    const agent = !!flags[start]; let end = start + 1;
    while (end < text.length && !!flags[end] === agent) end++;
    result.push({ text: text.slice(start, end), agent }); start = end;
  }
  return result;
}
export function markedText(text, flags) {
  return segments(text, flags).map(s => s.agent && s.text.trim()
    ? '<span data-lanza-origin="agent">' + escapeText(s.text) + '</span>' : escapeText(s.text)).join('');
}
const own = (o,k) => Object.prototype.hasOwnProperty.call(o ?? {}, k);
const blocked = new Set(['__proto__','constructor','prototype','lanzaProvenance']);
export function fieldRecords(data) {
  const source = data?.lanzaProvenance;
  return source?.version === 1 && source.fields && typeof source.fields === 'object' ? source.fields : {};
}
export function recordAgentFields(before, after) {
  const fields = Object.create(null);
  const existing = fieldRecords(before);
  function walk(value, previous, path = '') {
    if (typeof value === 'string') {
      if (value !== previous) fields[path] = { origin: 'agent', text: value };
      else if (own(existing,path) && existing[path]?.origin === 'agent' && typeof existing[path].text === 'string') fields[path] = existing[path];
    } else if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) if (!blocked.has(key)) walk(value[key], previous?.[key], path ? path+'.'+key : key);
    }
  }
  walk(after,before);
  return { version: 1, fields };
}
export function fieldAgentHtml(data, path, value) {
  const record = fieldRecords(data)[path];
  if (!record || record.origin !== 'agent' || typeof record.text !== 'string') return escapeText(value ?? '');
  const text = String(value ?? '');
  return markedText(text, agentFlags(record.text, text, Array(record.text.length).fill(true), false));
}

export function scopedProvenance(data, prefix) {
  return {version:1,fields:Object.fromEntries(Object.entries(fieldRecords(data)).filter(([path])=>path.startsWith(prefix)).map(([path,value])=>[path.slice(prefix.length),value]))};
}
