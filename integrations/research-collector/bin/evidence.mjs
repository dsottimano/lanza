import { createHash } from 'node:crypto';
import { createEvidenceEngine } from '../../../functions/_lib/research-evidence.mjs';
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const { validateManifest, htmlText, pointer, extractFact, refresh, report, articleBlock, applyArticle } = createEvidenceEngine(hash);
