import { describe, expect, test } from "bun:test";
import { deriveWorkspaceNameFromBranch, shouldShowBranchPasteHint } from "./create";

describe("create helpers", () => {
  describe("deriveWorkspaceNameFromBranch", () => {
    test("uses last path segment when branch has slashes", () => {
      expect(deriveWorkspaceNameFromBranch("claude/improve-arb-create-ux-Ipru1")).toBe("improve-arb-create-ux-Ipru1");
    });

    test("returns branch name as-is when no slash is present", () => {
      expect(deriveWorkspaceNameFromBranch("my-feature")).toBe("my-feature");
    });

    test("returns null for empty segments", () => {
      expect(deriveWorkspaceNameFromBranch("///")).toBeNull();
    });
  });

  describe("shouldShowBranchPasteHint", () => {
    test("returns true when slash name looks like a valid branch and no --branch is given", () => {
      expect(
        shouldShowBranchPasteHint(
          "claude/improve-arb-create-ux-Ipru1",
          undefined,
          "Invalid workspace name 'x': must not contain '/'",
        ),
      ).toBe(true);
    });

    test("returns false when --branch is explicitly provided", () => {
      expect(
        shouldShowBranchPasteHint(
          "claude/improve-arb-create-ux-Ipru1",
          "claude/improve-arb-create-ux-Ipru1",
          "Invalid workspace name 'x': must not contain '/'",
        ),
      ).toBe(false);
    });

    test("returns false when --branch is used without value (boolean true)", () => {
      expect(
        shouldShowBranchPasteHint(
          "claude/improve-arb-create-ux-Ipru1",
          true,
          "Invalid workspace name 'x': must not contain '/'",
        ),
      ).toBe(false);
    });

    test("returns false for non-slash workspace validation errors", () => {
      expect(
        shouldShowBranchPasteHint("bad name", undefined, "Invalid workspace name 'x': must not contain whitespace"),
      ).toBe(false);
    });
  });
});
