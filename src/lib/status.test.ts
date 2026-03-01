import { describe, expect, test } from "bun:test";
import {
	AT_RISK_FLAGS,
	LOSE_WORK_FLAGS,
	MERGED_IMPLIED_FLAGS,
	type RepoStatus,
	STALE_FLAGS,
	computeFlags,
	computeSummaryAggregates,
	flagLabels,
	formatStatusCounts,
	isAtRisk,
	isWorkspaceSafe,
	repoMatchesWhere,
	validateWhere,
	workspaceMatchesWhere,
	wouldLoseWork,
} from "./status";
import { makeRepo } from "./test-helpers";

describe("computeFlags", () => {
	test("all false for clean, equal, on-branch repo", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(flags).toEqual({
			isDirty: false,
			isUnpushed: false,
			needsPull: false,
			needsRebase: false,
			isDiverged: false,
			isDrifted: false,
			isDetached: false,
			hasOperation: false,
			isGone: false,
			isShallow: false,
			isMerged: false,
			isBaseMerged: false,
			baseFellBack: false,
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

	test("isUnpushed when toPush > 0", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
			"feature",
		);
		expect(flags.isUnpushed).toBe(true);
	});

	test("isUnpushed when noRef with base.ahead > 0", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "noRef", toPush: null, toPull: null, rebased: null },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 3,
					behind: 0,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(flags.isUnpushed).toBe(true);
	});

	test("not isUnpushed when gone even with base.ahead > 0", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 3,
					behind: 0,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(flags.isUnpushed).toBe(false);
		expect(flags.isGone).toBe(true);
	});

	test("not isUnpushed when up to date with remote", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(flags.isUnpushed).toBe(false);
	});

	test("not isUnpushed when share has no ref and no base ahead", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "noRef" as const, toPush: null, toPull: null, rebased: null },
			}),
			"feature",
		);
		expect(flags.isUnpushed).toBe(false);
	});

	test("needsPull when toPull > 0", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
			}),
			"feature",
		);
		expect(flags.needsPull).toBe(true);
	});

	test("needsRebase when behind base", () => {
		const flags = computeFlags(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 2,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(flags.needsRebase).toBe(true);
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
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

	test("isDrifted when on wrong branch", () => {
		const flags = computeFlags(
			makeRepo({
				identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
			}),
			"feature",
		);
		expect(flags.isDrifted).toBe(true);
	});

	test("isDetached when HEAD is detached", () => {
		const flags = computeFlags(
			makeRepo({
				identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
			}),
			"feature",
		);
		expect(flags.isDetached).toBe(true);
	});

	test("hasOperation when operation is in progress", () => {
		const flags = computeFlags(makeRepo({ operation: "rebase" }), "feature");
		expect(flags.hasOperation).toBe(true);
	});

	test("isGone when refMode is gone", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
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
					mergedIntoBase: "merge",
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: "squash",
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: null,
					baseMergedIntoDefault: "merge",
					detectedPr: null,
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
					mergedIntoBase: null,
					baseMergedIntoDefault: "squash",
					detectedPr: null,
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

	test("returns false when only needsRebase (stale, not at-risk)", () => {
		const flags = computeFlags(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 1,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(isAtRisk(flags)).toBe(false);
	});

	test("returns false when only needsPull (stale, not at-risk)", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
			}),
			"feature",
		);
		expect(isAtRisk(flags)).toBe(false);
	});

	test("returns false when only isGone (lifecycle, not at-risk)", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
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
					mergedIntoBase: "squash",
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: null,
					baseMergedIntoDefault: "merge",
					detectedPr: null,
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

	test("returns correct labels for dirty + unpushed repo", () => {
		const flags = computeFlags(
			makeRepo({
				local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
			"feature",
		);
		expect(flagLabels(flags)).toEqual(["dirty", "unpushed"]);
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: "squash",
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: "squash",
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
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
					mergedIntoBase: "squash",
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
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
					mergedIntoBase: null,
					baseMergedIntoDefault: "merge",
					detectedPr: null,
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
					mergedIntoBase: "merge",
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: "squash",
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
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

	test("returns true when isUnpushed", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
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

	test("returns true when isDrifted", () => {
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

	test("returns false when only needsPull", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
			}),
			"feature",
		);
		expect(wouldLoseWork(flags)).toBe(false);
	});

	test("returns false when only needsRebase", () => {
		const flags = computeFlags(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 2,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
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
				share: { remote: "origin", ref: null, refMode: "noRef" as const, toPush: null, toPull: null, rebased: null },
				base: null,
			}),
			"feature",
		);
		expect(wouldLoseWork(flags)).toBe(false);
	});

	test("returns false when isGone (without unpushed commits)", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 0,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(wouldLoseWork(flags)).toBe(false);
	});
});

