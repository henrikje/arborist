import { describe, expect, test } from "bun:test";
import { flagLabels, formatStatusCounts } from "../render";
import { computeFlags, computeSummaryAggregates, isAtRisk, isWorkspaceSafe, wouldLoseWork } from "./flags";
import { makeRepo } from "./test-helpers";
import { AT_RISK_FLAGS, LOSE_WORK_FLAGS, MERGED_IMPLIED_FLAGS, STALE_FLAGS } from "./types";

describe("computeFlags", () => {
  test("all false for clean, equal, on-branch repo", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(flags).toEqual({
      isDirty: false,
      hasConflict: false,
      hasStaged: false,
      hasModified: false,
      hasUntracked: false,
      isAheadOfShare: false,
      hasNoShare: false,
      isBehindShare: false,
      isAheadOfBase: false,
      isBehindBase: false,
      isDiverged: false,
      isWrongBranch: false,
      isDetached: false,
      hasOperation: false,
      isGone: false,
      isShallow: false,
      isMerged: false,
      isBaseMerged: false,
      isBaseMissing: false,
      isTimedOut: false,
    });
  });

  test("isDirty when local has staged files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(flags.isDirty).toBe(true);
  });

  test("isDirty when local has modified files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 1, untracked: 0, conflicts: 0 } }), "feature");
    expect(flags.isDirty).toBe(true);
  });

  test("isDirty when local has untracked files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 0, untracked: 1, conflicts: 0 } }), "feature");
    expect(flags.isDirty).toBe(true);
  });

  test("isDirty when local has conflicts", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 0, untracked: 0, conflicts: 1 } }), "feature");
    expect(flags.isDirty).toBe(true);
  });

  test("hasConflict when local has conflicts", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 0, untracked: 0, conflicts: 2 } }), "feature");
    expect(flags.hasConflict).toBe(true);
  });

  test("not hasConflict when no conflicts", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 1, untracked: 1, conflicts: 0 } }), "feature");
    expect(flags.hasConflict).toBe(false);
  });

  test("hasStaged when local has staged files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(flags.hasStaged).toBe(true);
  });

  test("not hasStaged when only modified files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 1, untracked: 0, conflicts: 0 } }), "feature");
    expect(flags.hasStaged).toBe(false);
  });

  test("hasModified when local has modified files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 1, untracked: 0, conflicts: 0 } }), "feature");
    expect(flags.hasModified).toBe(true);
  });

  test("not hasModified when only staged files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(flags.hasModified).toBe(false);
  });

  test("hasUntracked when local has untracked files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 0, untracked: 1, conflicts: 0 } }), "feature");
    expect(flags.hasUntracked).toBe(true);
  });

  test("not hasUntracked when only staged files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(flags.hasUntracked).toBe(false);
  });

  test("isAheadOfBase when base.ahead > 0", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 3,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flags.isAheadOfBase).toBe(true);
  });

  test("not isAheadOfBase when base.ahead is 0", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(flags.isAheadOfBase).toBe(false);
  });

  test("not isAheadOfBase when base is null", () => {
    const flags = computeFlags(makeRepo({ base: null }), "feature");
    expect(flags.isAheadOfBase).toBe(false);
  });

  test("isAheadOfShare when toPush > 0", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
      "feature",
    );
    expect(flags.isAheadOfShare).toBe(true);
  });

  test("isAheadOfShare when noRef with base.ahead > 0", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "noRef",
          toPush: null,
          toPull: null,
        },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 3,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flags.isAheadOfShare).toBe(true);
  });

  test("not isAheadOfShare when gone even with base.ahead > 0", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 3,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flags.isAheadOfShare).toBe(false);
    expect(flags.isGone).toBe(true);
  });

  test("not isAheadOfShare when up to date with remote", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(flags.isAheadOfShare).toBe(false);
  });

  test("not isAheadOfShare when share has no ref and no base ahead", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "noRef" as const,
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(flags.isAheadOfShare).toBe(false);
  });

  test("hasNoShare when refMode is noRef", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "noRef" as const,
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(flags.hasNoShare).toBe(true);
  });

  test("not hasNoShare when refMode is configured", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(flags.hasNoShare).toBe(false);
  });

  test("not hasNoShare when refMode is gone", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(flags.hasNoShare).toBe(false);
  });

  test("isBehindShare when toPull > 0", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 0,
          toPull: 3,
        },
      }),
      "feature",
    );
    expect(flags.isBehindShare).toBe(true);
  });

  test("isBehindShare is false when all pull commits are replaced", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 1,
          toPull: 1,
          outdated: { total: 1, rebased: 0, replaced: 1, squashed: 0 },
        },
      }),
      "feature",
    );
    expect(flags.isBehindShare).toBe(false);
  });

  test("isBehindShare is false when all pull commits are rebased + replaced", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 3,
          toPull: 3,
          outdated: { total: 3, rebased: 2, replaced: 1, squashed: 0 },
        },
      }),
      "feature",
    );
    expect(flags.isBehindShare).toBe(false);
  });

  test("isBehindShare is true when some pull commits are genuinely new despite replaced", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 3,
          outdated: { total: 1, rebased: 0, replaced: 1, squashed: 0 },
        },
      }),
      "feature",
    );
    expect(flags.isBehindShare).toBe(true);
  });

  test("isBehindShare is false when all pull commits are squashed", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 1,
          toPull: 3,
          outdated: { total: 3, rebased: 0, replaced: 0, squashed: 3 },
        },
      }),
      "feature",
    );
    expect(flags.isBehindShare).toBe(false);
  });

  test("isBehindShare is true when squashed only partially covers pull", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 1,
          toPull: 3,
          outdated: { total: 1, rebased: 0, replaced: 0, squashed: 1 },
        },
      }),
      "feature",
    );
    expect(flags.isBehindShare).toBe(true);
  });

  test("isBehindBase when behind base", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flags.isBehindBase).toBe(true);
  });

  test("isDiverged when both ahead and behind base", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 2,
          behind: 3,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flags.isDiverged).toBe(true);
  });

  test("not isDiverged when only behind base", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flags.isDiverged).toBe(false);
  });

  test("not isDiverged when only ahead of base", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 3,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flags.isDiverged).toBe(false);
  });

  test("not isDiverged when base is null", () => {
    const flags = computeFlags(makeRepo({ base: null }), "feature");
    expect(flags.isDiverged).toBe(false);
  });

  test("isWrongBranch when on a different branch", () => {
    const flags = computeFlags(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
      }),
      "feature",
    );
    expect(flags.isWrongBranch).toBe(true);
  });

  test("isDetached when HEAD is detached", () => {
    const flags = computeFlags(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
      }),
      "feature",
    );
    expect(flags.isDetached).toBe(true);
    expect(flags.isWrongBranch).toBe(false);
  });

  test("hasOperation when operation is in progress", () => {
    const flags = computeFlags(makeRepo({ operation: "rebase" }), "feature");
    expect(flags.hasOperation).toBe(true);
  });

  test("isGone when refMode is gone", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(flags.isGone).toBe(true);
  });

  test("isShallow when identity.shallow is true", () => {
    const flags = computeFlags(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
      }),
      "feature",
    );
    expect(flags.isShallow).toBe(true);
  });

  test("isMerged when mergedIntoBase is ancestor", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 0,
          merge: { kind: "merge" },
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flags.isMerged).toBe(true);
  });

  test("isMerged when mergedIntoBase is squash", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 2,
          behind: 0,
          merge: { kind: "squash" },
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flags.isMerged).toBe(true);
  });

  test("not isMerged when mergedIntoBase is null", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(flags.isMerged).toBe(false);
  });

  test("not isMerged when base is null", () => {
    const flags = computeFlags(makeRepo({ base: null }), "feature");
    expect(flags.isMerged).toBe(false);
  });

  test("isBaseMerged when baseMergedIntoDefault is merge", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "feat/auth",
          configuredRef: null,
          ahead: 0,
          behind: 3,
          baseMergedIntoDefault: "merge",
        },
      }),
      "feature",
    );
    expect(flags.isBaseMerged).toBe(true);
  });

  test("isBaseMerged when baseMergedIntoDefault is squash", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "feat/auth",
          configuredRef: null,
          ahead: 0,
          behind: 3,
          baseMergedIntoDefault: "squash",
        },
      }),
      "feature",
    );
    expect(flags.isBaseMerged).toBe(true);
  });

  test("not isBaseMerged when baseMergedIntoDefault is null", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(flags.isBaseMerged).toBe(false);
  });

  test("not isBaseMerged when base is null", () => {
    const flags = computeFlags(makeRepo({ base: null }), "feature");
    expect(flags.isBaseMerged).toBe(false);
  });

  test("isBaseMissing when configuredRef set and baseMergedIntoDefault is null", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: "feat/auth",
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flags.isBaseMissing).toBe(true);
    expect(flags.isBaseMerged).toBe(false);
  });

  test("not isBaseMissing when configuredRef set but baseMergedIntoDefault is merge", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: "feat/auth",
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: "merge",
        },
      }),
      "feature",
    );
    expect(flags.isBaseMissing).toBe(false);
    expect(flags.isBaseMerged).toBe(true);
  });

  test("not isBaseMissing when configuredRef set but baseMergedIntoDefault is squash", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: "feat/auth",
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: "squash",
        },
      }),
      "feature",
    );
    expect(flags.isBaseMissing).toBe(false);
    expect(flags.isBaseMerged).toBe(true);
  });

  test("not isBaseMissing when configuredRef is null", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(flags.isBaseMissing).toBe(false);
  });

  test("not isBaseMissing when base is null", () => {
    const flags = computeFlags(makeRepo({ base: null }), "feature");
    expect(flags.isBaseMissing).toBe(false);
  });
});

