import { describe, expect, test } from "bun:test";
import { computeFlags } from "../status/status";
import { makeRepo } from "../status/test-helpers";
import {
	analyzeBaseDiff,
	analyzeBaseName,
	analyzeBranch,
	analyzeLocal,
	analyzeRemoteDiff,
	analyzeRemoteName,
	buildStatusCountsCell,
	flagLabels,
	formatStatusCounts,
	plainBaseDiff,
	plainLocal,
	plainRemoteDiff,
} from "./analysis";

// ── analyzeBranch ──

describe("analyzeBranch", () => {
	test("detached HEAD returns (detached) with attention", () => {
		const repo = makeRepo({ identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false } });
		const result = analyzeBranch(repo, "feature");
		expect(result.plain).toBe("(detached)");
		expect(result.spans).toEqual([{ text: "(detached)", attention: "attention" }]);
	});

	test("matching branch returns branch name with default", () => {
		const repo = makeRepo();
		const result = analyzeBranch(repo, "feature");
		expect(result.plain).toBe("feature");
		expect(result.spans).toEqual([{ text: "feature", attention: "default" }]);
	});

	test("drifted branch returns branch name with attention", () => {
		const repo = makeRepo();
		const result = analyzeBranch(repo, "main");
		expect(result.plain).toBe("feature");
		expect(result.spans).toEqual([{ text: "feature", attention: "attention" }]);
	});
});

// ── analyzeBaseName ──

describe("analyzeBaseName", () => {
	test("no base returns empty cell", () => {
		const repo = makeRepo({ base: null });
		const flags = computeFlags(repo, "feature");
		const result = analyzeBaseName(repo, flags);
		expect(result.plain).toBe("");
		expect(result.spans).toEqual([]);
	});

	test("normal base returns origin/main with default", () => {
		const repo = makeRepo();
		const flags = computeFlags(repo, "feature");
		const result = analyzeBaseName(repo, flags);
		expect(result.plain).toBe("origin/main");
		expect(result.spans).toEqual([{ text: "origin/main", attention: "default" }]);
	});

	test("baseFellBack (configuredRef set, baseMergedIntoDefault null) returns attention", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: "develop",
				ahead: 0,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		expect(flags.baseFellBack).toBe(true);
		const result = analyzeBaseName(repo, flags);
		// configuredRef is used as name when present
		expect(result.plain).toBe("origin/develop");
		expect(result.spans[0]?.attention).toBe("attention");
	});

	test("baseMergedIntoDefault set returns attention", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 0,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: "squash",
				detectedPr: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeBaseName(repo, flags);
		expect(result.plain).toBe("origin/main");
		expect(result.spans[0]?.attention).toBe("attention");
	});
});

// ── plainBaseDiff ──

describe("plainBaseDiff", () => {
	test("mergedIntoBase set returns merged", () => {
		const base = {
			remote: "origin",
			ref: "main",
			configuredRef: null,
			ahead: 3,
			behind: 2,
			mergedIntoBase: "merge" as const,
			baseMergedIntoDefault: null,
			detectedPr: null,
		};
		expect(plainBaseDiff(base)).toBe("merged");
	});

	test("baseMergedIntoDefault set returns base merged", () => {
		const base = {
			remote: "origin",
			ref: "main",
			configuredRef: null,
			ahead: 0,
			behind: 0,
			mergedIntoBase: null,
			baseMergedIntoDefault: "squash" as const,
			detectedPr: null,
		};
		expect(plainBaseDiff(base)).toBe("base merged");
	});

	test("ahead only returns N ahead", () => {
		const base = {
			remote: "origin",
			ref: "main",
			configuredRef: null,
			ahead: 3,
			behind: 0,
			mergedIntoBase: null,
			baseMergedIntoDefault: null,
			detectedPr: null,
		};
		expect(plainBaseDiff(base)).toBe("3 ahead");
	});

	test("behind only returns N behind", () => {
		const base = {
			remote: "origin",
			ref: "main",
			configuredRef: null,
			ahead: 0,
			behind: 5,
			mergedIntoBase: null,
			baseMergedIntoDefault: null,
			detectedPr: null,
		};
		expect(plainBaseDiff(base)).toBe("5 behind");
	});

	test("both ahead and behind returns combined", () => {
		const base = {
			remote: "origin",
			ref: "main",
			configuredRef: null,
			ahead: 3,
			behind: 5,
			mergedIntoBase: null,
			baseMergedIntoDefault: null,
			detectedPr: null,
		};
		expect(plainBaseDiff(base)).toBe("3 ahead, 5 behind");
	});

	test("equal when no ahead/behind returns equal", () => {
		const base = {
			remote: "origin",
			ref: "main",
			configuredRef: null,
			ahead: 0,
			behind: 0,
			mergedIntoBase: null,
			baseMergedIntoDefault: null,
			detectedPr: null,
		};
		expect(plainBaseDiff(base)).toBe("equal");
	});
});

