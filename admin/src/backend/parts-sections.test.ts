import { describe, it, expect } from "vitest";
import { parseSections, serializeSections, newRawSection } from "./parts-sections";
// The REAL tenant parts — the visual builder must round-trip these byte-for-byte.
import headerHtml from "../../../templates/parts/header.html?raw";
import footerHtml from "../../../templates/parts/footer.html?raw";

const kinds = (html: string) => parseSections(html).map((s) => s.kind);

describe("parts-sections", () => {
  // The load-bearing invariant: no save can corrupt a part's markup.
  it("round-trips the real header byte-for-byte", () => {
    expect(serializeSections(parseSections(headerHtml))).toBe(headerHtml);
  });
  it("round-trips the real footer byte-for-byte", () => {
    expect(serializeSections(parseSections(footerHtml))).toBe(footerHtml);
  });

  it("recognizes brand, menu and switcher in the header", () => {
    const k = kinds(headerHtml);
    expect(k).toContain("brand");
    expect(k).toContain("menu");
    expect(k).toContain("switcher");
  });

  it("recognizes the footer menu (menuFooter)", () => {
    const secs = parseSections(footerHtml);
    const menu = secs.find((s) => s.kind === "menu");
    expect(menu?.location).toBe("footer");
  });

  it("does not close the switcher early on its nested {{#if}}s", () => {
    const secs = parseSections(headerHtml);
    const sw = secs.find((s) => s.kind === "switcher");
    // The whole block, nested ifs and the locale loop included, is one section.
    expect(sw?.source).toContain("{{#each locales}}");
    expect(sw?.source.endsWith("{{/if}}")).toBe(true);
  });

  it("keeps an unrecognized construct as a lossless raw block", () => {
    const html = `<div>{{#if somethingElse}}<b>x</b>{{/if}}</div>`;
    expect(serializeSections(parseSections(html))).toBe(html);
    expect(kinds(html)).toEqual(["raw"]); // no friendly card, but never dropped
  });

  it("round-trips synthetic ordering: raw · brand · menu · raw", () => {
    const html = `<header><a class="brand" href="/">Logo</a><nav>{{#each menuHeader}}<a href="{{url}}">{{label}}</a>{{/each}}</nav></header>`;
    expect(serializeSections(parseSections(html))).toBe(html);
    expect(kinds(html)).toEqual(["raw", "brand", "raw", "menu", "raw"]);
  });

  it("serializes an edited raw block in place", () => {
    const secs = parseSections(`<div>a</div>{{#each menuHeader}}x{{/each}}<div>b</div>`);
    const raw = secs.find((s) => s.kind === "raw")!;
    raw.source = "<div>EDITED</div>";
    expect(serializeSections(secs)).toBe(`<div>EDITED</div>{{#each menuHeader}}x{{/each}}<div>b</div>`);
  });

  it("mints unique ids, including for new blocks", () => {
    const secs = parseSections(headerHtml);
    const added = newRawSection("<p>hi</p>");
    const ids = new Set([...secs.map((s) => s.id), added.id]);
    expect(ids.size).toBe(secs.length + 1);
  });
});