describe("isAtRisk", () => {
  test("returns false when all flags are false", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(isAtRisk(flags)).toBe(false);
  });

  test("returns true when isDirty", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(isAtRisk(flags)).toBe(true);
  });

  test("returns true when isShallow", () => {
    const flags = computeFlags(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
      }),
      "feature",
    );
    expect(isAtRisk(flags)).toBe(true);
  });

  test("returns false when only isBehindBase (stale, not at-risk)", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 1,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(isAtRisk(flags)).toBe(false);
  });

  test("returns false when only isDiverged (stale, not at-risk)", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 2,
          behind: 3,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(isAtRisk(flags)).toBe(false);
  });

  test("returns false when only isBehindShare (stale, not at-risk)", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 0,
          toPull: 3,
        },
      }),
      "feature",
    );
    expect(isAtRisk(flags)).toBe(false);
  });

  test("returns false when only isGone (lifecycle, not at-risk)", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(isAtRisk(flags)).toBe(false);
  });

  test("returns false when only isMerged", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 0,
          merge: { kind: "squash" },
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(isAtRisk(flags)).toBe(false);
  });

  test("returns true when isBaseMerged", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "feat/auth",
          configuredRef: null,
          ahead: 0,
          behind: 3,
          baseMergedIntoDefault: "merge",
        },
      }),
      "feature",
    );
    expect(isAtRisk(flags)).toBe(true);
  });
});