describe("validateWhere", () => {
	test("returns null for valid single term", () => {
		expect(validateWhere("dirty")).toBeNull();
	});

	test("returns null for valid comma-separated terms", () => {
		expect(validateWhere("dirty,gone,unpushed")).toBeNull();
	});

	test("returns null for at-risk derived term", () => {
		expect(validateWhere("at-risk")).toBeNull();
	});

	test("returns null for all valid terms", () => {
		expect(
			validateWhere(
				"dirty,unpushed,behind-share,behind-base,diverged,drifted,detached,operation,gone,shallow,merged,base-merged,base-missing,at-risk,stale,clean,pushed,synced-base,synced-share,synced,safe",
			),
		).toBeNull();
	});

	test("returns null for stale term", () => {
		expect(validateWhere("stale")).toBeNull();
	});

	test("returns null for merged term", () => {
		expect(validateWhere("merged")).toBeNull();
	});

	test("returns null for base-merged term", () => {
		expect(validateWhere("base-merged")).toBeNull();
	});

	test("returns error for invalid term", () => {
		const err = validateWhere("invalid");
		expect(err).toContain("Unknown filter term: invalid");
		expect(err).toContain("Valid terms:");
	});

	test("returns error for multiple invalid terms", () => {
		const err = validateWhere("foo,bar");
		expect(err).toContain("Unknown filter terms: foo, bar");
	});

	test("returns error when mix of valid and invalid", () => {
		const err = validateWhere("dirty,nope");
		expect(err).toContain("Unknown filter term: nope");
	});

	test("returns null for valid AND expression", () => {
		expect(validateWhere("dirty+unpushed")).toBeNull();
	});

	test("returns null for mixed AND/OR expression", () => {
		expect(validateWhere("dirty+unpushed,gone")).toBeNull();
	});

	test("returns error for invalid term in AND group", () => {
		const err = validateWhere("dirty+invalid");
		expect(err).toContain("Unknown filter term: invalid");
	});

	test("returns error for invalid term in mixed AND/OR", () => {
		const err = validateWhere("dirty+unpushed,invalid");
		expect(err).toContain("Unknown filter term: invalid");
	});
});

