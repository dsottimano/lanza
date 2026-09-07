import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ContentTypesView from "./ContentTypesView.vue";
import EditingExperience from "./content-types/EditingExperience.vue";
import SaveButton from "./SaveButton.vue";
import { saveSchema } from "../backend/schema";
import { COLLECTIONS } from "../schema";
import type { GitHubClient } from "../backend/github";
import { isDirty } from "./dirty";

vi.mock("../backend/schema", () => ({ saveSchema: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => { vi.clearAllMocks(); isDirty.value = false; });

describe("Content type editing", () => {
  it("accepts existing field identifiers and preserves the model when saving", async () => {
    const wrapper = mount(ContentTypesView, { props: { client: {} as GitHubClient } });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.findComponent(SaveButton).props("disabled")).toBe(false);
    await wrapper.findComponent(SaveButton).props("action")();
    const saved = vi.mocked(saveSchema).mock.calls[0]![1];
    expect(saved.map(c => c.name)).toEqual(COLLECTIONS.map(c => c.name));
    const posts = saved.find(c => c.name === "posts");
    expect(posts?.kind === "folder" && posts.fields.some(f => f.name === "featuredImage")).toBe(true);
    wrapper.unmount();
  });

  it("saves the editing choice without changing the live collection before save", async () => {
    const wrapper = mount(ContentTypesView, { props: { client: {} as GitHubClient } });
    await wrapper.findComponent(EditingExperience).findAll('input[type="radio"]')[1]!.setValue();
    const live = COLLECTIONS.find(c => c.name === "posts");
    expect(live?.kind === "folder" && live.body).toBe("rich");
    await wrapper.findComponent(SaveButton).props("action")();
    const posts = vi.mocked(saveSchema).mock.calls[0]![1].find(c => c.name === "posts");
    expect(posts?.kind === "folder" && posts.body).toBe("none");
    wrapper.unmount();
  });

  it("explains template-driven landing page editing for Pages", async () => {
    const wrapper = mount(ContentTypesView, { props: { client: {} as GitHubClient } });
    await wrapper.findAll("aside button").find(b => b.text().startsWith("Pages"))!.trigger("click");
    expect(wrapper.findComponent(EditingExperience).text()).toContain("Designed landing pages");
    expect(wrapper.findComponent(EditingExperience).text()).toContain("live preview");
    wrapper.unmount();
  });
});
