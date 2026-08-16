import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FieldForm, { sectionsOf } from "./FieldForm.vue";
import TemplateEditor from "../ui/TemplateEditor.vue";
import { touchesField, anyTouchesField, toSlotPaths } from "./field-paths";
import type { Field } from "../schema";

// A template's slots are a tall stack of equal-weight inputs, and the preview never gets
// real width. Grouping collapses them — but the fields are mostly agent-written, so the
// collapse has to open exactly what a review flagged, or a reviewer has to hunt.

const f = (name: string, group?: string): Field => ({
  name,
  label: name,
  widget: "string",
  required: false,
  ...(group ? { group } : {}),
});

describe("sectionsOf", () => {
  it("keeps ungrouped fields in one run, in declaration order", () => {
    const sections = sectionsOf([f("a"), f("b"), f("c")]);
    expect(sections).toHaveLength(1);
    expect(sections[0].group).toBeNull();
    expect(sections[0].fields.map((x) => x.name)).toEqual(["a", "b", "c"]);
  });

  it("puts a group where its first field appears", () => {
    const sections = sectionsOf([f("a"), f("h1", "Hero"), f("h2", "Hero"), f("z")]);
    expect(sections.map((s) => s.group)).toEqual([null, "Hero", null]);
    expect(sections[1].fields.map((x) => x.name)).toEqual(["h1", "h2"]);
    expect(sections[2].fields.map((x) => x.name)).toEqual(["z"]);
  });

  it("rejoins a group whose fields are not adjacent", () => {
    // Otherwise one stray field in the middle silently splits a heading in two.
    const sections = sectionsOf([f("h1", "Hero"), f("d1", "Demo"), f("h2", "Hero")]);
    expect(sections.map((s) => s.group)).toEqual(["Hero", "Demo"]);
    expect(sections[0].fields.map((x) => x.name)).toEqual(["h1", "h2"]);
  });

  it("treats a missing or empty group as ungrouped", () => {
    const sections = sectionsOf([f("a"), { ...f("b"), group: "" }]);
    expect(sections).toHaveLength(1);
    expect(sections[0].group).toBeNull();
  });
});

describe("changed paths", () => {
  it("touches the field a deeper path lives inside", () => {
    expect(touchesField("cards.0.heading", "cards")).toBe(true);
    expect(touchesField("cards", "cards")).toBe(true);
  });

  it("touches the descendants of a container path", () => {
    // A report can name the container when a whole subtree was added or removed.
    expect(touchesField("cards", "cards.0.heading")).toBe(true);
    expect(touchesField("", "anything")).toBe(true); // the whole object
  });

  it("is segment-wise, so a shared prefix is not a match", () => {
    expect(touchesField("cards", "cardstack")).toBe(false);
    expect(touchesField("cardstack", "cards")).toBe(false);
    expect(touchesField("headline", "head")).toBe(false);
  });

  it("converts entry paths to slot paths in one step", () => {
    expect(toSlotPaths(["slots.cards.0.heading"])).toEqual(["cards.0.heading"]);
    // The container itself: everything changed.
    expect(toSlotPaths(["slots"])).toEqual([""]);
    // Outside the slots object — not a field this form renders, so it must not open
    // anything. `slotsomething` is the trap the `.` guards against.
    expect(toSlotPaths(["title", "draft", "seo.description", "slotsomething"])).toEqual([]);
    expect(toSlotPaths([])).toEqual([]);
  });

  it("answers for a whole set of paths at once", () => {
    expect(anyTouchesField(["title", "cards.1.cta"], "cards")).toBe(true);
    expect(anyTouchesField(["title"], "cards")).toBe(false);
    expect(anyTouchesField([], "cards")).toBe(false);
  });
});

// ── The form ────────────────────────────────────────────────────────────────

const client = {} as never;

function mountForm(fields: Field[], changed?: readonly string[], data: Record<string, unknown> = {}) {
  return mount(FieldForm, {
    props: { fields, data, client, locale: "en", dense: true, ...(changed ? { changed } : {}) },
  });
}

const summaries = (w: ReturnType<typeof mountForm>) => w.findAll("summary").map((s) => s.text());

describe("FieldForm — grouping", () => {
  it("renders an ungrouped form exactly as before: no disclosure at all", () => {
    const w = mountForm([f("a"), f("b")]);
    expect(w.findAll("details")).toHaveLength(0);
    expect(w.findAll("input")).toHaveLength(2);
  });

  it("puts each group behind one heading", () => {
    const w = mountForm([f("h", "Hero"), f("h2", "Hero"), f("d", "Demo")]);
    const groups = w.findAll("details");
    expect(groups).toHaveLength(2);
    expect(summaries(w)[0]).toContain("Hero");
    expect(summaries(w)[1]).toContain("Demo");
  });

  it("collapses groups by default and leaves ungrouped fields loose", () => {
    const w = mountForm([f("loose"), f("h", "Hero")]);
    expect(w.findAll("details").every((d) => !(d.element as HTMLDetailsElement).open)).toBe(true);
    // The loose field is not inside any disclosure — it stays where it always was.
    expect(w.find("details").findAll("input")).toHaveLength(1);
    expect(w.findAll("input")).toHaveLength(2);
  });

  it("still renders every field, so nothing becomes unreachable", () => {
    // Collapsed is not hidden: the inputs exist and keep their bindings.
    const data: Record<string, unknown> = { h: "kept" };
    const w = mountForm([f("h", "Hero")], undefined, data);
    expect((w.find("input").element as HTMLInputElement).value).toBe("kept");
  });
});

