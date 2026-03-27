import { describe, expect, test } from "bun:test";
import { computeMergeDetectionStrategy, parseLeftRight, shouldRunMergeDetection } from "./status";
import { makeRepo } from "./test-helpers";
import type { RepoStatus } from "./types";

describe("parseLeftRight", () => {
  test("valid stdout parses to left and right", () => {
    const result = parseLeftRight("3\t5\n");
    expect(result).toEqual({ left: 3, right: 5 });
  });

  test("zero counts parse correctly", () => {
    const result = parseLeftRight("0\t0\n");
    expect(result).toEqual({ left: 0, right: 0 });
  });

  test("malformed single number falls back to 0 for missing", () => {
    const result = parseLeftRight("7\n");
    expect(result.left).toBe(7);
    expect(result.right).toBe(0);
  });

  test("empty string does not crash", () => {
    const result = parseLeftRight("");
    expect(result).toHaveProperty("left");
    expect(result).toHaveProperty("right");
  });
});

describe("shouldRunMergeDetection", () => {
  test("returns true when hasWork and not on base branch and not skipForNeverPushed", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    }).base;
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 1,
        toPull: 0,
      },
    }).share;
    expect(shouldRunMergeDetection(baseStatus, shareStatus, false, "feature")).toBe(true);
  });

  test("returns true when isGone and not on base branch", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 0,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    }).base;
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: null,
        refMode: "gone",
        toPush: null,
        toPull: null,
      },
    }).share;
    expect(shouldRunMergeDetection(baseStatus, shareStatus, false, "feature")).toBe(true);
  });

  test("returns false when detached", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    }).base;
    const shareStatus = makeRepo().share;
    expect(shouldRunMergeDetection(baseStatus, shareStatus, true, "feature")).toBe(false);
  });

  test("returns false when isOnBaseBranch", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    }).base;
    const shareStatus = makeRepo().share;
    expect(shouldRunMergeDetection(baseStatus, shareStatus, false, "main")).toBe(false);
  });

  test("returns false when skipForNeverPushed (ahead=0, refMode=noRef)", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 0,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    }).base;
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: null,
        refMode: "noRef",
        toPush: null,
        toPull: null,
      },
    }).share;
    expect(shouldRunMergeDetection(baseStatus, shareStatus, false, "feature")).toBe(false);
  });

  test("returns false when baseStatus is null", () => {
    const shareStatus = makeRepo().share;
    expect(shouldRunMergeDetection(null, shareStatus, false, "feature")).toBe(false);
  });
});

function requireBase(repo: RepoStatus): NonNullable<RepoStatus["base"]> {
  if (!repo.base) throw new Error("Expected base to be non-null");
  return repo.base;
}

describe("computeMergeDetectionStrategy", () => {
  test("shouldCheckSquash is true when gone", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: null,
        refMode: "gone",
        toPush: null,
        toPull: null,
      },
    }).share;
    const result = computeMergeDetectionStrategy(requireBase(baseStatus), shareStatus);
    expect(result.shouldCheckSquash).toBe(true);
  });

  test("shouldCheckSquash is true when share up-to-date (toPush=0, toPull=0, refMode not noRef)", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 0,
        toPull: 0,
      },
    }).share;
    const result = computeMergeDetectionStrategy(requireBase(baseStatus), shareStatus);
    expect(result.shouldCheckSquash).toBe(true);
  });

  test("shouldCheckSquash is false when refMode is noRef (override in runMergeDetection)", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 2,
        behind: 1,
        baseMergedIntoDefault: null,
      },
    });
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: null,
        refMode: "noRef",
        toPush: null,
        toPull: null,
      },
    }).share;
    const result = computeMergeDetectionStrategy(requireBase(baseStatus), shareStatus);
    // computeMergeDetectionStrategy returns false; runMergeDetection overrides
    // when the replay plan confirms all commits are on target.
    expect(result.shouldCheckSquash).toBe(false);
  });

  test("shouldCheckSquash is false when share has unpushed work and is not gone", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 2,
        toPull: 0,
      },
    }).share;
    const result = computeMergeDetectionStrategy(requireBase(baseStatus), shareStatus);
    expect(result.shouldCheckSquash).toBe(false);
  });

  test("shouldCheckPrefixes is true when refMode!=noRef, toPush>0, toPull=0", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 5,
        toPull: 0,
      },
    }).share;
    const result = computeMergeDetectionStrategy(requireBase(baseStatus), shareStatus);
    expect(result.shouldCheckPrefixes).toBe(true);
  });

  test("prefixLimit is Math.min(toPush, 10) when shouldCheckPrefixes", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 5,
        toPull: 0,
      },
    }).share;
    const result = computeMergeDetectionStrategy(requireBase(baseStatus), shareStatus);
    expect(result.prefixLimit).toBe(5);
  });

  test("prefixLimit caps at 10 when toPush exceeds 10", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 20,
        toPull: 0,
      },
    }).share;
    const result = computeMergeDetectionStrategy(requireBase(baseStatus), shareStatus);
    expect(result.prefixLimit).toBe(10);
  });

  test("prefixLimit is based on ahead when not shouldCheckPrefixes", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 5,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 0,
        toPull: 0,
      },
    }).share;
    const result = computeMergeDetectionStrategy(requireBase(baseStatus), shareStatus);
    expect(result.shouldCheckPrefixes).toBe(false);
    expect(result.prefixLimit).toBe(4); // Math.min(5 - 1, 10)
  });

  test("prefixLimit is 0 when ahead <= 1 and not shouldCheckPrefixes", () => {
    const baseStatus = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 1,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const shareStatus = makeRepo({
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 0,
        toPull: 0,
      },
    }).share;
    const result = computeMergeDetectionStrategy(requireBase(baseStatus), shareStatus);
    expect(result.prefixLimit).toBe(0);
  });
});
