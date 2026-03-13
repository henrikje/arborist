import { describe, expect, test } from "bun:test";
import { rejectExplicitBaseRemotePrefix } from "./base";

describe("workspace base helpers", () => {
  test("rejectExplicitBaseRemotePrefix ignores ordinary branch names", () => {
    expect(rejectExplicitBaseRemotePrefix("feat/auth", { baseRemotes: new Set(["origin"]) })).toBe("feat/auth");
  });

  test("rejectExplicitBaseRemotePrefix ignores other prefixes", () => {
    expect(rejectExplicitBaseRemotePrefix("upstream/main", { baseRemotes: new Set(["origin"]) })).toBe("upstream/main");
  });

  test("rejectExplicitBaseRemotePrefix rejects matching prefixes", () => {
    expect(() => rejectExplicitBaseRemotePrefix("upstream/main", { baseRemotes: new Set(["upstream"]) })).toThrow(
      "Base branch 'upstream/main' includes the resolved base remote 'upstream'. Use 'main' instead.",
    );
  });

  test("rejectExplicitBaseRemotePrefix ignores mixed-remote workspaces", () => {
    expect(rejectExplicitBaseRemotePrefix("origin/main", { baseRemotes: new Set(["origin", "upstream"]) })).toBe(
      "origin/main",
    );
  });
});
