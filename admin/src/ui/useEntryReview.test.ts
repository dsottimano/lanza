import { describe, it, expect, vi } from "vitest";
import { reactive } from "vue";
import { useEntryReview } from "./useEntryReview";
import { GitHubError, type GitHubClient } from "../backend/github";
import { REPO } from "../backend/config";

const PATH = "content/pages/en/about.md";

function file(frontmatter: string, body = "Hello."): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

/** Serves one version per branch; `undefined` means the file isn't on that branch. */
function spyClient(files: { live?: string; staged?: string; fail?: boolean }) {
  return {
    loadText: async (path: string, ref: string) => {
      if (files.fail) throw new GitHubError(500, "Server Error");
      const text = ref === REPO.productionBranch ? files.live : files.staged;
      if (text === undefined) throw new GitHubError(404, "Not Found");
      return { path, sha: `sha-${ref}`, text };
    },
  } as unknown as GitHubClient;
}

/** A review bound to a live reactive `data` and a body ref, as the editor holds them. */
function harness(files: Parameters<typeof spyClient>[0], staged: Record<string, unknown>) {
  const data = reactive(staged);
  let body = "Edited body.";
  const markDirty = vi.fn();
  const review = useEntryReview({
    client: spyClient(files),
    path: () => PATH,
    data,
    getBody: () => body,
    setBody: (html) => {
      body = html;
    },
    markDirty,
  });
  return { review, data, markDirty, currentBody: () => body };
}

describe("loading", () => {
  it("reports the changed paths for an entry that differs", async () => {
    const { review } = harness(
      { live: file("title: Live\nsubtitle: Same"), staged: file("title: Draft\nsubtitle: Same") },
      { title: "Draft", subtitle: "Same" },
    );
    await review.load();
    expect(review.changed.value).toEqual(["title"]);
    expect(review.hasChanges.value).toBe(true);
  });

  it("has nothing to compare for an entry that was never saved", async () => {
    const review = useEntryReview({
      client: spyClient({ staged: file("title: New") }),
      path: () => null, // never saved: no file on either branch
      data: reactive({}),
      getBody: () => "",
      setBody: () => {},
      markDirty: () => {},
    });
    await review.load();
    expect(review.diff.value).toBe(null);
    expect(review.hasChanges.value).toBe(false);
  });

  // The editor must open even when the comparison can't be made. Refusing to edit
  // because production was unreachable would be a worse product than not being able
  // to say what changed.
  it("stays silent when the comparison fails, rather than breaking the editor", async () => {
    const { review } = harness({ fail: true }, { title: "Draft" });
    await review.load();
    expect(review.diff.value).toBe(null);
    expect(review.hasChanges.value).toBe(false);
    expect(review.loading.value).toBe(false);
  });
});

describe("revert", () => {
  it("puts a changed field back and marks the entry dirty", async () => {
    const { review, data, markDirty } = harness(
      { live: file("title: Live"), staged: file("title: Draft") },
      { title: "Draft" },
    );
    await review.load();
    expect(review.revert("title")).toBe(true);
    expect(data.title).toBe("Live");
    expect(markDirty).toHaveBeenCalled();
  });

  // The whole form is bound to this exact object; replacing it would leave every
  // widget bound to a detached copy that no longer renders.
  it("mutates the editor's own data object in place", async () => {
    const { review, data } = harness(
      { live: file("title: Live"), staged: file("title: Draft") },
      { title: "Draft" },
    );
    await review.load();
    const before = data;
    review.revert("title");
    expect(data).toBe(before);
  });

  // Assigning undefined is not the same as deleting: it survives into the YAML as an
  // empty key instead of disappearing.
  it("removes a key that the live site does not have", async () => {
    const { review, data } = harness(
      { live: file("title: Live"), staged: file("title: Live\nsubtitle: Added") },
      { title: "Live", subtitle: "Added" },
    );
    await review.load();
    expect(review.revert("subtitle")).toBe(true);
    expect("subtitle" in data).toBe(false);
  });

  it("restores a key the draft deleted", async () => {
    const { review, data } = harness(
      { live: file("title: Live\nsubtitle: Kept"), staged: file("title: Live") },
      { title: "Live" },
    );
    await review.load();
    expect(review.revert("subtitle")).toBe(true);
    expect(data.subtitle).toBe("Kept");
  });

  it("puts the body back through the editor, not through data", async () => {
    const { review, currentBody, markDirty } = harness(
      { live: file("title: A", "The published words."), staged: file("title: A", "New words.") },
      { title: "A" },
    );
    await review.load();
    expect(review.revert("body")).toBe(true);
    expect(currentBody()).toBe("The published words.");
    expect(markDirty).toHaveBeenCalled();
  });

  it("does nothing for an unchanged field, an unknown path, or before loading", async () => {
    const { review, markDirty } = harness(
      { live: file("title: Live\nsubtitle: Same"), staged: file("title: Draft\nsubtitle: Same") },
      { title: "Draft", subtitle: "Same" },
    );
    // Before load(): no diff, so nothing is known to revert.
    expect(review.revert("title")).toBe(false);
    await review.load();
    expect(review.revert("subtitle")).toBe(false); // unchanged
    expect(review.revert("nope")).toBe(false); // not in the report
    expect(markDirty).not.toHaveBeenCalled();
  });

  // The diff is a snapshot. If the reviewer edits the field after it was taken, the
  // revert still restores the LIVE value — that is what "put it back" means — but the
  // snapshot itself must not be corrupted by the edit.
  it("does not let a later edit change what the live site is recorded as saying", async () => {
    const { review, data } = harness(
      { live: file("title: Live"), staged: file("title: Draft") },
      { title: "Draft" },
    );
    await review.load();
    data.title = "Typed something else";
    review.revert("title");
    expect(data.title).toBe("Live");
    expect(review.diff.value?.fields.find((f) => f.path === "title")?.live).toBe("Live");
  });
});

describe("selection", () => {
  it("remembers which field the reviewer picked, and can clear it", () => {
    const { review } = harness({ live: file("title: A"), staged: file("title: B") }, { title: "B" });
    expect(review.selected.value).toBe(null);
    review.select("slots.cards.0.heading");
    expect(review.selected.value).toBe("slots.cards.0.heading");
    review.select(null);
    expect(review.selected.value).toBe(null);
  });
});