// ── analyzeBaseDiff ──

describe("analyzeBaseDiff", () => {
	test("no base returns empty cell", () => {
		const repo = makeRepo({ base: null });
		const flags = computeFlags(repo, "feature");
		const result = analyzeBaseDiff(repo, flags, false);
		expect(result.plain).toBe("");
		expect(result.spans).toEqual([]);
	});

	test("detached returns empty cell", () => {
		const repo = makeRepo({
			identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeBaseDiff(repo, flags, false);
		expect(result.plain).toBe("");
		expect(result.spans).toEqual([]);
	});

	test("configuredRef set but baseMergedIntoDefault null returns not found", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: "develop",
				ahead: 2,
				behind: 1,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeBaseDiff(repo, flags, false);
		expect(result.plain).toBe("not found");
	});

	test("normal with conflict returns attention", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 3,
				behind: 5,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeBaseDiff(repo, flags, true);
		expect(result.plain).toBe("3 ahead, 5 behind");
		expect(result.spans[0]?.attention).toBe("attention");
	});

	test("baseMergedIntoDefault set returns attention", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 0,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: "merge",
				detectedPr: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeBaseDiff(repo, flags, false);
		expect(result.plain).toBe("base merged");
		expect(result.spans[0]?.attention).toBe("attention");
	});

	test("baseFellBack returns attention", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: "develop",
				ahead: 0,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeBaseDiff(repo, flags, false);
		expect(result.plain).toBe("not found");
		expect(result.spans[0]?.attention).toBe("attention");
	});
});

// ── analyzeRemoteName ──

describe("analyzeRemoteName", () => {
	test("detached returns detached with attention", () => {
		const repo = makeRepo({
			identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteName(repo, flags);
		expect(result.plain).toBe("detached");
		expect(result.spans[0]?.attention).toBe("attention");
	});

	test("configured refMode with ref returns ref as name", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 0,
				toPull: 0,
				rebased: null,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteName(repo, flags);
		expect(result.plain).toBe("origin/feature");
		expect(result.spans[0]?.attention).toBe("default");
	});

	test("implicit refMode uses remote/branch pattern", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "implicit",
				toPush: 0,
				toPull: 0,
				rebased: null,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteName(repo, flags);
		expect(result.plain).toBe("origin/feature");
		expect(result.spans[0]?.attention).toBe("default");
	});

	test("noRef refMode uses remote/branch pattern", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: null,
				refMode: "noRef",
				toPush: null,
				toPull: null,
				rebased: null,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteName(repo, flags);
		expect(result.plain).toBe("origin/feature");
	});

	test("gone refMode uses remote/branch pattern", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: null,
				refMode: "gone",
				toPush: null,
				toPull: null,
				rebased: null,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteName(repo, flags);
		expect(result.plain).toBe("origin/feature");
	});

	test("drifted branch returns attention", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 0,
				toPull: 0,
				rebased: null,
				replaced: null,
			},
		});
		// expectedBranch is "main" but repo is on "feature" → drifted
		const flags = computeFlags(repo, "main");
		expect(flags.isDrifted).toBe(true);
		const result = analyzeRemoteName(repo, flags);
		expect(result.spans[0]?.attention).toBe("attention");
	});

	test("configured ref with unexpected mismatch returns attention", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: "origin/other-branch",
				refMode: "configured",
				toPush: 0,
				toPull: 0,
				rebased: null,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteName(repo, flags);
		expect(result.plain).toBe("origin/other-branch");
		expect(result.spans[0]?.attention).toBe("attention");
	});
});

