import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SlugField from "./SlugField.vue";
import IdentityField from "./IdentityField.vue";

describe("identity editing", () => {
  it("offers an edit action by default for the page name", () => {
    const w = mount(IdentityField, { props: { label: "Page name" } });
    expect(w.find('button[aria-label="Edit page name"]').exists()).toBe(true);
    w.unmount();
  });
  it("focuses the editable slug from its pencil without changing the locale prefix", async () => {
    const w = mount(SlugField, { attachTo: document.body, props: { prefix: "/es/", suffix: "/", label: "Español URL", modelValue: "about" } });
    await w.find('button[aria-label="Edit español url"]').trigger('click');
    expect(document.activeElement).toBe(w.find('input').element);
    await w.find('input').setValue('contact');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['contact']);
    expect(w.find('.identity-url__prefix').text()).toBe('/es/');
    w.unmount();
  });
  it("explains when the signed-in role cannot change URLs", () => {
    const w = mount(SlugField, { props: { prefix: "/es/", suffix: "", label: "Español URL", modelValue: "", editable: false } });
    expect(w.find('input').exists()).toBe(false);
    expect(w.find('button').exists()).toBe(false);
    expect(w.find('[role="img"]').attributes('aria-label')).toContain('URL changes require an owner');
    expect(w.find('.identity-url').text()).toBe('/es/');
    w.unmount();
  });
});
