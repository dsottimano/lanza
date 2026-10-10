import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ContentTypesView from "./ContentTypesView.vue";
import EditingExperience from "./content-types/EditingExperience.vue";
import SaveButton from "./SaveButton.vue";
import { saveSchema } from "../backend/schema";
import { COLLECTIONS, setCollections } from "../schema";
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


it("rejects names that break generation and accepts identifier names", async () => {
  const wrapper = mount(ContentTypesView, { props: { client: {} as GitHubClient } });
  await wrapper.findAll("button").find(b => b.text() === "+ New content type")!.trigger("click");
  await wrapper.find('input[placeholder="Events"]').setValue("Events");
  await wrapper.find('input[placeholder="Event"]').setValue("Event");
  const name = wrapper.find('input[placeholder="e.g. events"]');
  const create = () => wrapper.findAll("button").find(b => b.text() === "Create")!;
  for (const invalid of ["my-events", "123events", "../events", "posts"]) {
    await name.setValue(invalid);
    expect(create().attributes("disabled")).toBeDefined();
  }
  for (const valid of ["my_events", "Events2", "$events", "class", "collections"]) {
    await name.setValue(valid);
    expect(create().attributes("disabled")).toBeUndefined();
  }
  await name.setValue("my_events");
  await create().trigger("click");
  await wrapper.findComponent(SaveButton).props("action")();
  expect(vi.mocked(saveSchema).mock.calls[0]![1].find(c => c.name === "my_events"))
    .toMatchObject({ folder: "content/my_events", fields: [{ name: "title" }] });
  wrapper.unmount();
});

it("preserves custom route declarations when saving content type settings", async () => {
  const original = JSON.parse(JSON.stringify(COLLECTIONS));
  const route = { base: "calendar", template: "event", list: { template: "event-index", sortBy: "date", order: "desc" as const } };
  try {
    setCollections([...original, { kind: "folder", name: "events", label: "Events", labelSingular: "Event", folder: "content/events", body: "none", localized: true, route, fields: [{ name: "title", label: "Title", widget: "string" }] }]);
    const wrapper = mount(ContentTypesView, { props: { client: {} as GitHubClient } });
    await wrapper.findComponent(SaveButton).props("action")();
    expect(vi.mocked(saveSchema).mock.calls[0]![1].find(c => c.name === "events")).toMatchObject({ route });
    wrapper.unmount();
  } finally { setCollections(original); }
});


it("captures a detached schema and keeps edits made during saving dirty", async () => {
  let finish!: () => void;
  vi.mocked(saveSchema).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const wrapper = mount(ContentTypesView, { props: { client: {} as GitHubClient } });
  const label = wrapper.findAll('input').find(input => (input.element as HTMLInputElement).value === "Posts")!;
  await label.setValue("Articles");
  const saving = wrapper.findComponent(SaveButton).props("action")();
  await label.setValue("Stories");
  const saved = vi.mocked(saveSchema).mock.calls[0]![1];
  expect(saved.find(c => c.name === "posts")?.label).toBe("Articles");
  finish(); await saving;
  expect(isDirty.value).toBe(true);
  await wrapper.findComponent(SaveButton).props("action")();
  expect(vi.mocked(saveSchema).mock.calls[1]![1].find(c => c.name === "posts")?.label).toBe("Stories");
  expect(isDirty.value).toBe(false); wrapper.unmount();
});

it("does not clear a new editor's dirty flag after a schema save finishes", async () => {
  let finish!: () => void;
  vi.mocked(saveSchema).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const wrapper = mount(ContentTypesView, { props: { client: {} as GitHubClient } });
  const saving = wrapper.findComponent(SaveButton).props("action")();
  wrapper.unmount(); isDirty.value = true; finish(); await saving;
  expect(isDirty.value).toBe(true);
});