// ── plainRemoteDiff ──

describe("plainRemoteDiff", () => {
	test("gone with merged returns merged PR suffix and gone", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 0,
				behind: 0,
				mergedIntoBase: "merge",
				baseMergedIntoDefault: null,
				detectedPr: { number: 42, url: null },
			},
			share: {
				remote: "origin",
				ref: null,
				refMode: "gone",
				toPush: null,
				toPull: null,
				rebased: null,
				replaced: null,
			},
		});
		expect(plainRemoteDiff(repo)).toBe("merged (#42), gone");
	});

	test("gone without merged, with ahead returns gone N to push", () => {
		const repo = makeRepo({
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
			share: {
				remote: "origin",
				ref: null,
				refMode: "gone",
				toPush: null,
				toPull: null,
				rebased: null,
				replaced: null,
			},
		});
		expect(plainRemoteDiff(repo)).toBe("gone, 3 to push");
	});

	test("gone alone returns gone", () => {
		const repo = makeRepo({
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
			share: {
				remote: "origin",
				ref: null,
				refMode: "gone",
				toPush: null,
				toPull: null,
				rebased: null,
				replaced: null,
			},
		});
		expect(plainRemoteDiff(repo)).toBe("gone");
	});

	test("noRef with ahead returns N to push", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 5,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: null,
				refMode: "noRef",
				toPush: null,
				toPull: null,
				rebased: null,
				replaced: null,
			},
		});
		expect(plainRemoteDiff(repo)).toBe("5 to push");
	});

	test("noRef without ahead returns not pushed", () => {
		const repo = makeRepo({
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
			share: {
				remote: "origin",
				ref: null,
				refMode: "noRef",
				toPush: null,
				toPull: null,
				rebased: null,
				replaced: null,
			},
		});
		expect(plainRemoteDiff(repo)).toBe("not pushed");
	});

	test("merged with share up to date returns merged with PR number", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 0,
				behind: 0,
				mergedIntoBase: "squash",
				baseMergedIntoDefault: null,
				detectedPr: { number: 99, url: null },
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 0,
				toPull: 0,
				rebased: null,
				replaced: null,
			},
		});
		expect(plainRemoteDiff(repo)).toBe("merged (#99)");
	});

	test("up to date returns up to date", () => {
		const repo = makeRepo();
		expect(plainRemoteDiff(repo)).toBe("up to date");
	});

	test("three-way split: fromBase + rebased + new + pull", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 4,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 7,
				toPull: 3,
				rebased: 2,
				replaced: null,
			},
		});
		// fromBase = 7-4 = 3, rebased = 2, newCount = 4-2 = 2; pull: outdated = 2, newPull = 3-2 = 1
		expect(plainRemoteDiff(repo)).toBe("3 from main, 2 rebased, 2 new → 2 outdated, 1 new");
	});

	test("simple push count", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 3,
				toPull: 0,
				rebased: null,
				replaced: null,
			},
		});
		expect(plainRemoteDiff(repo)).toBe("3 to push");
	});

	test("simple pull count", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 0,
				toPull: 2,
				rebased: null,
				replaced: null,
			},
		});
		expect(plainRemoteDiff(repo)).toBe("2 to pull");
	});

	test("rebased only (no fromBase, no new)", () => {
		const repo = makeRepo({
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
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 3,
				toPull: 3,
				rebased: 3,
				replaced: null,
			},
		});
		// fromBase = 3-3 = 0, rebased = 3, newCount = 3-3 = 0; pull: outdated = 3
		expect(plainRemoteDiff(repo)).toBe("3 rebased → 3 outdated");
	});

	test("fromBase + rebased (no new work)", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 2,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 5,
				toPull: 2,
				rebased: 2,
				replaced: null,
			},
		});
		// fromBase = 5-2 = 3, rebased = 2, newCount = 2-2 = 0; pull: outdated = 2
		expect(plainRemoteDiff(repo)).toBe("3 from main, 2 rebased → 2 outdated");
	});

	test("rebased + new (no fromBase)", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 5,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 5,
				toPull: 2,
				rebased: 2,
				replaced: null,
			},
		});
		// fromBase = 5-5 = 0, rebased = 2, newCount = 5-2 = 3; pull: outdated = 2
		expect(plainRemoteDiff(repo)).toBe("2 rebased, 3 new → 2 outdated");
	});

	test("push-side new count is bounded by toPush (not base ahead)", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 2,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 1,
				toPull: 1,
				rebased: 0,
				replaced: null,
			},
		});
		expect(plainRemoteDiff(repo)).toBe("1 new → 1 new");
	});

	test("replaced commits show as outdated on pull side", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 2,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 1,
				toPull: 1,
				rebased: 0,
				replaced: 1,
			},
		});
		expect(plainRemoteDiff(repo)).toBe("1 new → 1 outdated");
	});

	test("rebased + replaced are merged into single outdated count", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 5,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 3,
				toPull: 3,
				rebased: 1,
				replaced: 1,
			},
		});
		// fromBase = 3-5 = 0, rebased = 1, newCount = 3-1 = 2; pull: outdated = 1+1 = 2, new = 1
		expect(plainRemoteDiff(repo)).toBe("1 rebased, 2 new → 2 outdated, 1 new");
	});

	test("all pull commits replaced shows only outdated", () => {
		const repo = makeRepo({
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
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 2,
				toPull: 2,
				rebased: 0,
				replaced: 2,
			},
		});
		expect(plainRemoteDiff(repo)).toBe("2 new → 2 outdated");
	});

	test("base null fallback uses two-way split", () => {
		const repo = makeRepo({
			base: null,
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 5,
				toPull: 3,
				rebased: 2,
				replaced: null,
			},
		});
		// Fallback: newPush = 5-2 = 3; pull: outdated = 2, newPull = 3-2 = 1
		expect(plainRemoteDiff(repo)).toBe("3 to push, 2 rebased → 2 outdated, 1 new");
	});

	test("uses base ref name in from label", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "develop",
				configuredRef: null,
				ahead: 2,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 5,
				toPull: 2,
				rebased: 2,
				replaced: null,
			},
		});
		// pull: outdated = 2
		expect(plainRemoteDiff(repo)).toBe("3 from develop, 2 rebased → 2 outdated");
	});
});

