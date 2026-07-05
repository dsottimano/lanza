// Splits a header/footer part's HTML into ordered SECTIONS for the visual builder,
// and joins them back. The one invariant everything rests on: parse PARTITIONS the
// source — every character lands in exactly one section, in order — so
// serialize(parse(html)) === html, always (see parts-sections.test.ts). Recognition
// only LABELS spans so the UI can show a friendly card for the ones it understands
// (menu / brand / language switcher); anything else is a verbatim `raw` block. A
// construct we fail to recognize just stays raw — it never corrupts the markup.
//
// Because the recognized constructs are data-backed (the menu loop renders
// data/menu.json, the switcher renders the locale list), editing them friendly-side
// doesn't touch the HTML at all — their span stays verbatim. Only `raw` blocks and
// reordering change a part's source, and the live preview shows the result before save.

export type SectionKind = "brand" | "menu" | "switcher" | "raw";

export interface Section {
  id: number;
  kind: SectionKind;
  source: string; // the verbatim HTML span
  // menu only — which location's loop this is, so the friendly editor binds the
  // right list. Header parts use menuHeader, footers menuFooter.
  location?: "header" | "footer";
}

let nextId = 1;
function makeId(): number {
  return nextId++;
}

// A recognized construct found at a position: its char range and kind.
interface Match {
  start: number;
  end: number;
  kind: SectionKind;
  location?: "header" | "footer";
}

// Walk a template block from the token that opens it (openRe, e.g. `{{#if`) to its
// balanced close (`{{/if}}`), counting nested opens so an inner block doesn't close
// the outer one early. Returns the index just past the close, or -1 if unbalanced.
function balancedTemplateEnd(html: string, from: number, openRe: RegExp, close: string): number {
  let depth = 0;
  let i = from;
  const openLen = 2; // "{{"
  while (i < html.length) {
    if (html.startsWith(close, i)) {
      depth--;
      i += close.length;
      if (depth === 0) return i;
      continue;
    }
    openRe.lastIndex = i;
    const m = openRe.exec(html);
    if (m && m.index === i) {
      depth++;
      i += openLen;
      continue;
    }
    i++;
  }
  return -1;
}

// Balanced <a>…</a> from the `<a` at `from` (brand has no nested anchors, but count
// anyway so a future nested one can't truncate the span).
function balancedAnchorEnd(html: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < html.length) {
    if (/^<a[\s>]/.test(html.slice(i, i + 3))) {
      depth++;
      i += 2;
      continue;
    }
    if (html.startsWith("</a>", i)) {
      depth--;
      i += 4;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return -1;
}

const IF_OPEN = /\{\{#if\b/g;
const EACH_OPEN = /\{\{#each\b/g;

// Does a recognized construct start exactly at `i`? Return its match, else null.
function matchAt(html: string, i: number): Match | null {
  // Language switcher: {{#if showSwitcher}} … {{/if}} (nested ifs balanced).
  if (/^\{\{#if\s+showSwitcher\s*\}\}/.test(html.slice(i, i + 40))) {
    const end = balancedTemplateEnd(html, i, IF_OPEN, "{{/if}}");
    if (end !== -1) return { start: i, end, kind: "switcher" };
  }
  // Menu loop: {{#each menuHeader}} … {{/each}} (or menuFooter).
  const each = /^\{\{#each\s+(menuHeader|menuFooter)\s*\}\}/.exec(html.slice(i, i + 40));
  if (each) {
    const end = balancedTemplateEnd(html, i, EACH_OPEN, "{{/each}}");
    if (end !== -1) {
      return { start: i, end, kind: "menu", location: each[1] === "menuFooter" ? "footer" : "header" };
    }
  }
  // Brand link: <a … class="brand" …> … </a>.
  if (/^<a\b[^>]*\bclass="brand"/.test(html.slice(i, i + 200))) {
    const end = balancedAnchorEnd(html, i);
    if (end !== -1) return { start: i, end, kind: "brand" };
  }
  return null;
}

/** Partition a part's HTML into ordered sections. Lossless: see serializeSections. */
export function parseSections(html: string): Section[] {
  const sections: Section[] = [];
  let rawStart = 0;
  let i = 0;
  const flushRaw = (upto: number) => {
    if (upto > rawStart) {
      sections.push({ id: makeId(), kind: "raw", source: html.slice(rawStart, upto) });
    }
  };
  while (i < html.length) {
    const m = matchAt(html, i);
    if (m) {
      flushRaw(m.start);
      sections.push({ id: makeId(), kind: m.kind, source: html.slice(m.start, m.end), location: m.location });
      i = m.end;
      rawStart = i;
    } else {
      i++;
    }
  }
  flushRaw(html.length);
  return sections;
}

/** Join sections back to HTML. serializeSections(parseSections(x)) === x. */
export function serializeSections(sections: Section[]): string {
  return sections.map((s) => s.source).join("");
}

/** A fresh custom HTML block for the "+ Add HTML block" action. */
export function newRawSection(source = "<div></div>"): Section {
  return { id: makeId(), kind: "raw", source };
}
