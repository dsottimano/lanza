import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import PreviewPane, {
  fieldPathMatches,
  toEntryPath,
  toMarkerPath,
  highlightSelector,
  highlightCss,
  bodyForPreview,
  selectionForClick,
  needsScroll,
} from "./PreviewPane.vue";

// The preview's job here is to map a rendered REGION back to the field that produced it.
// Two halves: the path rules (pure, tested directly — an iframe under happy-dom has a
// document but no layout, so the sharp edges have to be reachable without one) and the
// wiring that has to survive `scheduleBodyUpdate()` replacing the whole body.

describe("field paths — container matching", () => {
  it("matches a container against its descendants", () => {
    // An added or removed subtree is reported as the container that holds it, so
    // `slots` has to light up everything under it.
    expect(fieldPathMatches("slots", "slots")).toBe(true);
    expect(fieldPathMatches("slots.cards.0.heading", "slots")).toBe(true);
    expect(fieldPathMatches("slots.cards.0.heading", "slots.cards")).toBe(true);
    expect(fieldPathMatches("slots.cards.0.heading", "slots.cards.0")).toBe(true);
  });

  it("does not match a path that merely starts with the same characters", () => {
    // The `.` is the whole point: without it `slots` swallows `slotsomething`, and a
    // highlight of one field would light up an unrelated one.
    expect(fieldPathMatches("slotsomething", "slots")).toBe(false);
    expect(fieldPathMatches("slots2.a", "slots")).toBe(false);
    expect(fieldPathMatches("slots.cards2.0", "slots.cards")).toBe(false);
    expect(fieldPathMatches("slots.card", "slots.cards")).toBe(false);
  });

  it("is one-directional: a leaf does not match its own container", () => {
    expect(fieldPathMatches("slots", "slots.cards")).toBe(false);
  });
});

describe("field paths — marker ⇄ entry translation", () => {
  it("reads a marker path as a slot, and the reserved body key as itself", () => {
    // The engine's paths are relative to the render root, which is `{ ...slots, body }`
    // (frontend/components/PageArticle.astro:35) — so `heading` really means
    // `slots.heading`, and `body` is the entry's rich body, not a slot.
    expect(toEntryPath("heading")).toBe("slots.heading");
    expect(toEntryPath("cards.0.title")).toBe("slots.cards.0.title");
    expect(toEntryPath("body")).toBe("body");
  });

  it("inverts entry paths back to marker paths", () => {
    expect(toMarkerPath("slots.cards.0.title")).toBe("cards.0.title");
    expect(toMarkerPath("body")).toBe("body");
    // The whole slots container: every marker in the document.
    expect(toMarkerPath("slots")).toBe("");
  });

  it("returns null for a field this preview cannot show", () => {
    // Chrome fields live outside the template, so highlighting them must select nothing
    // rather than throw or match everything.
    for (const path of ["title", "draft", "seo.description", "slotsomething"]) {
      expect(toMarkerPath(path)).toBeNull();
    }
  });
});

describe("highlight CSS", () => {
  it("selects a field and everything under it", () => {
    expect(highlightSelector(["slots.cards.0.title"])).toBe(
      '[data-lanza-field="cards.0.title"],[data-lanza-field^="cards.0.title."]',
    );
  });

  it("selects every marker for the whole container", () => {
    expect(highlightSelector(["slots"])).toBe("[data-lanza-field]");
    // …even when other paths ride along.
    expect(highlightSelector(["slots.a", "slots"])).toBe("[data-lanza-field]");
  });

  it("combines several paths and drops the ones it cannot show", () => {
    expect(highlightSelector(["slots.a", "title", "body"])).toBe(
      '[data-lanza-field="a"],[data-lanza-field^="a."],[data-lanza-field="body"],[data-lanza-field^="body."]',
    );
  });

  it("produces no rule at all when nothing is addressable", () => {
    // An empty selector would be a syntax error in a rule and throws in querySelector,
    // so it must come back as "" and be skipped by the callers.
    expect(highlightSelector(["title"])).toBe("");
    expect(highlightSelector([])).toBe("");
    expect(highlightCss(["title"])).toBe("");
  });

  it("escapes a path before putting it in an attribute selector", () => {
    // `{{ a"b }}` is a legal placeholder, so a marker path can carry a quote.
    expect(highlightSelector(['slots.a"b'])).toContain('[data-lanza-field="a\\"b"]');
    expect(highlightSelector(["slots.a\\b"])).toContain('[data-lanza-field="a\\\\b"]');
  });

  it("emits a real rule for an addressable path", () => {
    const css = highlightCss(["slots.heading"]);
    expect(css).toContain('[data-lanza-field="heading"]');
    expect(css).toContain("background:");
  });
});