// ── analyzeRemoteDiff ──

describe("analyzeRemoteDiff", () => {
	test("detached returns empty cell", () => {
		const repo = makeRepo({
			identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteDiff(repo, flags);
		expect(result.plain).toBe("");
		expect(result.spans).toEqual([]);
	});

	test("merged with new work produces multi-span with attention on push part", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 2,
				behind: 0,
				mergedIntoBase: "squash",
				newCommitsAfterMerge: 2,
				baseMergedIntoDefault: null,
				detectedPr: { number: 10, url: null },
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 0,
				toPull: 0,
				rebased: null,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteDiff(repo, flags);
		// plainRemoteDiff produces "merged (#10), 2 to push"
		expect(result.plain).toBe("merged (#10), 2 to push");
		// First span is the prefix (default), second is the push part (attention)
		expect(result.spans.length).toBe(2);
		expect(result.spans[0]?.attention).toBe("default");
		expect(result.spans[1]?.attention).toBe("attention");
		expect(result.spans[1]?.text).toBe("2 to push");
	});

	test("rebased-only (no new work) returns default attention with arrow and outdated", () => {
		const repo = makeRepo({
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
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 3,
				toPull: 3,
				rebased: 3,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		// base.ahead=3, rebased=3 → newCount=0, push default; pull: 3 outdated
		const result = analyzeRemoteDiff(repo, flags);
		expect(result.plain).toBe("3 rebased → 3 outdated");
		// Push span is default (no new work), arrow is muted, pull is default
		expect(result.spans[0]?.attention).toBe("default");
		expect(result.spans[1]?.text).toBe(" → ");
		expect(result.spans[1]?.attention).toBe("muted");
		expect(result.spans[2]?.attention).toBe("default");
	});

	test("pull-side 'new' stays default when no pull conflict is predicted", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 4,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 7,
				toPull: 3,
				rebased: 2,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		// fromBase=3, rebased=2, newCount=2; pull: outdated=2, newPull=1
		const result = analyzeRemoteDiff(repo, flags, false);
		expect(result.plain).toBe("3 from main, 2 rebased, 2 new → 2 outdated, 1 new");
		const pullNew = result.spans.filter((s) => s.text === "1 new").at(-1);
		expect(pullNew?.attention).toBe("default");
	});

	test("pull-side 'new' gets attention when pull conflict is predicted", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 4,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 7,
				toPull: 3,
				rebased: 2,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteDiff(repo, flags, true);
		expect(result.plain).toBe("3 from main, 2 rebased, 2 new → 2 outdated, 1 new");
		const pullNew = result.spans.filter((s) => s.text === "1 new").at(-1);
		expect(pullNew?.attention).toBe("attention");
	});

	test("push-side highlights only n new (from main stays default)", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 4,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 7,
				toPull: 0,
				rebased: 2,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteDiff(repo, flags);
		expect(result.plain).toBe("3 from main, 2 rebased, 2 new");
		const fromMain = result.spans.find((s) => s.text.includes("from main"));
		const pushNew = result.spans.find((s) => s.text === "2 new");
		expect(fromMain?.attention).toBe("default");
		expect(pushNew?.attention).toBe("attention");
	});

	test("push-side fromBase+rebased (no new work) stays default attention", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 2,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 5,
				toPull: 2,
				rebased: 2,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		// fromBase=3, rebased=2, newCount=0 → push default; pull: 2 outdated
		const result = analyzeRemoteDiff(repo, flags);
		expect(result.plain).toBe("3 from main, 2 rebased → 2 outdated");
		expect(result.spans[0]?.attention).toBe("default");
	});

	test("pull side only 'new' (no outdated) stays default without pull conflict", () => {
		const repo = makeRepo({
			base: null,
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 5,
				toPull: 3,
				rebased: 0,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		// rebased=0: outdated=0, newPull=3
		const result = analyzeRemoteDiff(repo, flags, false);
		expect(result.plain).toBe("5 to push → 3 new");
		expect(result.spans[2]?.text).toBe("3 new");
		expect(result.spans[2]?.attention).toBe("default");
	});

	test("pull side only 'new' gets attention with pull conflict", () => {
		const repo = makeRepo({
			base: null,
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 5,
				toPull: 3,
				rebased: 0,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteDiff(repo, flags, true);
		expect(result.plain).toBe("5 to push → 3 new");
		expect(result.spans[2]?.text).toBe("3 new");
		expect(result.spans[2]?.attention).toBe("attention");
	});

	test("push and pull with rebased=null uses arrow with 'to pull'", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 5,
				toPull: 1,
				rebased: null,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteDiff(repo, flags);
		expect(result.plain).toBe("5 to push → 1 to pull");
		// Push span is attention (isUnpushed, rebased=0), arrow is muted
		expect(result.spans[0]?.attention).toBe("attention");
		expect(result.spans[1]?.text).toBe(" → ");
		expect(result.spans[1]?.attention).toBe("muted");
		expect(result.spans[2]?.attention).toBe("default");
	});

	test("behind-only returns default attention", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 0,
				toPull: 4,
				rebased: null,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteDiff(repo, flags);
		expect(result.plain).toBe("4 to pull");
		expect(result.spans[0]?.attention).toBe("default");
	});

	test("unpushed returns attention", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 3,
				toPull: 0,
				rebased: null,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		expect(flags.isUnpushed).toBe(true);
		const result = analyzeRemoteDiff(repo, flags);
		expect(result.plain).toBe("3 to push");
		expect(result.spans[0]?.attention).toBe("attention");
	});

	test("up to date returns default", () => {
		const repo = makeRepo();
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteDiff(repo, flags);
		expect(result.plain).toBe("up to date");
		expect(result.spans[0]?.attention).toBe("default");
	});

	test("replaced-only push side gets default attention (no new work)", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 2,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 1,
				toPull: 1,
				rebased: 0,
				replaced: 1,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteDiff(repo, flags);
		expect(result.plain).toBe("1 new → 1 outdated");
		// Push side should be default attention (all matched by replaced)
		expect(result.spans[0]?.attention).toBe("default");
		// Pull side "1 outdated" should be default
		const pullSpan = result.spans.find((s) => s.text === "1 outdated");
		expect(pullSpan?.attention).toBe("default");
	});

	test("mixed replaced + genuinely new pull shows outdated default and new default", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 5,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 3,
				toPull: 3,
				rebased: 1,
				replaced: 1,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteDiff(repo, flags, false);
		expect(result.plain).toBe("1 rebased, 2 new → 2 outdated, 1 new");
		// Pull "1 new" should be default (no pull conflict)
		const pullNew = result.spans.filter((s) => s.text === "1 new").at(-1);
		expect(pullNew?.attention).toBe("default");
	});

	test("mixed replaced + genuinely new pull with conflict highlights new", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 5,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feature",
				refMode: "configured",
				toPush: 3,
				toPull: 3,
				rebased: 1,
				replaced: 1,
			},
		});
		const flags = computeFlags(repo, "feature");
		const result = analyzeRemoteDiff(repo, flags, true);
		expect(result.plain).toBe("1 rebased, 2 new → 2 outdated, 1 new");
		// Pull "1 new" should be attention (pull conflict predicted)
		const pullNew = result.spans.filter((s) => s.text === "1 new").at(-1);
		expect(pullNew?.attention).toBe("attention");
	});
});

