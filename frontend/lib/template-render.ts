// Minimal HTML TEMPLATE ENGINE — renders author-written HTML templates with page
// data at Astro build time. A Handlebars-ish subset ({{var}}, {{a.b}}, {{#each}},
// {{#if}}, plus loop vars @index/@number), zero dependencies (Dave's stdlib-first
// rule), no partials/helpers/comments/else.
//
// Trust model: the TEMPLATE is author-trusted and emitted VERBATIM — a <style> or
// any markup passes through unescaped. Only interpolated VALUES are untrusted, so
// only they are HTML-escaped. (Values still land inside author-trusted markup;
// this engine escapes the value, it does not sanitize the surrounding template.)

type Scope = Record<string, unknown>;

interface Frame {
  scope: Scope; // the object whose fields resolve by bare name
  index: number; // 0-based position in the enclosing {{#each}}
}

type Node =
  | { t: "text"; v: string }
  | { t: "var"; path: string }
  | { t: "each"; path: string; body: Node[] }
  | { t: "if"; path: string; body: Node[] };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Split on {{...}} into interleaved text and tag tokens, then build the AST with a
// recursive descent driven by a cursor. Block tags ({{#each}}/{{#if}}) recurse
// until their matching {{/each}}/{{/if}}.
function tokenize(template: string): string[] {
  return template.split(/(\{\{[^}]*\}\})/);
}

function parse(tokens: string[], start: number, stop?: string): { nodes: Node[]; next: number } {
  const nodes: Node[] = [];
  let i = start;
  while (i < tokens.length) {
    const tok = tokens[i];
    const m = /^\{\{\s*(.*?)\s*\}\}$/.exec(tok);
    if (!m) {
      if (tok) nodes.push({ t: "text", v: tok });
      i++;
      continue;
    }
    const inner = m[1];
    if (stop && inner.replace(/\s+/g, "") === stop) {
      return { nodes, next: i + 1 };
    }
    const each = /^#each\s+(.+)$/.exec(inner);
    const iff = /^#if\s+(.+)$/.exec(inner);
    if (each) {
      const parsed = parse(tokens, i + 1, "/each");
      nodes.push({ t: "each", path: each[1].trim(), body: parsed.nodes });
      i = parsed.next;
    } else if (iff) {
      const parsed = parse(tokens, i + 1, "/if");
      nodes.push({ t: "if", path: iff[1].trim(), body: parsed.nodes });
      i = parsed.next;
    } else {
      nodes.push({ t: "var", path: inner });
      i++;
    }
  }
  return { nodes, next: i };
}

// Resolve a bare name from the top frame downward (first frame that owns the key
// wins); @index/@number come from loop metadata, not data. Dotted paths walk into
// the resolved root.
function resolve(path: string, stack: Frame[]): unknown {
  const top = stack[stack.length - 1];
  if (path === "@index") return top ? top.index : undefined;
  if (path === "@number") return top ? String(top.index + 1).padStart(2, "0") : undefined;
  const parts = path.split(".");
  const head = parts[0];
  let value: unknown;
  let found = false;
  for (let i = stack.length - 1; i >= 0; i--) {
    const scope = stack[i].scope;
    if (scope != null && typeof scope === "object" && head in (scope as Scope)) {
      value = (scope as Scope)[head];
      found = true;
      break;
    }
  }
  if (!found) return undefined;
  for (let i = 1; i < parts.length; i++) {
    if (value == null || typeof value !== "object") return undefined;
    value = (value as Scope)[parts[i]];
  }
  return value;
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return ""; // don't print [object Object] / arrays
  return escapeHtml(String(v));
}

function renderNodes(nodes: Node[], stack: Frame[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.t === "text") {
      out += node.v;
    } else if (node.t === "var") {
      out += stringify(resolve(node.path, stack));
    } else if (node.t === "if") {
      if (truthy(resolve(node.path, stack))) out += renderNodes(node.body, stack);
    } else {
      const items = resolve(node.path, stack);
      if (Array.isArray(items)) {
        items.forEach((item, index) => {
          stack.push({ scope: item as Scope, index });
          out += renderNodes(node.body, stack);
          stack.pop();
        });
      }
    }
  }
  return out;
}

export function render(template: string, data: Record<string, unknown>): string {
  const { nodes } = parse(tokenize(template), 0);
  return renderNodes(nodes, [{ scope: data, index: 0 }]);
}