describe("the body marker", () => {
  it("wraps the body only when the template emits it verbatim", () => {
    // {{{ body }}} is emitted as-is, so the wrapper arrives as markup…
    expect(bodyForPreview("<p>hi</p>", "<article>{{{ body }}}</article>")).toBe(
      '<div data-lanza-field="body"><p>hi</p></div>',
    );
    expect(bodyForPreview("<p>hi</p>", "<article>{{{body}}}</article>")).toContain('data-lanza-field="body"');
  });

  it("leaves a {{ body }} slot alone", () => {
    // …but a double-brace `body` is an ordinary escaped field (real templates use it as
    // a card's text — templates/manifesto/template.html:398). Wrapping it would print
    // the div as visible text on the page.
    expect(bodyForPreview("<p>hi</p>", "<p>{{ body }}</p>")).toBe("<p>hi</p>");
    expect(bodyForPreview("<p>hi</p>", "<p>no placeholder</p>")).toBe("<p>hi</p>");
  });
});

describe("what a click means", () => {
  // Tested on plain elements because happy-dom will not deliver a click from inside an
  // <a href> to a delegated listener — and a marker inside a link (a CTA, a menu item)
  // is exactly the case that must work.
  function fixture(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
  }

  it("selects the field a marker inside a link belongs to", () => {
    const host = fixture(`<a href="/x"><span data-lanza-field="cta">Start</span></a>`);
    expect(selectionForClick(host.querySelector("span"))).toBe("slots.cta");
    // Clicking the link itself, outside the marker, still finds nothing to select.
    expect(selectionForClick(host.querySelector("a"))).toBeNull();
  });

  it("walks up from whatever was actually clicked", () => {
    const host = fixture(`<span data-lanza-field="heading"><em><b>deep</b></em></span>`);
    expect(selectionForClick(host.querySelector("b"))).toBe("slots.heading");
  });

  it("picks the innermost marker when they nest", () => {
    const host = fixture(`<div data-lanza-field="body"><span data-lanza-field="cards.0.title">A</span></div>`);
    expect(selectionForClick(host.querySelector("span"))).toBe("slots.cards.0.title");
    expect(selectionForClick(host.querySelector("div"))).toBe("body");
  });

  it("is null for a miss, and never throws on a non-element target", () => {
    expect(selectionForClick(fixture("<p>plain</p>").querySelector("p"))).toBeNull();
    expect(selectionForClick(null)).toBeNull();
    expect(selectionForClick(document.createTextNode("t") as unknown as EventTarget)).toBeNull();
  });
});

// ── The component ───────────────────────────────────────────────────────────

const TEMPLATE = `<main><h1>{{heading}}</h1>{{#each cards}}<p>{{title}}</p>{{/each}}<article>{{{ body }}}</article></main>`;

function clientWith(template = TEMPLATE) {
  return {
    loadText: async (path: string) =>
      path.endsWith("template.html") ? { text: template, sha: "t" } : { text: ":root{--ink:#000}", sha: "c" },
  } as never;
}