describe("repoMatchesWhere", () => {
	test("matches dirty repo", () => {
		const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
		expect(repoMatchesWhere(flags, "dirty")).toBe(true);
	});

	test("does not match clean repo for dirty", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "dirty")).toBe(false);
	});

	test("matches with comma OR — first term matches", () => {
		const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
		expect(repoMatchesWhere(flags, "dirty,gone")).toBe(true);
	});

	test("matches with comma OR — second term matches", () => {
		const flags = computeFlags(
			makeRepo({ share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null } }),
			"feature",
		);
		expect(repoMatchesWhere(flags, "dirty,gone")).toBe(true);
	});

	test("does not match when no terms match", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "dirty,gone")).toBe(false);
	});

	test("matches at-risk derived term", () => {
		const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
		expect(repoMatchesWhere(flags, "at-risk")).toBe(true);
	});

	test("at-risk does not match clean repo", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "at-risk")).toBe(false);
	});

	test("AND matches when both terms true", () => {
		const flags = computeFlags(
			makeRepo({
				local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "dirty+unpushed")).toBe(true);
	});

	test("AND fails when only one term true", () => {
		const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
		expect(repoMatchesWhere(flags, "dirty+unpushed")).toBe(false);
	});

	test("mixed AND/OR — first AND group matches", () => {
		const flags = computeFlags(
			makeRepo({
				local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "dirty+unpushed,gone")).toBe(true);
	});

	test("mixed AND/OR — second OR term matches", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "dirty+unpushed,gone")).toBe(true);
	});

	test("mixed AND/OR — neither group matches", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "dirty+unpushed,gone")).toBe(false);
	});

	test("AND with aggregate term", () => {
		const flags = computeFlags(
			makeRepo({
				local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "at-risk+unpushed")).toBe(true);
	});

	test("matches each raw flag term", () => {
		const cases: [string, Partial<RepoStatus>][] = [
			[
				"unpushed",
				{
					share: {
						remote: "origin",
						ref: "origin/feature",
						refMode: "configured",
						toPush: 2,
						toPull: 0,
						rebased: null,
					},
				},
			],
			[
				"behind-share",
				{
					share: {
						remote: "origin",
						ref: "origin/feature",
						refMode: "configured",
						toPush: 0,
						toPull: 3,
						rebased: null,
					},
				},
			],
			[
				"behind-base",
				{
					base: {
						remote: "origin",
						ref: "main",
						configuredRef: null,
						ahead: 0,
						behind: 2,
						mergedIntoBase: null,
						baseMergedIntoDefault: null,
						detectedPr: null,
					},
				},
			],
			[
				"diverged",
				{
					base: {
						remote: "origin",
						ref: "main",
						configuredRef: null,
						ahead: 2,
						behind: 3,
						mergedIntoBase: null,
						baseMergedIntoDefault: null,
						detectedPr: null,
					},
				},
			],
			[
				"drifted",
				{ identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false } },
			],
			["detached", { identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false } }],
			["operation", { operation: "rebase" }],

			["gone", { share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null } }],
			[
				"shallow",
				{ identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true } },
			],
			[
				"merged",
				{
					base: {
						remote: "origin",
						ref: "main",
						configuredRef: null,
						ahead: 0,
						behind: 0,
						mergedIntoBase: "squash",
						baseMergedIntoDefault: null,
						detectedPr: null,
					},
				},
			],
			[
				"base-merged",
				{
					base: {
						remote: "origin",
						ref: "feat/auth",
						configuredRef: null,
						ahead: 0,
						behind: 3,
						mergedIntoBase: null,
						baseMergedIntoDefault: "merge",
						detectedPr: null,
					},
				},
			],
			[
				"base-missing",
				{
					base: {
						remote: "origin",
						ref: "main",
						configuredRef: "feat/auth",
						ahead: 1,
						behind: 0,
						mergedIntoBase: null,
						baseMergedIntoDefault: null,
						detectedPr: null,
					},
				},
			],
		];
		for (const [term, overrides] of cases) {
			const flags = computeFlags(makeRepo(overrides), "feature");
			expect(repoMatchesWhere(flags, term)).toBe(true);
		}
	});
});