// ── plainLocal ──

describe("plainLocal", () => {
	test("clean returns clean", () => {
		const repo = makeRepo();
		expect(plainLocal(repo)).toBe("clean");
	});

	test("operation suffix appended", () => {
		const repo = makeRepo({ operation: "rebase" });
		expect(plainLocal(repo)).toBe("clean (rebase)");
	});

	test("shallow suffix appended", () => {
		const repo = makeRepo({
			identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
		});
		expect(plainLocal(repo)).toBe("clean (shallow)");
	});

	test("multiple statuses joined", () => {
		const repo = makeRepo({
			local: { conflicts: 1, staged: 2, modified: 3, untracked: 4 },
		});
		expect(plainLocal(repo)).toBe("1 conflicts, 2 staged, 3 modified, 4 untracked");
	});

	test("partial statuses only show non-zero", () => {
		const repo = makeRepo({
			local: { conflicts: 0, staged: 0, modified: 5, untracked: 0 },
		});
		expect(plainLocal(repo)).toBe("5 modified");
	});

	test("operation and shallow combined suffix", () => {
		const repo = makeRepo({
			identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
			operation: "merge",
		});
		expect(plainLocal(repo)).toBe("clean (merge, shallow)");
	});
});

// ── analyzeLocal ──

describe("analyzeLocal", () => {
	test("clean returns clean with default attention", () => {
		const repo = makeRepo();
		const result = analyzeLocal(repo);
		expect(result.plain).toBe("clean");
		expect(result.spans).toEqual([{ text: "clean", attention: "default" }]);
	});

	test("clean with operation returns multi-span with attention suffix", () => {
		const repo = makeRepo({ operation: "rebase" });
		const result = analyzeLocal(repo);
		expect(result.plain).toBe("clean (rebase)");
		expect(result.spans.length).toBe(2);
		expect(result.spans[0]?.text).toBe("clean");
		expect(result.spans[0]?.attention).toBe("default");
		expect(result.spans[1]?.text).toBe(" (rebase)");
		expect(result.spans[1]?.attention).toBe("attention");
	});

	test("conflicts returns attention", () => {
		const repo = makeRepo({ local: { conflicts: 3, staged: 0, modified: 0, untracked: 0 } });
		const result = analyzeLocal(repo);
		expect(result.plain).toBe("3 conflicts");
		expect(result.spans[0]?.attention).toBe("attention");
	});

	test("multiple statuses joined with comma separator", () => {
		const repo = makeRepo({ local: { conflicts: 0, staged: 1, modified: 2, untracked: 0 } });
		const result = analyzeLocal(repo);
		expect(result.plain).toBe("1 staged, 2 modified");
		// Spans: "1 staged", ", ", "2 modified"
		expect(result.spans.length).toBe(3);
		expect(result.spans[0]?.text).toBe("1 staged");
		expect(result.spans[0]?.attention).toBe("attention");
		expect(result.spans[2]?.text).toBe("2 modified");
		expect(result.spans[2]?.attention).toBe("attention");
	});

	test("changes with operation suffix", () => {
		const repo = makeRepo({
			local: { conflicts: 0, staged: 0, modified: 1, untracked: 0 },
			operation: "rebase",
		});
		const result = analyzeLocal(repo);
		expect(result.plain).toBe("1 modified (rebase)");
		const lastSpan = result.spans[result.spans.length - 1];
		expect(lastSpan?.text).toBe(" (rebase)");
		expect(lastSpan?.attention).toBe("attention");
	});
});

