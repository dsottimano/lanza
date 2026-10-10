import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PublicationTask from "./PublicationTask.vue";

describe("publication task", () => {
  it("opens review for saved changes and disappears when publication clears them", async () => {
    const wrapper = mount(PublicationTask, { props: { isOwner: true, count: 1, checkFailed: false } });
    expect(wrapper.text()).toContain("Task: Review & publish");
    expect(wrapper.find("button").attributes("aria-label")).toContain("1 change waiting");
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("review")).toHaveLength(1);
    await wrapper.setProps({ count: 3 });
    expect(wrapper.find("button").attributes("aria-label")).toContain("3 changes waiting");
    await wrapper.setProps({ count: 0 });
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("does not offer publishing to editors", () => {
    const wrapper = mount(PublicationTask, { props: { isOwner: false, count: 2, checkFailed: true } });
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("preserves a known task on refresh failure and offers retry without inventing a count", async () => {
    const wrapper = mount(PublicationTask, { props: { isOwner: true, count: 2, checkFailed: true } });
    expect(wrapper.text()).toContain("Count may be out of date");
    await wrapper.findAll("button").at(-1)!.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    await wrapper.setProps({ count: null });
    expect(wrapper.text()).not.toContain("Task:");
    expect(wrapper.text()).toContain("Could not check unpublished changes");
  });
});