describe("flagLabels", () => {
  test("returns empty array for clean repo", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(flagLabels(flags)).toEqual([]);
  });

  test("returns correct labels for dirty + ahead share repo", () => {
    const flags = computeFlags(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
      "feature",
    );
    expect(flagLabels(flags)).toEqual(["dirty", "ahead share"]);
  });

  test("returns all relevant labels for multiple issues", () => {
    const flags = computeFlags(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          baseMergedIntoDefault: null,
        },
        operation: "rebase",
      }),
      "feature",
    );
    expect(flagLabels(flags)).toEqual(["dirty", "operation", "shallow", "behind base"]);
  });

  test("returns diverged label when both ahead and behind base", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 2,
          behind: 3,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flagLabels(flags)).toEqual(["diverged", "behind base"]);
  });

  test("includes merged label when isMerged", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 0,
          merge: { kind: "squash" },
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flagLabels(flags)).toContain("merged");
  });

  test("puts merged and gone first when mixed with other labels", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          merge: { kind: "squash" },
          baseMergedIntoDefault: null,
        },
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(flagLabels(flags)).toEqual(["merged", "gone"]);
  });

  test("puts work-safety labels before lifecycle labels when both exist", () => {
    const flags = computeFlags(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          merge: { kind: "squash" },
          baseMergedIntoDefault: null,
        },
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(flagLabels(flags)).toEqual(["dirty", "merged", "gone"]);
  });

  test("includes base merged label when isBaseMerged", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "feat/auth",
          configuredRef: null,
          ahead: 0,
          behind: 3,
          baseMergedIntoDefault: "merge",
        },
      }),
      "feature",
    );
    expect(flagLabels(flags)).toContain("base merged");
  });

  test("suppresses behind-base when merged (ancestor merge)", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 5,
          merge: { kind: "merge" },
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flagLabels(flags)).toEqual(["merged"]);
    expect(flagLabels(flags)).not.toContain("behind base");
  });

  test("suppresses diverged and behind-base when merged (squash merge)", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 3,
          behind: 5,
          merge: { kind: "squash" },
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flagLabels(flags)).toEqual(["merged"]);
    expect(flagLabels(flags)).not.toContain("diverged");
    expect(flagLabels(flags)).not.toContain("behind base");
  });

  test("does NOT suppress diverged when not merged", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 2,
          behind: 3,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flagLabels(flags)).toContain("diverged");
    expect(flagLabels(flags)).toContain("behind base");
  });
});