// ── flagLabels ──

describe("flagLabels", () => {
	test("clean repo returns empty array", () => {
		const repo = makeRepo();
		const flags = computeFlags(repo, "feature");
		expect(flagLabels(flags)).toEqual([]);
	});

	test("dirty repo returns dirty label", () => {
		const repo = makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } });
		const flags = computeFlags(repo, "feature");
		expect(flagLabels(flags)).toContain("dirty");
	});

	test("merged repo suppresses needsRebase and isDiverged", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 3,
				behind: 5,
				mergedIntoBase: "merge",
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		expect(flags.isMerged).toBe(true);
		expect(flags.needsRebase).toBe(true);
		expect(flags.isDiverged).toBe(true);
		const labels = flagLabels(flags);
		expect(labels).toContain("merged");
		expect(labels).not.toContain("behind base");
		expect(labels).not.toContain("diverged");
	});

	test("detached repo returns detached label", () => {
		const repo = makeRepo({
			identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
		});
		const flags = computeFlags(repo, "feature");
		const labels = flagLabels(flags);
		expect(labels).toContain("detached");
	});

	test("gone repo returns gone label", () => {
		const repo = makeRepo({
			share: {
				remote: "origin",
				ref: null,
				refMode: "gone",
				toPush: null,
				toPull: null,
				rebased: null,
				replaced: null,
			},
		});
		const flags = computeFlags(repo, "feature");
		const labels = flagLabels(flags);
		expect(labels).toContain("gone");
	});
});

