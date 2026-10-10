import { afterEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LanguagesView from "./LanguagesView.vue";
import LocalePicker from "./LocalePicker.vue";
import SaveButton from "./SaveButton.vue";
import { site } from "../backend/site";
import type { GitHubClient } from "../backend/github";
import { isDirty } from "./dirty";
const original = JSON.parse(JSON.stringify(site));
afterEach(() => { Object.assign(site, original); isDirty.value = false; });

it("freezes the language/default pair before reading and preserves later edits", async () => {
  site.locales = [{code:"en",label:"English"},{code:"es",label:"Español"}]; site.defaultLocale = "en";
  let finish!: (value: unknown) => void;
  const read = new Promise(resolve => { finish = resolve; });
  const saved = { locales: site.locales, defaultLocale: "en", onboarded: true, urls: { "pages/en/home": "" } };
  const loadJson = vi.fn().mockReturnValueOnce(read).mockResolvedValue({ data: saved, sha: "next" });
  const saveJson = vi.fn().mockResolvedValue("next");
  const w = mount(LanguagesView, { props: {client: {loadJson,saveJson} as unknown as GitHubClient} });
  const action = w.findComponent(SaveButton).props("action"); const saving = action();
  w.findComponent(LocalePicker).vm.$emit("update:chosen", ["es"]);
  w.findComponent(LocalePicker).vm.$emit("update:default", "es");
  finish({ data: saved, sha: "old" }); await saving; await flushPromises();
  expect(saveJson.mock.calls[0]![1]).toMatchObject({ defaultLocale: "en", locales: [{code:"en"},{code:"es"}], urls: saved.urls });
  expect(isDirty.value).toBe(true);
  await action(); expect(saveJson.mock.calls[1]![1]).toMatchObject({ defaultLocale: "es", locales: [{code:"es"}] });
  expect(isDirty.value).toBe(false); w.unmount();
});

it("does not clear another editor after an unmounted language save", async () => {
  let finish!: (value: string) => void;
  const saveJson = vi.fn().mockReturnValue(new Promise<string>(resolve => { finish = resolve; }));
  const loadJson = vi.fn().mockResolvedValue({ data: {locales: site.locales, defaultLocale:site.defaultLocale}, sha:"old" });
  const w = mount(LanguagesView, { props: {client: {loadJson,saveJson} as unknown as GitHubClient} });
  const saving = w.findComponent(SaveButton).props("action")(); await flushPromises();
  w.unmount(); isDirty.value = true; finish("new"); await saving;
  expect(isDirty.value).toBe(true); expect(w.emitted("saved")).toBeUndefined();
});