async function mountPane(props: Record<string, unknown> = {}) {
  const w = mount(PreviewPane, {
    props: {
      client: clientWith(),
      preset: "manifesto",
      slots: { heading: "Own your site", cards: [{ title: "A" }, { title: "B" }] },
      ...props,
    },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

/** The pane plus its painted frame document. happy-dom does load a srcdoc frame. */
async function paintedPane(props: Record<string, unknown> = {}) {
  const w = await mountPane(props);
  await new Promise((r) => setTimeout(r, 60)); // let the frame's load event fire
  const doc = (w.find("iframe").element as HTMLIFrameElement).contentDocument;
  if (!doc) throw new Error("frame never painted");
  return { w, doc };
}

/** Click as a user would: a cancelable, bubbling event, so preventDefault is visible. */
function clickIn(doc: Document, selector: string): { hit: boolean; defaultPrevented: boolean } {
  const el = doc.querySelector(selector);
  if (!el) return { hit: false, defaultPrevented: false };
  const ev = new (doc.defaultView as Window & typeof globalThis).MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(ev);
  return { hit: true, defaultPrevented: ev.defaultPrevented };
}

const api = (w: { vm: unknown }) =>
  w.vm as unknown as {
    highlight: (p: readonly string[]) => void;
    clearHighlights: () => void;
    scrollToField: (p: string) => boolean;
  };

const styleText = (doc: Document) => doc.getElementById("lz-preview-highlight")?.textContent ?? "";

describe("PreviewPane — the marked document", () => {
  it("renders the template with markers on", async () => {
    const w = await mountPane();
    const doc = w.find("iframe").attributes("srcdoc") ?? "";
    expect(doc).toContain('<span data-lanza-field="heading">Own your site</span>');
    // Repeated slots are addressable per item.
    expect(doc).toContain('<span data-lanza-field="cards.0.title">A</span>');
    expect(doc).toContain('<span data-lanza-field="cards.1.title">B</span>');
  });

  it("carries the highlight stylesheet in the document head", async () => {
    // In the head, not on the spans: the body swap below replaces every span.
    const w = await mountPane();
    const doc = w.find("iframe").attributes("srcdoc") ?? "";
    expect(doc).toContain('<style id="lz-preview-highlight">');
    expect(doc).toContain("[data-lanza-field]{cursor:pointer}");
  });

  it("wraps the body when one is supplied, and renders none when it is not", async () => {
    const withBody = await mountPane({ body: "<p>prose</p>" });
    expect(withBody.find("iframe").attributes("srcdoc")).toContain(
      '<div data-lanza-field="body"><p>prose</p></div>',
    );
    // No body prop → the article is empty, exactly as this pane behaved before.
    const without = await mountPane();
    expect(without.find("iframe").attributes("srcdoc")).toContain("<article></article>");
  });

  it("wraps a body value in the painted document", async () => {
    const { doc } = await paintedPane({ body: "<p>prose</p>" });
    const wrapper = doc.querySelector('[data-lanza-field="body"]');
    expect(wrapper?.innerHTML).toBe("<p>prose</p>");
  });
});

describe("PreviewPane — clicking a region selects its field", () => {
  it("emits the entry path of the innermost marker", async () => {
    const { w, doc } = await paintedPane();
    expect(clickIn(doc, '[data-lanza-field="heading"]').hit).toBe(true);
    // The marker path is render-root-relative; what the parent gets is an entry path.
    expect(w.emitted("select")).toEqual([["slots.heading"]]);
  });

  it("addresses a repeated slot by index", async () => {
    const { w, doc } = await paintedPane();
    clickIn(doc, '[data-lanza-field="cards.1.title"]');
    expect(w.emitted("select")).toEqual([["slots.cards.1.title"]]);
  });

  it("says nothing when the click misses every marker", async () => {
    const { w, doc } = await paintedPane();
    clickIn(doc, "main");
    expect(w.emitted("select")).toBeUndefined();
  });

  it("cancels the click, so a marker inside a link cannot navigate the preview away", async () => {
    // <base target="_blank"> means an un-prevented click opens a tab on the way to
    // selecting the field. The handler cancels EVERY click it acts on, which is what
    // covers the anchor case: happy-dom never propagates a click from inside an <a href>
    // to a delegated listener, so the anchor half is asserted on selectionForClick below.
    const { doc } = await paintedPane();
    expect(clickIn(doc, '[data-lanza-field="heading"]').defaultPrevented).toBe(true);
  });

  it("keeps working after the body is destroyed and rebuilt", async () => {
    // THE TRAP: every keystroke replaces the body 180ms later, taking every span with
    // it. One delegated listener on <body> survives, because the body ELEMENT does.
    const { w, doc } = await paintedPane();
    await w.setProps({ slots: { heading: "Changed", cards: [{ title: "A" }, { title: "B" }] } });
    await new Promise((r) => setTimeout(r, 220));
    expect(doc.body.innerHTML).toContain("Changed");
    clickIn(doc, '[data-lanza-field="heading"]');
    expect(w.emitted("select")).toEqual([["slots.heading"]]);
  });
});

describe("PreviewPane — the exposed highlight API", () => {
  it("writes the rule into the frame's head, not onto the spans", async () => {
    const { w, doc } = await paintedPane();
    api(w).highlight(["slots.cards.0.title"]);
    expect(styleText(doc)).toContain('[data-lanza-field="cards.0.title"]');
    // The spans themselves are untouched — anything written there dies on the next swap.
    expect(doc.querySelector('[data-lanza-field="cards.0.title"]')?.className).toBe("");
  });

  it("highlights a container's descendants", async () => {
    const { w, doc } = await paintedPane();
    api(w).highlight(["slots"]);
    expect(styleText(doc)).toContain("[data-lanza-field]{background");
  });

  it("survives a body swap without being re-applied", async () => {
    const { w, doc } = await paintedPane();
    api(w).highlight(["slots.heading"]);
    await w.setProps({ slots: { heading: "Changed", cards: [] } });
    await new Promise((r) => setTimeout(r, 220));
    expect(doc.body.innerHTML).toContain("Changed"); // the swap really happened
    expect(styleText(doc)).toContain('[data-lanza-field="heading"]');
  });

  it("clears back to just the affordance", async () => {
    const { w, doc } = await paintedPane();
    api(w).highlight(["slots.heading"]);
    api(w).clearHighlights();
    expect(styleText(doc)).toBe("[data-lanza-field]{cursor:pointer}");
  });

  it("finds a field to scroll to, and reports when it cannot", async () => {
    const { w } = await paintedPane();
    expect(api(w).scrollToField("slots.cards.1.title")).toBe(true);
    expect(api(w).scrollToField("slots.nothing")).toBe(false);
    // A field this preview cannot show must select nothing rather than throw on an
    // empty selector.
    expect(api(w).scrollToField("title")).toBe(false);
  });
});

// ── Scrolling, now that FOCUS drives it ─────────────────────────────────────
// scrollToField used to fire on one deliberate trigger (clicking a change row). It now
// fires whenever the person moves between fields, which turns two previously harmless
// behaviours into constant motion: scrolling to a region that is already on screen, and
// animating it every time.

describe("needsScroll", () => {
  const H = 800; // frame height

  it("leaves a region that is already comfortably in view", () => {
    expect(needsScroll(300, 100, H)).toBe(false); // mid-frame
    expect(needsScroll(30, 100, H)).toBe(false); // near the top, inside the margin
  });

  it("scrolls to a region that is off screen", () => {
    expect(needsScroll(1200, 100, H)).toBe(true); // below the fold
    expect(needsScroll(-500, 100, H)).toBe(true); // scrolled past
  });

  it("scrolls to a region only just poking in", () => {
    // 10px of a 100px region visible at the bottom edge: technically on screen, not
    // usefully so.
    expect(needsScroll(H - 34, 100, H)).toBe(true);
    expect(needsScroll(-90, 100, H)).toBe(true);
  });

  it("counts a region taller than the frame as seen when it fills it", () => {
    // A hero that is 2000px tall can never be 60% inside an 800px frame, so it is judged
    // against the frame instead — otherwise it would scroll forever.
    expect(needsScroll(-200, 2000, H)).toBe(false);
    // …but not when only its very end is showing.
    expect(needsScroll(-1900, 2000, H)).toBe(true);
  });

  it("scrolls when the frame is too short to judge", () => {
    expect(needsScroll(0, 100, 0)).toBe(true);
    expect(needsScroll(0, 100, 40)).toBe(true);
  });
});

describe("PreviewPane — scrollToField", () => {
  /** Put a region at a known place in a frame of a known height. */
  function place(doc: Document, selector: string, top: number, height: number, viewport = 800) {
    const el = doc.querySelector(selector) as HTMLElement;
    const scrolls: unknown[] = [];
    el.getBoundingClientRect = () => ({ top, height, bottom: top + height }) as DOMRect;
    el.scrollIntoView = (arg?: unknown) => void scrolls.push(arg);
    Object.defineProperty(doc.documentElement, "clientHeight", { value: viewport, configurable: true });
    return scrolls;
  }

  it("does not scroll to a region that is already in view", async () => {
    const { w, doc } = await paintedPane();
    const scrolls = place(doc, '[data-lanza-field="heading"]', 300, 100);
    // Still true: the region EXISTS. "Found" and "moved" are different answers.
    expect(api(w).scrollToField("slots.heading")).toBe(true);
    expect(scrolls).toEqual([]);
  });

  it("scrolls to a region that is off screen", async () => {
    const { w, doc } = await paintedPane();
    const scrolls = place(doc, '[data-lanza-field="heading"]', 2400, 100);
    expect(api(w).scrollToField("slots.heading")).toBe(true);
    expect(scrolls).toHaveLength(1);
    expect(scrolls[0]).toMatchObject({ block: "center" });
  });

  it("leaves the preview exactly where it is for a field the template does not place", async () => {
    // A `title`, an SEO field, a slot this template ignores. Jumping to the top would
    // lose the reader's place to tell them nothing.
    const { w, doc } = await paintedPane();
    const scrolls = place(doc, '[data-lanza-field="heading"]', 2400, 100);
    expect(api(w).scrollToField("title")).toBe(false);
    expect(api(w).scrollToField("slots.nowhere")).toBe(false);
    expect(scrolls).toEqual([]);
  });

  it("honours prefers-reduced-motion", async () => {
    const { w, doc } = await paintedPane();
    const scrolls = place(doc, '[data-lanza-field="heading"]', 2400, 100);
    const win = doc.defaultView as Window & typeof globalThis;
    const real = win.matchMedia;
    win.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion") })) as never;
    try {
      api(w).scrollToField("slots.heading");
      expect(scrolls[0]).toMatchObject({ behavior: "auto" });
    } finally {
      win.matchMedia = real;
    }
  });

  it("animates when motion is not restricted", async () => {
    const { w, doc } = await paintedPane();
    const scrolls = place(doc, '[data-lanza-field="heading"]', 2400, 100);
    const win = doc.defaultView as Window & typeof globalThis;
    const real = win.matchMedia;
    win.matchMedia = ((_q: string) => ({ matches: false })) as never;
    try {
      api(w).scrollToField("slots.heading");
      expect(scrolls[0]).toMatchObject({ behavior: "smooth" });
    } finally {
      win.matchMedia = real;
    }
  });
});