describe("workspaceMatchesWhere", () => {
	test("matches when any repo matches (ANY-repo semantics)", () => {
		const repos = [
			makeRepo({ name: "clean-repo" }),
			makeRepo({ name: "dirty-repo", local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
		];
		expect(workspaceMatchesWhere(repos, "feature", "dirty")).toBe(true);
	});

	test("does not match when no repos match", () => {
		const repos = [makeRepo({ name: "clean-a" }), makeRepo({ name: "clean-b" })];
		expect(workspaceMatchesWhere(repos, "feature", "dirty")).toBe(false);
	});

	test("at-risk does not match workspace with only gone repos", () => {
		const repos = [
			makeRepo({ name: "clean-repo" }),
			makeRepo({
				name: "gone-repo",
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
			}),
		];
		expect(workspaceMatchesWhere(repos, "feature", "at-risk")).toBe(false);
	});

	test("AND is per-repo — workspace with dirty repo-a and unpushed repo-b does NOT match dirty+unpushed", () => {
		const repos = [
			makeRepo({ name: "repo-a", local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
			makeRepo({
				name: "repo-b",
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
		];
		expect(workspaceMatchesWhere(repos, "feature", "dirty+unpushed")).toBe(false);
	});

	test("AND matches workspace when single repo satisfies all terms", () => {
		const repos = [
			makeRepo({ name: "clean-repo" }),
			makeRepo({
				name: "dirty-unpushed-repo",
				local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
		];
		expect(workspaceMatchesWhere(repos, "feature", "dirty+unpushed")).toBe(true);
	});

	test("matches at-risk across repos when dirty", () => {
		const repos = [
			makeRepo({ name: "clean-repo" }),
			makeRepo({
				name: "dirty-repo",
				local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
			}),
		];
		expect(workspaceMatchesWhere(repos, "feature", "at-risk")).toBe(true);
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
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
		];
		expect(isWorkspaceSafe(repos, "feature")).toBe(false);
	});

	test("returns false when a repo has unpushed commits via noRef share", () => {
		const repos = [
			makeRepo({
				name: "noref-with-commits",
				share: { remote: "origin", ref: null, refMode: "noRef" as const, toPush: null, toPull: null, rebased: null },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 3,
					behind: 0,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
		];
		expect(isWorkspaceSafe(repos, "feature")).toBe(true);
	});

	test("returns true when repos are gone (safe to remove)", () => {
		const repos = [
			makeRepo({
				name: "gone",
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
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

	test("returns false when a repo is drifted", () => {
		const repos = [
			makeRepo({
				name: "drifted",
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
					mergedIntoBase: "squash",
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
			}),
		];
		const result = computeSummaryAggregates(repos, "feature");
		expect(result.statusCounts.map((c) => c.label)).toEqual(["dirty", "merged", "gone"]);
		expect(result.statusLabels).toEqual(["dirty", "merged", "gone"]);
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
		];
		const result = computeSummaryAggregates(repos, "feature");
		expect(result.atRiskCount).toBe(0);
		expect(result.statusCounts.some((c) => c.key === "needsRebase")).toBe(true);
		expect(result.statusLabels).toContain("behind base");
	});

	test("statusCounts includes gone flag even when not at-risk", () => {
		const repos = [
			makeRepo({
				name: "gone-repo",
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
			}),
		];
		const result = computeSummaryAggregates(repos, "feature");
		expect(result.atRiskCount).toBe(0);
		expect(result.statusCounts.some((c) => c.key === "isGone")).toBe(true);
		expect(result.statusLabels).toContain("gone");
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
					mergedIntoBase: "squash",
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
		];
		const result = computeSummaryAggregates(repos, "feature");
		// "behind base" should appear with count 1 (only the non-merged repo)
		const behindBase = result.statusCounts.find((c) => c.key === "needsRebase");
		expect(behindBase).toBeDefined();
		expect(behindBase?.count).toBe(1);
		// "diverged" should not appear (only the merged repo had it, and it's suppressed)
		const diverged = result.statusCounts.find((c) => c.key === "isDiverged");
		expect(diverged).toBeUndefined();
		// "merged" and "gone" should appear
		expect(result.statusLabels).toContain("merged");
		expect(result.statusLabels).toContain("gone");
		expect(result.statusLabels).toContain("behind base");
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
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
		];
		const result = computeSummaryAggregates(repos, "feature");
		expect(result.atRiskCount).toBe(1);
		expect(result.statusCounts.length).toBe(2); // dirty + behind base
	});
});

describe("computeSummaryAggregates rebasedOnlyCount", () => {
	test("returns 0 when no repos are rebased", () => {
		const repos = [
			makeRepo({
				name: "a",
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
		];
		const result = computeSummaryAggregates(repos, "feature");
		expect(result.rebasedOnlyCount).toBe(0);
	});

	test("counts repos where all unpushed commits are rebased", () => {
		const repos = [
			makeRepo({
				name: "rebased-only",
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 2, rebased: 2 },
			}),
			makeRepo({
				name: "has-new",
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 3, toPull: 2, rebased: 2 },
			}),
		];
		const result = computeSummaryAggregates(repos, "feature");
		expect(result.rebasedOnlyCount).toBe(1);
	});

	test("returns 0 when rebased is null", () => {
		const repos = [
			makeRepo({
				name: "a",
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 2, rebased: null },
			}),
		];
		const result = computeSummaryAggregates(repos, "feature");
		expect(result.rebasedOnlyCount).toBe(0);
	});
});

describe("formatStatusCounts with rebased", () => {
	test("shows yellow unpushed when no rebased repos", () => {
		const statusCounts = [{ label: "unpushed", count: 3, key: "isUnpushed" as const }];
		const result = formatStatusCounts(statusCounts, 0);
		expect(result).toContain("unpushed");
	});

	test("shows rebased instead of unpushed when all are rebased-only", () => {
		const statusCounts = [{ label: "unpushed", count: 3, key: "isUnpushed" as const }];
		const result = formatStatusCounts(statusCounts, 3);
		expect(result).toBe("rebased");
	});

	test("shows both unpushed and rebased when mixed", () => {
		const statusCounts = [{ label: "unpushed", count: 3, key: "isUnpushed" as const }];
		const result = formatStatusCounts(statusCounts, 2);
		expect(result).toContain("unpushed");
		expect(result).toContain("rebased");
	});

	test("does not affect non-unpushed labels", () => {
		const statusCounts = [{ label: "dirty", count: 2, key: "isDirty" as const }];
		const result = formatStatusCounts(statusCounts, 1);
		expect(result).toContain("dirty");
		expect(result).not.toContain("rebased");
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

describe("stale filter", () => {
	test("matches needsPull", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "stale")).toBe(true);
	});

	test("matches needsRebase", () => {
		const flags = computeFlags(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 2,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "stale")).toBe(true);
	});

	test("matches isDiverged", () => {
		const flags = computeFlags(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 2,
					behind: 3,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "stale")).toBe(true);
	});

	test("does not match clean repo", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "stale")).toBe(false);
	});

	test("does not match dirty repo", () => {
		const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
		expect(repoMatchesWhere(flags, "stale")).toBe(false);
	});
});

describe("positive filter terms", () => {
	test("clean matches repo with no local changes", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "clean")).toBe(true);
	});

	test("clean does not match dirty repo", () => {
		const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
		expect(repoMatchesWhere(flags, "clean")).toBe(false);
	});

	test("pushed matches repo with no unpushed commits", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "pushed")).toBe(true);
	});

	test("pushed does not match unpushed repo", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "pushed")).toBe(false);
	});

	test("synced-base matches repo with no rebase needed and not diverged", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "synced-base")).toBe(true);
	});

	test("synced-base does not match repo behind base", () => {
		const flags = computeFlags(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 2,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "synced-base")).toBe(false);
	});

	test("synced-base does not match diverged repo", () => {
		const flags = computeFlags(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 2,
					behind: 3,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "synced-base")).toBe(false);
	});

	test("synced-share matches repo with no pull needed", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "synced-share")).toBe(true);
	});

	test("synced-share does not match repo behind share", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "synced-share")).toBe(false);
	});

	test("safe matches repo with no at-risk flags", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "safe")).toBe(true);
	});

	test("safe does not match dirty repo", () => {
		const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
		expect(repoMatchesWhere(flags, "safe")).toBe(false);
	});

	test("safe does not match unpushed repo", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "safe")).toBe(false);
	});

	test("synced matches repo with no stale flags", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "synced")).toBe(true);
	});

	test("synced does not match repo behind base", () => {
		const flags = computeFlags(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 2,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "synced")).toBe(false);
	});

	test("synced does not match repo behind share", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "synced")).toBe(false);
	});

	test("positive terms composable with AND", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "clean+pushed")).toBe(true);
	});

	test("positive AND fails when one condition unmet", () => {
		const flags = computeFlags(
			makeRepo({
				local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "clean+pushed")).toBe(false);
	});
});

