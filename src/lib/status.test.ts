import { describe, expect, test } from "bun:test";
import type { RepoStatus } from "./status";
import { computeFlags, flagLabels, needsAttention, wouldLoseWork } from "./status";

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
		publish: {
			remote: "origin",
			ref: "origin/feature",
			refMode: "configured",
			toPush: 0,
			toPull: 0,
		},
		operation: null,
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
				publish: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0 },
			}),
			"feature",
		);
		expect(flags.isUnpushed).toBe(true);
	});

	test("isUnpushed when noRef with base.ahead > 0", () => {
		const flags = computeFlags(
			makeRepo({
				publish: { remote: "origin", ref: null, refMode: "noRef", toPush: null, toPull: null },
				base: { remote: "origin", ref: "main", ahead: 3, behind: 0 },
			}),
			"feature",
		);
		expect(flags.isUnpushed).toBe(true);
	});

	test("not isUnpushed when gone even with base.ahead > 0", () => {
		const flags = computeFlags(
			makeRepo({
				publish: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null },
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

	test("not isUnpushed when publish is null (local repo)", () => {
		const flags = computeFlags(makeRepo({ publish: null }), "feature");
		expect(flags.isUnpushed).toBe(false);
	});

	test("needsPull when toPull > 0", () => {
		const flags = computeFlags(
			makeRepo({
				publish: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3 },
			}),
			"feature",
		);
		expect(flags.needsPull).toBe(true);
	});

	test("needsRebase when behind base", () => {
		const flags = computeFlags(makeRepo({ base: { remote: "origin", ref: "main", ahead: 0, behind: 2 } }), "feature");
		expect(flags.needsRebase).toBe(true);
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

	test("isLocal when no publish remote", () => {
		const flags = computeFlags(makeRepo({ publish: null }), "feature");
		expect(flags.isLocal).toBe(true);
	});

	test("not isLocal when publish remote exists", () => {
		const flags = computeFlags(makeRepo(), "feature");
		expect(flags.isLocal).toBe(false);
	});

	test("isGone when refMode is gone", () => {
		const flags = computeFlags(
			makeRepo({
				publish: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null },
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
				publish: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0 },
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
				publish: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0 },
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
				publish: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3 },
			}),
			"feature",
		);
		expect(wouldLoseWork(flags)).toBe(false);
	});

	test("returns false when only needsRebase", () => {
		const flags = computeFlags(makeRepo({ base: { remote: "origin", ref: "main", ahead: 0, behind: 2 } }), "feature");
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
		const flags = computeFlags(makeRepo({ publish: null, base: null }), "feature");
		expect(wouldLoseWork(flags)).toBe(false);
	});

	test("returns false when isGone (without unpushed commits)", () => {
		const flags = computeFlags(
			makeRepo({
				publish: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null },
				base: { remote: "origin", ref: "main", ahead: 0, behind: 0 },
			}),
			"feature",
		);
		expect(wouldLoseWork(flags)).toBe(false);
	});
});
