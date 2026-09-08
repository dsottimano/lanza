import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import Sidebar from "./Sidebar.vue";

const defaults = {
  activeCollection: "posts", activeSettings: null,
  languagesOpen: false, headerFooterOpen: false, brandThemesOpen: false,
  blocksOpen: false, healthOpen: false, updatesOpen: false,
  contentTypesOpen: false, peopleOpen: false, agentOpen: false,
  isOwner: true, publishOpen: false, pendingOpen: false, helpOpen: false,
};

beforeEach(() => localStorage.clear());

describe("Sidebar navigation", () => {
  it.each([
    "brandThemesOpen", "headerFooterOpen", "blocksOpen", "languagesOpen",
    "contentTypesOpen", "peopleOpen", "agentOpen", "healthOpen",
    "updatesOpen", "pendingOpen", "publishOpen", "helpOpen",
  ])("does not also highlight Posts when %s is open", (pane) => {
    const wrapper = mount(Sidebar, { props: { ...defaults, [pane]: true } });
    const selected = wrapper.findAll(".nav-item--active");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.text()).not.toBe("Posts");
  });

  it("allows collapsing the active section and reveals a new destination", async () => {
    const wrapper = mount(Sidebar, { props: defaults });
    const content = wrapper.find(".group-toggle");
    await content.trigger("click");
    expect(content.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".group-body").attributes()).toHaveProperty("inert");
    await wrapper.setProps({ peopleOpen: true });
    const administration = wrapper.findAll(".rail-group").at(-1)!;
    expect(administration.find(".group-toggle").attributes("aria-expanded")).toBe("true");
    expect(administration.find(".group-body").attributes()).not.toHaveProperty("inert");
  });

  it("keeps publishing and administration out of editor navigation", () => {
    const wrapper = mount(Sidebar, { props: { ...defaults, isOwner: false } });
    expect(wrapper.text()).not.toContain("Review & publish");
    expect(wrapper.text()).not.toContain("Review changes");
    expect(wrapper.text()).not.toContain("Administration");
    expect(wrapper.text()).toContain("Posts");
    expect(wrapper.text()).toContain("Help & guide");
  });

  it("offers one review action only when saved changes exist", async () => {
    const wrapper = mount(Sidebar, { props: { ...defaults, pendingCount: 0 } });
    expect(wrapper.find(".sidebar-publish").exists()).toBe(false);
    await wrapper.setProps({ pendingCount: 3 });
    expect(wrapper.text()).not.toContain("Review changes");
    await wrapper.find(".sidebar-publish").trigger("click");
    expect(wrapper.emitted("pending")).toHaveLength(1);
    expect(wrapper.emitted("publish")).toBeUndefined();
    await wrapper.setProps({ pendingCount: 0 });
    expect(wrapper.find(".sidebar-publish").exists()).toBe(false);
  });
  it("offers a retry when the change check fails without hiding known changes", async () => {
    const wrapper = mount(Sidebar, { props: { ...defaults, pendingCount: 2, pendingCheckFailed: true } });
    expect(wrapper.find(".sidebar-publish").exists()).toBe(true);
    await wrapper.findAll("button").find(b => b.text() === "Retry")!.trigger("click");
    expect(wrapper.emitted("retryPending")).toHaveLength(1);
    await wrapper.setProps({ pendingCount: null });
    expect(wrapper.find(".sidebar-publish").exists()).toBe(false);
    expect(wrapper.text()).toContain("Retry");
  });

});