describe("^ negation prefix", () => {
	test("^dirty matches clean repo", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "^dirty")).toBe(true);
	});

	test("^dirty does not match dirty repo", () => {
		const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
		expect(repoMatchesWhere(flags, "^dirty")).toBe(false);
	});

	test("^at-risk matches safe repo", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "^at-risk")).toBe(true);
	});

	test("^at-risk does not match at-risk repo", () => {
		const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
		expect(repoMatchesWhere(flags, "^at-risk")).toBe(false);
	});

	test("^stale matches synced repo", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "^stale")).toBe(true);
	});

	test("^stale does not match repo behind base", () => {
		const flags = computeFlags(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 2,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "^stale")).toBe(false);
	});

	test("^ composable with AND: ^dirty+^unpushed", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "^dirty+^unpushed")).toBe(true);
	});

	test("^ AND fails when one condition unmet", () => {
		const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
		expect(repoMatchesWhere(flags, "^dirty+^unpushed")).toBe(false);
	});

	test("^ composable with OR: ^dirty,gone", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(repoMatchesWhere(flags, "^dirty,gone")).toBe(true);
	});

	test("^ with OR — second term matches", () => {
		const flags = computeFlags(
			makeRepo({
				local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
			}),
			"feature",
		);
		expect(repoMatchesWhere(flags, "^dirty,gone")).toBe(true);
	});

	test("validateWhere accepts ^dirty", () => {
		expect(validateWhere("^dirty")).toBeNull();
	});

	test("validateWhere accepts ^at-risk", () => {
		expect(validateWhere("^at-risk")).toBeNull();
	});

	test("validateWhere accepts ^dirty+^unpushed", () => {
		expect(validateWhere("^dirty+^unpushed")).toBeNull();
	});

	test("validateWhere rejects ^invalid", () => {
		const err = validateWhere("^invalid");
		expect(err).toContain("Unknown filter term: ^invalid");
		expect(err).toContain("prefix with ^ to negate");
	});

	test("validateWhere rejects mixed valid and ^invalid", () => {
		const err = validateWhere("dirty,^nope");
		expect(err).toContain("Unknown filter term: ^nope");
	});
});