describe("wouldLoseWork", () => {
  test("returns false for clean, equal repo", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(wouldLoseWork(flags)).toBe(false);
  });

  test("returns true when isDirty", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(wouldLoseWork(flags)).toBe(true);
  });

  test("returns true when isAheadOfShare", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
      "feature",
    );
    expect(wouldLoseWork(flags)).toBe(true);
  });

  test("returns true when isDetached", () => {
    const flags = computeFlags(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
      }),
      "feature",
    );
    expect(wouldLoseWork(flags)).toBe(true);
  });

  test("returns true when on wrong branch", () => {
    const flags = computeFlags(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
      }),
      "feature",
    );
    expect(wouldLoseWork(flags)).toBe(true);
  });

  test("returns true when hasOperation", () => {
    const flags = computeFlags(makeRepo({ operation: "rebase" }), "feature");
    expect(wouldLoseWork(flags)).toBe(true);
  });

  test("returns false when only isBehindShare", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 0,
          toPull: 3,
        },
      }),
      "feature",
    );
    expect(wouldLoseWork(flags)).toBe(false);
  });

  test("returns false when only isBehindBase", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(wouldLoseWork(flags)).toBe(false);
  });

  test("returns false when isDiverged", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 2,
          behind: 3,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(wouldLoseWork(flags)).toBe(false);
  });

  test("returns false when isShallow", () => {
    const flags = computeFlags(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
      }),
      "feature",
    );
    expect(wouldLoseWork(flags)).toBe(false);
  });

  test("returns false when share has noRef and no base", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "noRef" as const,
          toPush: null,
          toPull: null,
        },
        base: null,
      }),
      "feature",
    );
    expect(wouldLoseWork(flags)).toBe(false);
  });

  test("returns false when isGone (without unpushed commits)", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(wouldLoseWork(flags)).toBe(false);
  });
});

