// Reads the tenant's HTML templates from the repo so the CMS can offer a template
// picker + a fields editor. Templates live at the TENANT REPO ROOT `templates/<name>/`
// (agent-authored, hand-editable HTML/CSS that survives @lanza/site updates — see
// docs/authoring-templates.md), NOT in the package. The frontend renders them at
// build via frontend/components/HtmlTemplate.astro + frontend/lib/template-render.ts;
// here we surface each one's editable-field schema (fields.json) to the editor.
//
// A template dir's NAME is its `preset` value (matches the render-side glob
// `/templates/<name>/template.html`). fields.json mirrors the CMS Field shape, so
// its `fields` feed straight into FieldForm.
import type { GitHubClient } from "./github";
import type { Field } from "../schema";

export const TEMPLATES_ROOT = "templates";

export interface TemplateInfo {
  name: string; // dir name === the page's `preset`
  label: string;
  description?: string;
  fields: Field[]; // the editable slots, in CMS Field shape
  // Whether the template renders the page's rich body ({{ body }}). Default false:
  // a template owns its whole layout via slots, so the writing canvas is dead
  // real estate and the editor hides it. Set `"body": true` in fields.json only
  // when the template embeds {{ body }} (see docs/authoring-templates.md).
  body: boolean;
}

/** The repo path of a template's HTML file. */
export function templateHtmlPath(name: string): string {
  return `${TEMPLATES_ROOT}/${name}/template.html`;
}

/**
 * List the tenant's templates (one per `templates/<name>/` dir with a readable
 * fields.json). Dirs missing/with an invalid fields.json are skipped rather than
 * breaking the picker. Sorted by label.
 */
export async function listTemplates(client: GitHubClient): Promise<TemplateInfo[]> {
  const dirs = await client.listSubdirs(TEMPLATES_ROOT);
  const out: TemplateInfo[] = [];
  for (const d of dirs) {
    try {
      const { data } = await client.loadJson(`${TEMPLATES_ROOT}/${d.name}/fields.json`);
      out.push({
        name: d.name,
        label: (data.label as string) || d.name,
        description: data.description as string | undefined,
        fields: Array.isArray(data.fields) ? (data.fields as Field[]) : [],
        body: data.body === true,
      });
    } catch {
      // No/invalid fields.json — not a usable template; skip it.
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
