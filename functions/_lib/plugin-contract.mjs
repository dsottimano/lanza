// Versioned build-time contract; manifests never authorize remote executable URLs.
export const PLUGIN_API = 1;
export const pluginId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);
export function validatePlugin(m) {
  if (!m || m.apiVersion !== PLUGIN_API || !pluginId(m.id) || !/^\d+\.\d+\.\d+$/.test(m.version || '') ||
      typeof m.name !== 'string' || !m.name.trim() || m.name.length > 100 || typeof m.description !== 'string' || m.description.length > 1000 ||
      !['site','private'].includes(m.scope) || m.role !== 'owner' || !['browser','request'].includes(m.runtime)) throw new Error('Invalid or incompatible plugin manifest.');
  if (m.scope === 'site' && (m.runtime !== 'browser' || !['readingProgress','imageZoom'].includes(m.appearanceKey))) throw new Error('Unsupported site plugin adapter.');
  if (m.scope === 'private' && m.runtime !== 'request') throw new Error('Private plugins require the request runtime.');
  if (!Array.isArray(m.operations) || m.operations.some(x => !pluginId(x)) || new Set(m.operations).size !== m.operations.length || m.operations.length > 20) throw new Error('Invalid plugin operations.');
  if (!Array.isArray(m.settings) || m.settings.length > 20 || m.settings.some(f => !pluginId(f.key) || !['string','boolean','number'].includes(f.type) || typeof f.label !== 'string') || new Set(m.settings.map(f=>f.key)).size !== m.settings.length) throw new Error('Invalid plugin settings.');
  if (!['research','settings'].includes(m.workspace)) throw new Error('Unsupported plugin workspace.');
  return m;
}
export function validateSettings(manifest, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings.');
  const result = {};
  for (const key of Object.keys(input)) if (!manifest.settings.some(f=>f.key === key)) throw new Error('Unknown plugin setting.');
  for (const field of manifest.settings) {
    const value = input[field.key] ?? field.default;
    if (value === undefined && !field.required) continue;
    if (typeof value !== field.type || (field.type === 'string' && value.length > 4000) || (field.type === 'number' && !Number.isFinite(value))) throw new Error(`Invalid setting: ${field.label}`);
    result[field.key] = value;
  }
  return result;
}