describe("isWorkspaceSafe", () => {
  test("returns true for clean repos", () => {
    const repos = [makeRepo({ name: "a" }), makeRepo({ name: "b" })];
    expect(isWorkspaceSafe(repos, "feature")).toBe(true);
  });

  test("returns false when a repo is dirty", () => {
    const repos = [makeRepo({ name: "dirty", local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } })];
    expect(isWorkspaceSafe(repos, "feature")).toBe(false);
  });

  test("returns false when a repo has unpushed commits", () => {
    const repos = [
      makeRepo({
        name: "unpushed",
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
    ];
    expect(isWorkspaceSafe(repos, "feature")).toBe(false);
  });

  test("returns false when a repo has unpushed commits via noRef share", () => {
    const repos = [
      makeRepo({
        name: "noref-with-commits",
        share: {
          remote: "origin",
          ref: null,
          refMode: "noRef" as const,
          toPush: null,
          toPull: null,
        },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 3,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
    ];
    expect(isWorkspaceSafe(repos, "feature")).toBe(false);
  });

  test("returns true when repos are behind base (safe to remove)", () => {
    const repos = [
      makeRepo({
        name: "behind",
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 5,
          baseMergedIntoDefault: null,
        },
      }),
    ];
    expect(isWorkspaceSafe(repos, "feature")).toBe(true);
  });

  test("returns true when repos are gone (safe to remove)", () => {
    const repos = [
      makeRepo({
        name: "gone",
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
    ];
    expect(isWorkspaceSafe(repos, "feature")).toBe(true);
  });

  test("returns true when repos are shallow (safe to remove)", () => {
    const repos = [
      makeRepo({
        name: "shallow",
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
      }),
    ];
    expect(isWorkspaceSafe(repos, "feature")).toBe(true);
  });

  test("returns false when a repo is detached", () => {
    const repos = [
      makeRepo({
        name: "detached",
        identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
      }),
    ];
    expect(isWorkspaceSafe(repos, "feature")).toBe(false);
  });

  test("returns false when a repo is on wrong branch", () => {
    const repos = [
      makeRepo({
        name: "wrong-branch",
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
      }),
    ];
    expect(isWorkspaceSafe(repos, "feature")).toBe(false);
  });
});

describe("computeSummaryAggregates decoupled display gate", () => {
  test("statusCounts puts work-safety labels before lifecycle labels", () => {
    const repos = [
      makeRepo({
        name: "mixed",
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          merge: { kind: "squash" },
          baseMergedIntoDefault: null,
        },
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.statusCounts.map((c) => c.label)).toEqual(["dirty", "merged", "gone"]);
  });

  test("statusCounts includes stale flags even when not at-risk", () => {
    const repos = [
      makeRepo({
        name: "behind-base",
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          baseMergedIntoDefault: null,
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.atRiskCount).toBe(0);
    expect(result.statusCounts.some((c) => c.key === "isBehindBase")).toBe(true);
  });

  test("statusCounts includes gone flag even when not at-risk", () => {
    const repos = [
      makeRepo({
        name: "gone-repo",
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.atRiskCount).toBe(0);
    expect(result.statusCounts.some((c) => c.key === "isGone")).toBe(true);
  });

  test("suppresses implied flags for merged repos but keeps them for non-merged repos", () => {
    const repos = [
      // Merged repo: behind base should be suppressed
      makeRepo({
        name: "merged-repo",
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 3,
          behind: 5,
          merge: { kind: "squash" },
          baseMergedIntoDefault: null,
        },
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
      // Non-merged repo: behind base should be kept
      makeRepo({
        name: "stale-repo",
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          baseMergedIntoDefault: null,
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    // "behind base" should appear with count 1 (only the non-merged repo)
    const behindBase = result.statusCounts.find((c) => c.key === "isBehindBase");
    expect(behindBase).toBeDefined();
    expect(behindBase?.count).toBe(1);
    // "diverged" should not appear (only the merged repo had it, and it's suppressed)
    const diverged = result.statusCounts.find((c) => c.key === "isDiverged");
    expect(diverged).toBeUndefined();
    // "merged" and "gone" should appear
    expect(result.statusCounts.some((c) => c.label === "merged")).toBe(true);
    expect(result.statusCounts.some((c) => c.label === "gone")).toBe(true);
    expect(result.statusCounts.some((c) => c.label === "behind base")).toBe(true);
  });

  test("atRiskCount only counts repos with at-risk flags", () => {
    const repos = [
      makeRepo({
        name: "dirty",
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
      }),
      makeRepo({
        name: "behind-base",
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          baseMergedIntoDefault: null,
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.atRiskCount).toBe(1);
    expect(result.statusCounts.length).toBe(2); // dirty + behind base
  });
});

describe("computeSummaryAggregates outdatedOnlyCount", () => {
  test("returns 0 when no repos are rebased", () => {
    const repos = [
      makeRepo({
        name: "a",
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.outdatedOnlyCount).toBe(0);
  });

  test("counts repos where all unpushed commits are rebased", () => {
    const repos = [
      makeRepo({
        name: "rebased-only",
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 2,
          outdated: { total: 2, rebased: 2, replaced: 0, squashed: 0 },
        },
      }),
      makeRepo({
        name: "has-new",
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 3,
          toPull: 2,
          outdated: { total: 2, rebased: 2, replaced: 0, squashed: 0 },
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.outdatedOnlyCount).toBe(1);
  });

  test("returns 0 when outdated is absent", () => {
    const repos = [
      makeRepo({
        name: "a",
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 2,
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.outdatedOnlyCount).toBe(0);
  });

  test("counts repos where all unpushed commits are replaced (no rebased)", () => {
    const repos = [
      makeRepo({
        name: "a",
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 1,
          toPull: 1,
          outdated: { total: 1, rebased: 0, replaced: 1, squashed: 0 },
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.outdatedOnlyCount).toBe(1);
  });

  test("counts repos where all unpushed commits are rebased + replaced combined", () => {
    const repos = [
      makeRepo({
        name: "a",
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 3,
          toPull: 3,
          outdated: { total: 3, rebased: 2, replaced: 1, squashed: 0 },
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.outdatedOnlyCount).toBe(1);
  });

  test("does not count repos where outdated is absent and toPush is zero", () => {
    const repos = [
      makeRepo({
        name: "a",
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 0,
          toPull: 0,
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.outdatedOnlyCount).toBe(0);
  });

  test("does not count repos where replaced + rebased < toPush", () => {
    const repos = [
      makeRepo({
        name: "a",
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 5,
          toPull: 2,
          outdated: { total: 2, rebased: 1, replaced: 1, squashed: 0 },
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.outdatedOnlyCount).toBe(0);
  });

  test("counts repos where all unpushed commits are squashed", () => {
    const repos = [
      makeRepo({
        name: "a",
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 1,
          toPull: 2,
          outdated: { total: 2, rebased: 0, replaced: 0, squashed: 2 },
        },
      }),
    ];
    const result = computeSummaryAggregates(repos, "feature");
    expect(result.outdatedOnlyCount).toBe(1);
  });
});

describe("formatStatusCounts with outdated", () => {
  test("shows yellow ahead share when no outdated repos", () => {
    const statusCounts = [{ label: "ahead share", count: 3, key: "isAheadOfShare" as const }];
    const result = formatStatusCounts(statusCounts, 0);
    expect(result).toContain("ahead share");
  });

  test("shows outdated instead of ahead share when all are outdated-only", () => {
    const statusCounts = [{ label: "ahead share", count: 3, key: "isAheadOfShare" as const }];
    const result = formatStatusCounts(statusCounts, 3);
    expect(result).toBe("outdated");
  });

  test("shows both ahead share and outdated when mixed", () => {
    const statusCounts = [{ label: "ahead share", count: 3, key: "isAheadOfShare" as const }];
    const result = formatStatusCounts(statusCounts, 2);
    expect(result).toContain("ahead share");
    expect(result).toContain("outdated");
  });

  test("does not affect non-ahead-share labels", () => {
    const statusCounts = [{ label: "dirty", count: 2, key: "isDirty" as const }];
    const result = formatStatusCounts(statusCounts, 1);
    expect(result).toContain("dirty");
    expect(result).not.toContain("outdated");
  });

  test("uses custom yellowKeys when provided", () => {
    const statusCounts = [
      { label: "dirty", count: 1, key: "isDirty" as const },
      { label: "shallow", count: 1, key: "isShallow" as const },
    ];
    // LOSE_WORK_FLAGS includes isDirty but not isShallow
    const result = formatStatusCounts(statusCounts, 0, LOSE_WORK_FLAGS);
    // dirty should be yellow (contains ANSI), shallow should be plain
    expect(result).toContain("dirty");
    expect(result).toContain("shallow");
  });
});

describe("flag set alignment", () => {
  test("LOSE_WORK_FLAGS is a subset of AT_RISK_FLAGS", () => {
    for (const flag of LOSE_WORK_FLAGS) {
      expect(AT_RISK_FLAGS.has(flag)).toBe(true);
    }
  });

  test("MERGED_IMPLIED_FLAGS is a subset of STALE_FLAGS", () => {
    for (const flag of MERGED_IMPLIED_FLAGS) {
      expect(STALE_FLAGS.has(flag)).toBe(true);
    }
  });
});

describe("flag invariants", () => {
  // ── Branch dimension: isDetached and isWrongBranch are mutually exclusive ──

  test("detached HEAD excludes isWrongBranch", () => {
    const flags = computeFlags(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
      }),
      "feature",
    );
    expect(flags.isDetached).toBe(true);
    expect(flags.isWrongBranch).toBe(false);
  });

  test("wrong branch excludes isDetached", () => {
    const flags = computeFlags(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
      }),
      "feature",
    );
    expect(flags.isWrongBranch).toBe(true);
    expect(flags.isDetached).toBe(false);
  });

  // ── Share lifecycle dimension: hasNoShare and isGone are mutually exclusive ──

  test("noRef share excludes isGone", () => {
    const flags = computeFlags(
      makeRepo({
        share: { remote: "origin", ref: null, refMode: "noRef" as const, toPush: null, toPull: null },
      }),
      "feature",
    );
    expect(flags.hasNoShare).toBe(true);
    expect(flags.isGone).toBe(false);
  });

  test("gone share excludes hasNoShare", () => {
    const flags = computeFlags(
      makeRepo({
        share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null },
      }),
      "feature",
    );
    expect(flags.isGone).toBe(true);
    expect(flags.hasNoShare).toBe(false);
  });

  // ── Base position dimension: isDiverged implies isAheadOfBase and isBehindBase ──

  test("diverged implies both isAheadOfBase and isBehindBase", () => {
    const flags = computeFlags(
      makeRepo({
        base: { remote: "origin", ref: "main", configuredRef: null, ahead: 2, behind: 3, baseMergedIntoDefault: null },
      }),
      "feature",
    );
    expect(flags.isDiverged).toBe(true);
    expect(flags.isAheadOfBase).toBe(true);
    expect(flags.isBehindBase).toBe(true);
  });

  test("ahead-only does not set isDiverged", () => {
    const flags = computeFlags(
      makeRepo({
        base: { remote: "origin", ref: "main", configuredRef: null, ahead: 3, behind: 0, baseMergedIntoDefault: null },
      }),
      "feature",
    );
    expect(flags.isAheadOfBase).toBe(true);
    expect(flags.isBehindBase).toBe(false);
    expect(flags.isDiverged).toBe(false);
  });

  test("behind-only does not set isDiverged", () => {
    const flags = computeFlags(
      makeRepo({
        base: { remote: "origin", ref: "main", configuredRef: null, ahead: 0, behind: 5, baseMergedIntoDefault: null },
      }),
      "feature",
    );
    expect(flags.isBehindBase).toBe(true);
    expect(flags.isAheadOfBase).toBe(false);
    expect(flags.isDiverged).toBe(false);
  });

  // ── Local dimension: sub-flags imply isDirty ──

  test("hasConflict implies isDirty", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 0, untracked: 0, conflicts: 3 } }), "feature");
    expect(flags.hasConflict).toBe(true);
    expect(flags.isDirty).toBe(true);
  });

  test("hasStaged implies isDirty", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 2, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(flags.hasStaged).toBe(true);
    expect(flags.isDirty).toBe(true);
  });

  test("hasModified implies isDirty", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 3, untracked: 0, conflicts: 0 } }), "feature");
    expect(flags.hasModified).toBe(true);
    expect(flags.isDirty).toBe(true);
  });

  test("hasUntracked implies isDirty", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 0, untracked: 1, conflicts: 0 } }), "feature");
    expect(flags.hasUntracked).toBe(true);
    expect(flags.isDirty).toBe(true);
  });

  // ── Share position exclusions: noRef/gone exclude isBehindShare ──

  test("noRef share excludes isBehindShare", () => {
    const flags = computeFlags(
      makeRepo({
        share: { remote: "origin", ref: null, refMode: "noRef" as const, toPush: null, toPull: null },
      }),
      "feature",
    );
    expect(flags.hasNoShare).toBe(true);
    expect(flags.isBehindShare).toBe(false);
  });

  test("gone share excludes isBehindShare", () => {
    const flags = computeFlags(
      makeRepo({
        share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null },
      }),
      "feature",
    );
    expect(flags.isGone).toBe(true);
    expect(flags.isBehindShare).toBe(false);
  });

  // ── Base lifecycle dimension: isBaseMerged and isBaseMissing are mutually exclusive ──

  test("isBaseMerged excludes isBaseMissing", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: "feat/auth",
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: "merge",
        },
      }),
      "feature",
    );
    expect(flags.isBaseMerged).toBe(true);
    expect(flags.isBaseMissing).toBe(false);
  });

  test("isBaseMissing excludes isBaseMerged", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: "feat/auth",
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(flags.isBaseMissing).toBe(true);
    expect(flags.isBaseMerged).toBe(false);
  });
});