// ── formatStatusCounts ──

describe("formatStatusCounts", () => {
	test("rebasedOnly splitting: isUnpushed with rebasedOnlyCount", () => {
		const statusCounts = [{ label: "3 unpushed", count: 3, key: "isUnpushed" as const }];
		const result = formatStatusCounts(statusCounts, 2);
		// genuine = 3 - 2 = 1 > 0, so we get yellow(label) + "rebased"
		expect(result).toContain("rebased");
	});

	test("rebasedOnly when genuine is 0 only shows rebased", () => {
		const statusCounts = [{ label: "2 unpushed", count: 2, key: "isUnpushed" as const }];
		const result = formatStatusCounts(statusCounts, 2);
		// genuine = 2 - 2 = 0, so only "rebased" part
		expect(result).toBe("rebased");
	});

	test("yellowKeys highlighting: AT_RISK_FLAGS keys get attention", () => {
		const statusCounts = [
			{ label: "2 dirty", count: 2, key: "isDirty" as const },
			{ label: "1 behind share", count: 1, key: "needsPull" as const },
		];
		// needsPull is NOT in AT_RISK_FLAGS, isDirty IS in AT_RISK_FLAGS
		const result = formatStatusCounts(statusCounts, 0);
		// "2 dirty" should be yellow'd, "1 behind share" should be plain
		expect(result).toContain("1 behind share");
	});

	test("non-AT_RISK key without yellowKeys override uses plain text", () => {
		const statusCounts = [{ label: "1 behind base", count: 1, key: "needsRebase" as const }];
		const result = formatStatusCounts(statusCounts, 0);
		// needsRebase is not in AT_RISK_FLAGS, so plain text
		expect(result).toBe("1 behind base");
	});
});

