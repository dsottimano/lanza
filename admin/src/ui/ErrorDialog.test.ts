import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ErrorDialog from "./ErrorDialog.vue";
import { clearError, reportError } from "../errors";

afterEach(clearError);

describe("global error dialog", () => {
  it("opens a named modal for errors and closes on Dismiss", async () => {
    const w = mount(ErrorDialog, { attachTo: document.body });
    const dialog = w.get('dialog').element as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    reportError(new Error('Save failed'));
    await nextTick();
    expect(dialog.open).toBe(true);
    expect(w.get('#error-dialog-message').text()).toBe('Save failed');
    expect(w.get('dialog').attributes('aria-labelledby')).toBe('error-dialog-title');
    await w.get('button').trigger('click');
    expect(dialog.open).toBe(false);
    w.unmount();
  });
  it("handles Escape cancellation and subsequent errors", async () => {
    reportError(new Error('First failure'));
    const w = mount(ErrorDialog, { attachTo: document.body });
    await nextTick();
    const dialog = w.get('dialog').element as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    await w.get('dialog').trigger('cancel');
    expect(dialog.open).toBe(false);
    reportError(new Error('Second failure'));
    await nextTick();
    expect(dialog.open).toBe(true);
    expect(w.text()).toContain('Second failure');
    w.unmount();
  });
});
