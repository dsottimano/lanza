import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import FieldInput from "./FieldInput.vue";

describe("usable schema fields", () => {
  it("gives repeated field names distinct label targets", () => {
    const field = { name: "heading", label: "Heading", widget: "string" as const };
    const a = mount(FieldInput, { props: { field, modelValue: "A" }, global: { config: { idPrefix: "first" } } });
    // Repeated fields within one form share an app (and its useId counter).
    const parent = mount({ components: { FieldInput }, data: () => ({ field }), template: '<div><FieldInput :field="field"/><FieldInput :field="field"/></div>' });
    const ids = parent.findAll('input').map(el => el.attributes('id'));
    expect(new Set(ids).size).toBe(2);
    expect(parent.findAll('label').map(el => el.attributes('for'))).toEqual(ids);
    a.unmount(); parent.unmount();
  });
  it("displays YAML Date objects in datetime controls", () => {
    const w = mount(FieldInput, { props: { field: { name: "date", label: "Date", widget: "datetime" }, modelValue: new Date(2026, 8, 6, 10, 30) } });
    expect(w.find('input').element.value).toBe("2026-09-06T10:30"); w.unmount();
  });
  it("does not create empty objects or lists just by opening a field", () => {
    for (const widget of ["object", "list"] as const) {
      const w = mount(FieldInput, { props: { field: { name: "optional", label: "Optional", widget, fields: [] } } });
      expect(w.emitted('update:modelValue')).toBeUndefined(); w.unmount();
    }
  });
  it("edits inline SEO fields without losing hidden advanced values or changing field paths", async () => {
    const w = mount(FieldInput, { props: {
      field: { name: "seo", label: "SEO", widget: "object", collapsed: true,
        fields: [{ name: "metaTitle", label: "Search title", widget: "string" }] },
      path: "seo", inlineObject: true, modelValue: { metaTitle: "Old", canonical: "https://example.com/", noindex: true },
    } });
    expect(w.find('legend button').exists()).toBe(false);
    expect(w.emitted('update:modelValue')).toBeUndefined();
    await w.find('[data-field-path="seo.metaTitle"] input').setValue("New");
    expect(w.emitted('update:modelValue')?.[0]).toEqual([{ metaTitle: "New", canonical: "https://example.com/", noindex: true }]);
    w.unmount();
  });

});
