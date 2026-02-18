import { describe, expect, test } from "bun:test";
import type { RepoStatus } from "./status";
import {
	computeFlags,
	flagLabels,
	isWorkspaceSafe,
	needsAttention,
	repoMatchesWhere,
	validateWhere,
	workspaceMatchesWhere,
	wouldLoseWork,
} from "./status";

function makeRepo(overrides: Partial<RepoStatus> = {}): RepoStatus {
	return {
		name: "test-repo",
		identity: {
			worktreeKind: "linked",
			headMode: { kind: "attached", branch: "feature" },
			shallow: false,
		},
		local: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
		base: { remote: "origin", ref: "main", ahead: 0, behind: 0 },
		share: {
			remote: "origin",
			ref: "origin/feature",
			refMode: "configured",
			toPush: 0,
			toPull: 0,
		},
		operation: null,
		lastCommit: null,
		...overrides,
	};
}

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
			isLocal: false,
			isGone: false,
			isShallow: false,
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
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0 },
			}),
			"feature",
		);
		expect(flags.isUnpushed).toBe(true);
	});

	test("isUnpushed when noRef with base.ahead > 0", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "noRef", toPush: null, toPull: null },
				base: { remote: "origin", ref: "main", ahead: 3, behind: 0 },
			}),
			"feature",
		);
		expect(flags.isUnpushed).toBe(true);
	});

	test("not isUnpushed when gone even with base.ahead > 0", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null },
				base: { remote: "origin", ref: "main", ahead: 3, behind: 0 },
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

	test("not isUnpushed when share is null (local repo)", () => {
		const flags = computeFlags(makeRepo({ share: null }), "feature");
		expect(flags.isUnpushed).toBe(false);
	});

	test("needsPull when toPull > 0", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3 },
			}),
			"feature",
		);
		expect(flags.needsPull).toBe(true);
	});

	test("needsRebase when behind base", () => {
		const flags = computeFlags(makeRepo({ base: { remote: "origin", ref: "main", ahead: 0, behind: 2 } }), "feature");
		expect(flags.needsRebase).toBe(true);
	});

	test("isDiverged when both ahead and behind base", () => {
		const flags = computeFlags(makeRepo({ base: { remote: "origin", ref: "main", ahead: 2, behind: 3 } }), "feature");
		expect(flags.isDiverged).toBe(true);
	});

	test("not isDiverged when only behind base", () => {
		const flags = computeFlags(makeRepo({ base: { remote: "origin", ref: "main", ahead: 0, behind: 2 } }), "feature");
		expect(flags.isDiverged).toBe(false);
	});

	test("not isDiverged when only ahead of base", () => {
		const flags = computeFlags(makeRepo({ base: { remote: "origin", ref: "main", ahead: 3, behind: 0 } }), "feature");
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

	test("isLocal when no share remote", () => {
		const flags = computeFlags(makeRepo({ share: null }), "feature");
		expect(flags.isLocal).toBe(true);
	});

	test("not isLocal when share remote exists", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(flags.isLocal).toBe(false);
	});

	test("isGone when refMode is gone", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null },
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
});

describe("needsAttention", () => {
	test("returns false when all flags are false", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(needsAttention(flags)).toBe(false);
	});

	test("returns true when isDirty", () => {
		const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
		expect(needsAttention(flags)).toBe(true);
	});

	test("returns true when isShallow", () => {
		const flags = computeFlags(
			makeRepo({
				identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
			}),
			"feature",
		);
		expect(needsAttention(flags)).toBe(true);
	});

	test("returns true when needsRebase", () => {
		const flags = computeFlags(makeRepo({ base: { remote: "origin", ref: "main", ahead: 0, behind: 1 } }), "feature");
		expect(needsAttention(flags)).toBe(true);
	});

	test("returns true when isDiverged", () => {
		const flags = computeFlags(makeRepo({ base: { remote: "origin", ref: "main", ahead: 2, behind: 3 } }), "feature");
		expect(needsAttention(flags)).toBe(true);
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
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0 },
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
				base: { remote: "origin", ref: "main", ahead: 0, behind: 2 },
				operation: "rebase",
			}),
			"feature",
		);
		expect(flagLabels(flags)).toEqual(["dirty", "behind base", "operation", "shallow"]);
	});

	test("returns diverged label when both ahead and behind base", () => {
		const flags = computeFlags(makeRepo({ base: { remote: "origin", ref: "main", ahead: 2, behind: 3 } }), "feature");
		expect(flagLabels(flags)).toEqual(["behind base", "diverged"]);
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
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0 },
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
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3 },
			}),
			"feature",
		);
		expect(wouldLoseWork(flags)).toBe(false);
	});

	test("returns false when only needsRebase", () => {
		const flags = computeFlags(makeRepo({ base: { remote: "origin", ref: "main", ahead: 0, behind: 2 } }), "feature");
		expect(wouldLoseWork(flags)).toBe(false);
	});

	test("returns false when isDiverged", () => {
		const flags = computeFlags(makeRepo({ base: { remote: "origin", ref: "main", ahead: 2, behind: 3 } }), "feature");
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

	test("returns false when isLocal", () => {
		const flags = computeFlags(makeRepo({ share: null, base: null }), "feature");
		expect(wouldLoseWork(flags)).toBe(false);
	});

	test("returns false when isGone (without unpushed commits)", () => {
		const flags = computeFlags(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null },
				base: { remote: "origin", ref: "main", ahead: 0, behind: 0 },
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
				"dirty,unpushed,behind-share,behind-base,diverged,drifted,detached,operation,local,gone,shallow,at-risk",
			),
		).toBeNull();
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
			makeRepo({ share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null } }),
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

	test("matches each raw flag term", () => {
		const cases: [string, Partial<RepoStatus>][] = [
			["unpushed", { share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0 } }],
			[
				"behind-share",
				{ share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3 } },
			],
			["behind-base", { base: { remote: "origin", ref: "main", ahead: 0, behind: 2 } }],
			["diverged", { base: { remote: "origin", ref: "main", ahead: 2, behind: 3 } }],
			[
				"drifted",
				{ identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false } },
			],
			["detached", { identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false } }],
			["operation", { operation: "rebase" }],
			["local", { share: null }],
			["gone", { share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null } }],
			[
				"shallow",
				{ identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true } },
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

	test("matches at-risk across repos", () => {
		const repos = [
			makeRepo({ name: "clean-repo" }),
			makeRepo({
				name: "gone-repo",
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null },
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
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0 },
			}),
		];
		expect(isWorkspaceSafe(repos, "feature")).toBe(false);
	});

	test("returns false when a local repo has commits ahead of base", () => {
		const repos = [
			makeRepo({
				name: "local-with-commits",
				share: null,
				base: { remote: "origin", ref: "main", ahead: 3, behind: 0 },
			}),
		];
		expect(isWorkspaceSafe(repos, "feature")).toBe(false);
	});

	test("returns true when repos are behind base (safe to remove)", () => {
		const repos = [makeRepo({ name: "behind", base: { remote: "origin", ref: "main", ahead: 0, behind: 5 } })];
		expect(isWorkspaceSafe(repos, "feature")).toBe(true);
	});

	test("returns true when repos are gone (safe to remove)", () => {
		const repos = [
			makeRepo({
				name: "gone",
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null },
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