// ── buildStatusCountsCell ──

describe("buildStatusCountsCell", () => {
	test("genuine+rebased split: isUnpushed with rebasedOnlyCount", () => {
		const statusCounts = [{ label: "5 unpushed", count: 5, key: "isUnpushed" as const }];
		const result = buildStatusCountsCell(statusCounts, 2);
		// genuine = 5 - 2 = 3 > 0, so two parts: attention "5 unpushed" + default "rebased"
		expect(result.plain).toContain("5 unpushed");
		expect(result.plain).toContain("rebased");
		const attentionSpans = result.spans.filter((s) => s.attention === "attention");
		const defaultSpans = result.spans.filter((s) => s.attention === "default");
		expect(attentionSpans.some((s) => s.text === "5 unpushed")).toBe(true);
		expect(defaultSpans.some((s) => s.text === "rebased")).toBe(true);
	});

	test("rebased only (genuine=0): only rebased part with default", () => {
		const statusCounts = [{ label: "3 unpushed", count: 3, key: "isUnpushed" as const }];
		const result = buildStatusCountsCell(statusCounts, 3);
		// genuine = 3 - 3 = 0, so only "rebased"
		expect(result.plain).toBe("rebased");
		expect(result.spans.every((s) => s.attention === "default")).toBe(true);
	});

	test("atRiskKeys get attention, others get default", () => {
		const statusCounts = [
			{ label: "2 dirty", count: 2, key: "isDirty" as const },
			{ label: "1 behind base", count: 1, key: "needsRebase" as const },
		];
		const result = buildStatusCountsCell(statusCounts, 0);
		// isDirty is in AT_RISK_FLAGS → attention, needsRebase is not → default
		const dirtySpan = result.spans.find((s) => s.text === "2 dirty");
		const rebaseSpan = result.spans.find((s) => s.text === "1 behind base");
		expect(dirtySpan?.attention).toBe("attention");
		expect(rebaseSpan?.attention).toBe("default");
	});

	test("multiple counts joined with comma separator", () => {
		const statusCounts = [
			{ label: "1 unpushed", count: 1, key: "isUnpushed" as const },
			{ label: "2 behind share", count: 2, key: "needsPull" as const },
		];
		const result = buildStatusCountsCell(statusCounts, 0);
		expect(result.plain).toBe("1 unpushed, 2 behind share");
	});
});
