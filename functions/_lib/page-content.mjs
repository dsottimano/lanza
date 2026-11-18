// Page-content rules shared by check:site (scripts/check-content.mjs) and MCP content
// writes (functions/_lib/mcp-core.ts). validate_site cannot afford to read every page,
// so MCP refuses at write time exactly what the build would refuse. No dependencies.

export const PRESET_NAME = /^[a-zA-Z0-9_-]+$/;

const error = (where, code, message) => ({ level: "error", where, code, message });

/** Stored slot values against the template's declared fields. */
export function slotProblems(value, fields, where) {
  const problems = [];
  const walk = (value, fields, where) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      problems.push(error(where, "invalid-slots", "Template content must be an object."));
      return;
    }
    for (const [name, entry] of Object.entries(value)) {
      const field = fields.find((f) => f.name === name);
      if (!field) { problems.push(error(`${where}.${name}`, "undeclared-content-field", "No template field declares this value; the CMS cannot edit it.")); continue; }
      if (entry == null) continue;
      if (field.widget === "object") walk(entry, field.fields ?? [], `${where}.${name}`);
      if (field.widget === "list" && field.fields) {
        if (!Array.isArray(entry)) problems.push(error(`${where}.${name}`, "invalid-slots", "List content must be an array."));
        else entry.forEach((item, i) => walk(item, field.fields, `${where}.${name}.${i}`));
      }
    }
  };
  walk(value, fields, where);
  return problems;
}

/**
 * A page entry's preset against its template. `fieldsJson` is the parsed fields.json,
 * or null when the template folder lacks fields.json or template.html.
 */
export function presetProblems(data, fieldsJson, where) {
  if (!data.preset) return [];
  if (typeof data.preset !== "string" || !PRESET_NAME.test(data.preset)) {
    return [error(where, "invalid-preset", "Preset must name a template folder.")];
  }
  if (!fieldsJson) return [error(where, "content-template-missing", `Template ${data.preset} needs fields.json and template.html.`)];
  const problems = [];
  if (fieldsJson.body === true) {
    problems.push(error(where, "page-body", `Template ${data.preset} sets "body": true, but a page preset is a designed page with no free body. Use a richtext field instead.`));
  }
  problems.push(...slotProblems(data.slots ?? {}, fieldsJson.fields ?? [], `${where}:slots`));
  return problems;
}
