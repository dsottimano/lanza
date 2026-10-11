// Shared deterministic engine. Hash is injected: Node CLI or Workers Web Crypto.
import { parse } from 'parse5';
export function createEvidenceEngine(hash) {
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
function validateManifest(manifest) {
  if (manifest.version !== 1 || !id(manifest.article?.id) || typeof manifest.article.contentPath !== 'string' ||
      !/^content\/posts\/[a-z-]+\/[a-z0-9-]+\.md$/.test(manifest.article.contentPath) ||
      !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(manifest.repository || '') ||
      !Array.isArray(manifest.sources) || manifest.sources.length > 20 || !Array.isArray(manifest.facts)) throw new Error('invalid_manifest');
  const ids = new Set();
  for (const source of manifest.sources) {
    if (!id(source.id) || ids.has(source.id) || !['html','json','text','pdf'].includes(source.format)) throw new Error('invalid_source');
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
        !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(url.hostname) || /\.(?:local|internal|localhost|test|invalid)$/.test(url.hostname)) throw new Error('invalid_source_url');
    if (source.format === 'html' && source.selector && !/^(?:[a-z][a-z0-9-]*|#[a-zA-Z][\w-]*|\.[a-zA-Z][\w-]*)$/.test(source.selector)) throw new Error('invalid_selector');
    ids.add(source.id);
  }
  const facts = new Set();
  for (const fact of manifest.facts) {
    if (!id(fact.id) || facts.has(fact.id)) throw new Error('invalid_fact');
    if (fact.calculate) {
      if (!['multiply','divide','add','subtract'].includes(fact.calculate.operation) || !Array.isArray(fact.calculate.inputs) || fact.calculate.inputs.length !== 2 ||
          fact.calculate.inputs.some(input => typeof input !== 'number' && !facts.has(input)) ||
          (fact.calculate.digits !== undefined && (!Number.isInteger(fact.calculate.digits) || fact.calculate.digits < 0 || fact.calculate.digits > 12))) throw new Error('invalid_calculation');
    } else if (!ids.has(fact.sourceId) || !['text-match','json-pointer','json-count'].includes(fact.extract?.type)) throw new Error('invalid_fact_extraction');
    facts.add(fact.id);
  }
  return manifest;
}
function htmlText(html, selector = 'body') {
  const parts = [];
  function walk(node, selected = false) {
    if (['script','style','noscript','template','svg','nav','footer'].includes(node.tagName)) return;
    const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name,a.value]));
    const matches = selector.startsWith('#') ? attrs.id === selector.slice(1) : selector.startsWith('.') ? (attrs.class || '').split(/\s+/).includes(selector.slice(1)) : node.tagName === selector;
    selected ||= matches;
    if (selected && node.nodeName === '#text') parts.push(node.value);
    const block = selected && /^(?:h[1-6]|p|div|section|article|li|br|tr|td)$/.test(node.tagName || '');
    if (block) parts.push('\n');
    for (const child of node.childNodes || []) walk(child, selected);
    if (block) parts.push('\n');
  }
  walk(parse(html));
  const text = parts.join('').replace(/[\t ]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
  if (!text) throw new Error('empty_extraction');
  return text;
}
function pointer(value, path) {
  if (path === '') return value;
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('invalid_json_pointer');
  for (const key of path.slice(1).split('/').map(s => s.replace(/~1/g,'/').replace(/~0/g,'~'))) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value,key)) throw new Error('missing_json_value');
    value = value[key];
  }
  return value;
}
function extractFact(fact, snapshot) {
  const rule = fact.extract;
  if (rule.type === 'json-pointer') {
    let document = JSON.parse(snapshot.text);
    if (rule.select) {
      const candidates = pointer(document,rule.select.pointer);
      if (!Array.isArray(candidates)) throw new Error('selection_not_array');
      const matches = candidates.filter(item => pointer(item,rule.select.key) === rule.select.value);
      if (matches.length !== 1) throw new Error('selection_not_unique');
      document = matches[0];
    }
    const value = pointer(document, rule.pointer);
    if (!['string','number','boolean'].includes(typeof value)) throw new Error('non_scalar_fact');
    if (rule.transform === 'epoch-ms-iso') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('invalid_epoch');
      return new Date(value).toISOString();
    }
    return value;
  }
  if (rule.type === 'json-count') {
    const values = pointer(JSON.parse(snapshot.text), rule.pointer);
    if (!Array.isArray(values)) throw new Error('expected_array');
    if (!rule.filter) return values.length;
    const { pointer: path, operation, value } = rule.filter;
    if (!['gte','lte','eq'].includes(operation)) throw new Error('invalid_filter');
    return values.filter(item => {
      const actual = pointer(item,path);
      if (operation === 'eq') return actual === value;
      if (typeof actual !== 'number' || typeof value !== 'number') throw new Error('non_numeric_filter');
      return operation === 'gte' ? actual >= value : actual <= value;
    }).length;
  }
  if (typeof rule.pattern !== 'string' || rule.pattern.length > 2000) throw new Error('invalid_pattern');
  const matches = [...snapshot.text.matchAll(new RegExp(rule.pattern,'gu'))];
  if (matches.length !== 1) throw new Error(matches.length ? 'ambiguous_match' : 'missing_match');
  const value = matches[0][rule.group ?? 0];
  if (value === undefined) throw new Error('missing_group');
  if (!rule.numeric) return value.trim();
  const number = Number(value.replace(/,/g,''));
  if (!Number.isFinite(number)) throw new Error('non_numeric_fact');
  return number;
}
async function refresh(manifestInput, previous, fetchSnapshot, now = new Date().toISOString()) {
  const manifest = validateManifest(manifestInput);
  const sourceStates = {};
  for (const source of manifest.sources) {
    const configHash = await hash(source);
    try {
      const snapshot = await fetchSnapshot(source);
      if (!snapshot.text.trim()) throw new Error('empty_extraction');
      if (source.requiredText?.some(text => !snapshot.text.toLocaleLowerCase('en-US').includes(text.toLocaleLowerCase('en-US')))) throw new Error('source_validation_failed');
      const textHash = await hash(snapshot.text);
      const previousTextHash = previous?.sources?.[source.id]?.configHash === configHash ? previous.sources[source.id].textHash || null : null;
      sourceStates[source.id] = { ...snapshot, id: source.id, url: source.url, configHash, textHash, previousTextHash, changed: previousTextHash !== textHash, fetchedAt: now, status: 'current' };
    } catch (error) {
      const old = previous?.sources?.[source.id];
      // A changed URL/parser cannot borrow evidence from the old source definition.
      sourceStates[source.id] = old?.configHash === configHash ? { ...old, status: 'stale', error: error.code || error.message || 'fetch_failed', attemptedAt: now } : { id: source.id, url: source.url, configHash, status: 'unavailable', error: error.code || error.message || 'fetch_failed', attemptedAt: now };
    }
  }
  const facts = {};
  for (const fact of manifest.facts) {
    const definitionHash = await hash(fact);
    let status = 'current'; let sourceIds = []; let value;
    try {
      if (fact.calculate) {
        const inputFacts = fact.calculate.inputs.filter(v => typeof v === 'string').map(v => facts[v]);
        if (inputFacts.some(f => !f || f.status === 'unavailable')) throw new Error('input_unavailable');
        if (inputFacts.some(f => f.status === 'stale')) status = 'stale';
        sourceIds = [...new Set(inputFacts.flatMap(f => f.sourceIds))].sort();
        const [a,b] = fact.calculate.inputs.map(input => typeof input === 'number' ? input : facts[input].value);
        if (typeof a !== 'number' || typeof b !== 'number') throw new Error('non_numeric_input');
        value = { multiply: () => a*b, divide: () => a/b, add: () => a+b, subtract: () => a-b }[fact.calculate.operation]();
        if (!Number.isFinite(value)) throw new Error('invalid_calculation_result');
        if (fact.calculate.digits !== undefined) value = Number(value.toFixed(fact.calculate.digits));
      } else {
        const snapshot = sourceStates[fact.sourceId]; sourceIds = [fact.sourceId];
        if (!snapshot.text) throw new Error('source_unavailable');
        status = snapshot.status;
        value = extractFact(fact,snapshot);
      }
      const provenance = fact.calculate
        ? [...new Map(fact.calculate.inputs.filter(v => typeof v === 'string').flatMap(v => facts[v].provenance).map(p => [p.id + p.textHash,p])).values()]
        : sourceIds.map(sourceId => { const { id,url,textHash,rawHash,fetchedAt,configHash } = sourceStates[sourceId]; return { id,url,textHash,rawHash,fetchedAt,configHash }; });
      facts[fact.id] = { id: fact.id, label: fact.label || fact.id, definitionHash, value, unit: fact.unit || null, status, sourceIds, provenance };
    } catch (error) {
      const old = previous?.facts?.[fact.id];
      const sameSources = old?.provenance?.every(p => sourceStates[p.id]?.configHash === p.configHash);
      facts[fact.id] = old?.definitionHash === definitionHash && sameSources ? { ...old, status: 'stale', error: error.message } : { id: fact.id, label: fact.label || fact.id, definitionHash, status: 'unavailable', sourceIds, provenance: [], error: error.message };
    }
  }
  const substantive = { article: manifest.article, facts: Object.values(facts).map(({id,value,unit,status,sourceIds,error}) => ({id,value,unit,status,sourceIds,error})), sources: Object.values(sourceStates).map(({id,url,textHash,status}) => ({id,url,textHash,status})) };
  return { version: 1, article: manifest.article, manifestHash: await hash(manifest), refreshedAt: now, substantiveHash: await hash(substantive), sources: sourceStates, facts };
}
function report(evidence) {
  const lines = [`# Evidence: ${evidence.article.id}`, '', `Article: \`${evidence.article.contentPath}\``, '', `Substantive hash: \`${evidence.substantiveHash}\``, '', 'Private research report. Imported evidence is unverified; no article has been edited or published.', ''];
  for (const fact of Object.values(evidence.facts)) {
    lines.push(`## ${fact.id}`, '', `${fact.label}: ${JSON.stringify(fact.value ?? null)}${fact.unit ? ` ${fact.unit}` : ''}`, '', `Status: **${fact.status}**${fact.error ? ` (${fact.error})` : ''}`, '');
    for (const source of fact.provenance || []) {
      lines.push(`Source: ${source.url}`, `Snapshot: ${source.textHash || 'unavailable'}; fetched: ${source.fetchedAt || 'never'}`, '');
    }
  }
  lines.push('## Source monitor', '');
  for (const source of Object.values(evidence.sources)) lines.push(`- ${source.id}: ${source.status}; ${source.changed ? 'changed' : 'unchanged'}${source.error ? `; ${source.error}` : ''}. ${source.url}`, '');
  return lines.join('\n');
}