describe("FieldForm — what needs attention", () => {
  it("opens the group holding a changed field, and marks it", () => {
    const w = mountForm([f("h", "Hero"), f("d", "Demo")], ["h"]);
    const [hero, demo] = w.findAll("details");
    expect((hero.element as HTMLDetailsElement).open).toBe(true);
    expect((demo.element as HTMLDetailsElement).open).toBe(false);
    expect(hero.find("summary").text()).toContain("1 changed");
    expect(demo.find("summary").text()).not.toContain("changed");
  });

  it("opens a group from a path deeper than the field", () => {
    // The review reports the leaf; the form renders the list that holds it.
    const w = mountForm([{ ...f("cards", "Doors"), widget: "list" }, f("h", "Hero")], ["cards.0.heading"]);
    expect((w.findAll("details")[0].element as HTMLDetailsElement).open).toBe(true);
    expect((w.findAll("details")[1].element as HTMLDetailsElement).open).toBe(false);
  });

  it("opens a group from a CONTAINER path that holds its fields", () => {
    const w = mountForm([{ ...f("cards", "Doors"), widget: "list" }], ["cards"]);
    expect((w.find("details").element as HTMLDetailsElement).open).toBe(true);
  });

  it("counts every changed field in the group", () => {
    const w = mountForm([f("a", "Hero"), f("b", "Hero"), f("c", "Hero")], ["a", "c"]);
    expect(w.find("summary").text()).toContain("2 changed");
  });

  it("stays shut for a changed path that names nothing here", () => {
    const w = mountForm([f("h", "Hero")], ["somethingElse", "headlinez"]);
    expect((w.find("details").element as HTMLDetailsElement).open).toBe(false);
  });

  it("marks the changed field itself, not just its group", () => {
    const w = mountForm([f("a", "Hero"), f("b", "Hero")], ["a"]);
    const marked = w.findAll('[data-changed="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].find("input").exists()).toBe(true);
  });

  it("lets the person's own toggle win over the automatic open", () => {
    // Closing a group full of changes is a perfectly good way to say "reviewed".
    const w = mountForm([f("h", "Hero")], ["h"]);
    const details = w.find("details");
    (details.element as HTMLDetailsElement).open = false;
    details.trigger("toggle");
    return w.vm.$nextTick().then(() => {
      expect((w.find("details").element as HTMLDetailsElement).open).toBe(false);
    });
  });
});

describe("TemplateEditor — entry paths reach the right group", () => {
  // The conversion lives in exactly one place; this is the proof that it is wired, and
  // that a form nested behind it never sees an entry path.
  const template = {
    name: "manifesto",
    label: "Manifesto",
    body: false,
    fields: [f("headline", "Hero"), { ...f("cards", "Doors"), widget: "list" as const }],
  };

  function mountEditor(changed?: readonly string[]) {
    return mount(TemplateEditor, {
      props: {
        client: { loadText: async () => ({ text: "", sha: "x" }) } as never,
        data: { preset: "manifesto", slots: {} },
        locale: "en",
        templates: [template],
        loading: false,
        ...(changed ? { changed } : {}),
      },
    });
  }

  it("opens the group named by an entry path", () => {
    const w = mountEditor(["slots.cards.0.heading"]);
    const groups = w.findAll(".field-group");
    expect(groups.map((g) => g.attributes("data-group"))).toEqual(["Hero", "Doors"]);
    expect((groups[1].element as HTMLDetailsElement).open).toBe(true);
    expect((groups[0].element as HTMLDetailsElement).open).toBe(false);
  });

  it("ignores changes outside the slots object", () => {
    // `title` is a chrome field and `slotsomething` is not the slots container.
    const w = mountEditor(["title", "slotsomething.x"]);
    expect(w.findAll(".field-group").every((g) => !(g.element as HTMLDetailsElement).open)).toBe(true);
  });

  it("opens everything when the whole slots container is reported", () => {
    const w = mountEditor(["slots"]);
    expect(w.findAll(".field-group").every((g) => (g.element as HTMLDetailsElement).open)).toBe(true);
  });

  it("works with no changed prop at all", () => {
    const w = mountEditor();
    expect(w.findAll(".field-group")).toHaveLength(2);
    expect(w.findAll(".field-group").every((g) => !(g.element as HTMLDetailsElement).open)).toBe(true);
  });
});
