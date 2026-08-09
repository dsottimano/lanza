import { describe, expect, it } from "vitest";
import { toLoginList, isValidLogin, findRole } from "./access";

describe("toLoginList", () => {
  it("accepts both stored forms", () => {
    expect(toLoginList("dsottimano")).toEqual(["dsottimano"]);
    expect(toLoginList("dsottimano, bob")).toEqual(["dsottimano", "bob"]);
    expect(toLoginList(["alice", "bob"])).toEqual(["alice", "bob"]);
  });

  it("drops blanks and non-strings rather than admitting them", () => {
    expect(toLoginList(["alice", "", "  ", null, 42, {}])).toEqual(["alice"]);
    expect(toLoginList("  ,  ")).toEqual([]);
    expect(toLoginList(undefined)).toEqual([]);
    expect(toLoginList(null)).toEqual([]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(toLoginList(["Alice", "alice", "ALICE"])).toEqual(["Alice"]);
  });
});

describe("isValidLogin", () => {
  it("accepts real GitHub usernames", () => {
    for (const ok of ["dsottimano", "a", "a-b", "user123", "A1", "a".repeat(39)]) {
      expect(isValidLogin(ok), ok).toBe(true);
    }
  });

  it("refuses what GitHub would never issue", () => {
    // A bad entry fails SILENTLY in production — the person simply cannot log in —
    // so it has to be caught while the owner is still looking at the field.
    for (const bad of [
      "",
      "-leading",
      "trailing-",
      "double--hyphen",
      "has space",
      "has_underscore",
      "has.dot",
      "a".repeat(40),
      "alice@example.com",
      "org/team",
    ]) {
      expect(isValidLogin(bad), bad).toBe(false);
    }
  });
});

describe("findRole", () => {
  it("resolves owner and editor, case-insensitively", () => {
    expect(findRole("dsottimano", ["dsottimano"], [])).toBe("owner");
    expect(findRole("ALICE", ["dsottimano"], ["alice"])).toBe("editor");
  });

  it("gives an unknown or absent login nothing", () => {
    expect(findRole("mallory", ["dsottimano"], ["alice"])).toBe(null);
    expect(findRole(null, ["dsottimano"], [])).toBe(null);
    expect(findRole("", ["dsottimano"], [])).toBe(null);
  });

  it("keeps owner when a login is in both lists", () => {
    // Mirrors resolveRole() on the server — being listed as an editor must never
    // demote an owner, or the two would disagree about the same config.
    expect(findRole("dsottimano", ["dsottimano"], ["dsottimano"])).toBe("owner");
  });
});