describe("positive / negation equivalence", () => {
	test("^dirty behaves same as clean", () => {
		const cleanFlags = computeFlags(makeRepo(), "feature");
		const dirtyFlags = computeFlags(
			makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
			"feature",
		);
		expect(repoMatchesWhere(cleanFlags, "^dirty")).toBe(repoMatchesWhere(cleanFlags, "clean"));
		expect(repoMatchesWhere(dirtyFlags, "^dirty")).toBe(repoMatchesWhere(dirtyFlags, "clean"));
	});

	test("^at-risk behaves same as safe", () => {
		const safeFlags = computeFlags(makeRepo(), "feature");
		const riskyFlags = computeFlags(
			makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
			"feature",
		);
		expect(repoMatchesWhere(safeFlags, "^at-risk")).toBe(repoMatchesWhere(safeFlags, "safe"));
		expect(repoMatchesWhere(riskyFlags, "^at-risk")).toBe(repoMatchesWhere(riskyFlags, "safe"));
	});

	test("^stale behaves same as synced", () => {
		const syncedFlags = computeFlags(makeRepo(), "feature");
		const staleFlags = computeFlags(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 2,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			"feature",
		);
		expect(repoMatchesWhere(syncedFlags, "^stale")).toBe(repoMatchesWhere(syncedFlags, "synced"));
		expect(repoMatchesWhere(staleFlags, "^stale")).toBe(repoMatchesWhere(staleFlags, "synced"));
	});
});