const escape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function articleBlock(evidence, factIds) {
  if (!factIds?.length) throw new Error('no_generated_facts');
  const items = factIds.map(id => {
    const fact = evidence.facts[id];
    if (!fact || fact.status !== 'current') throw new Error(`fact_not_current:${id}`);
    const links = fact.provenance.map(source => `<a href="${escape(source.url)}">${escape(source.id)}</a>`).join(', ');
    return `<li><strong>${escape(fact.label)}:</strong> ${escape(fact.value)}${fact.unit ? ` ${escape(fact.unit)}` : ''}. Source: ${links}.</li>`;
  });
  return `<ul>${items.join('')}</ul>`;
}
function applyArticle(article, expectedHash, evidence, factIds) {
  if (hash(article) !== expectedHash) throw new Error('article_changed');
  const startPattern = /<h2(?:\s[^>]*)?>\s*Verified earthquake data\s*<\/h2>/g;
  const endPattern = /<h2(?:\s[^>]*)?>\s*What those numbers do(?:—|&mdash;|&#8212;)and do not(?:—|&mdash;|&#8212;)tell us\s*<\/h2>/g;
  const starts = [...article.matchAll(startPattern)]; const ends = [...article.matchAll(endPattern)];
  if (starts.length !== 1 || ends.length !== 1) throw new Error('article_boundaries_not_unique');
  const from = starts[0].index + starts[0][0].length; const to = ends[0].index;
  if (from >= to) throw new Error('article_boundaries_out_of_order');
  return article.slice(0,from) + '\n' + articleBlock(evidence,factIds) + '\n' + article.slice(to);
}

return { hash, validateManifest, htmlText, pointer, extractFact, refresh, report, articleBlock, applyArticle };
}
