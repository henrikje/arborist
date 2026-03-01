import { describe, expect, test } from "bun:test";
import { makeRepo } from "../lib/test-helpers";
import { plainBaseDiff, plainCells, plainLocal, plainRemoteDiff } from "./status";

describe("plainBaseDiff", () => {
	test("shows equal when no ahead/behind", () => {
		expect(
			plainBaseDiff({
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 0,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			}),
		).toBe("equal");
	});

	test("shows ahead only", () => {
		expect(
			plainBaseDiff({
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 3,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			}),
		).toBe("3 ahead");
	});

	test("shows behind only", () => {
		expect(
			plainBaseDiff({
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 0,
				behind: 5,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			}),
		).toBe("5 behind");
	});

	test("shows both ahead and behind", () => {
		expect(
			plainBaseDiff({
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 2,
				behind: 3,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			}),
		).toBe("2 ahead, 3 behind");
	});

	test("returns 'merged' when mergedIntoBase is squash", () => {
		expect(
			plainBaseDiff({
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 11,
				behind: 1,
				mergedIntoBase: "squash",
				baseMergedIntoDefault: null,
				detectedPr: null,
			}),
		).toBe("merged");
	});

	test("returns 'merged' when mergedIntoBase is merge", () => {
		expect(
			plainBaseDiff({
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 0,
				behind: 3,
				mergedIntoBase: "merge",
				baseMergedIntoDefault: null,
				detectedPr: null,
			}),
		).toBe("merged");
	});

	test("shows base merged when baseMergedIntoDefault is set", () => {
		expect(
			plainBaseDiff({
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 0,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: "merge",
				detectedPr: null,
			}),
		).toBe("base merged");
	});
});

describe("plainRemoteDiff", () => {
	test("shows gone+merged", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
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
		);
		expect(text).toBe("merged, gone");
	});

	test("shows merged with PR number and gone", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 0,
					mergedIntoBase: "squash",
					baseMergedIntoDefault: null,
					detectedPr: { number: 123, url: "https://github.com/acme/repo/pull/123" },
				},
			}),
		);
		expect(text).toBe("merged (#123), gone");
	});

	test("shows merged with PR number without gone", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: "my-branch", refMode: "configured", toPush: 0, toPull: 0, rebased: null },
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
			}),
		);
		expect(text).toBe("merged (#42)");
	});

	test("shows gone with ahead", () => {
		const text = plainRemoteDiff(
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
		);
		expect(text).toBe("gone, 3 to push");
	});

	test("shows gone plain", () => {
		const text = plainRemoteDiff(
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
		);
		expect(text).toBe("gone");
	});

	test("shows merged when toPull is 0", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 0, rebased: null },
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
		);
		expect(text).toBe("merged");
	});

	test("shows pull count instead of merged when toPull > 0", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
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
		);
		expect(text).toBe("3 to pull");
	});

	test("shows noRef with ahead", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "noRef", toPush: null, toPull: null, rebased: null },
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
			}),
		);
		expect(text).toBe("2 to push");
	});

	test("shows not pushed for noRef with no ahead", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "noRef", toPush: null, toPull: null, rebased: null },
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
		);
		expect(text).toBe("not pushed");
	});

	test("shows up to date", () => {
		const text = plainRemoteDiff(makeRepo());
		expect(text).toBe("up to date");
	});

	test("shows push/pull counts", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 3, rebased: null },
			}),
		);
		expect(text).toBe("2 to push, 3 to pull");
	});

	test("shows rebased counts", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 3, toPull: 2, rebased: 2 },
			}),
		);
		expect(text).toBe("1 to push, 2 rebased");
	});

	test("shows rebased-only when all pushes are rebased", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 2, rebased: 2 },
			}),
		);
		expect(text).toBe("2 rebased");
	});

	test("shows merged with new commits to push (not gone)", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 1, toPull: 0, rebased: null },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 12,
					behind: 1,
					mergedIntoBase: "squash",
					newCommitsAfterMerge: 1,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
		);
		expect(text).toBe("merged, 1 to push");
	});

	test("shows merged with PR and new commits to push (not gone)", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 1, toPull: 0, rebased: null },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 12,
					behind: 1,
					mergedIntoBase: "squash",
					newCommitsAfterMerge: 1,
					baseMergedIntoDefault: null,
					detectedPr: { number: 42, url: null },
				},
			}),
		);
		expect(text).toBe("merged (#42), 1 to push");
	});

	test("shows merged with new commits to push (gone)", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 12,
					behind: 1,
					mergedIntoBase: "squash",
					newCommitsAfterMerge: 1,
					baseMergedIntoDefault: null,
					detectedPr: { number: 1, url: "https://github.com/acme/repo/pull/1" },
				},
			}),
		);
		expect(text).toBe("merged (#1), gone, 1 to push");
	});

	test("shows merged without push count when no new commits", () => {
		const text = plainRemoteDiff(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 0, rebased: null },
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
		);
		expect(text).toBe("merged");
	});
});

describe("plainLocal", () => {
	test("shows clean when no changes", () => {
		expect(plainLocal(makeRepo())).toBe("clean");
	});

	test("shows staged and modified", () => {
		const text = plainLocal(makeRepo({ local: { staged: 2, modified: 3, untracked: 0, conflicts: 0 } }));
		expect(text).toBe("2 staged, 3 modified");
	});

	test("shows all local change types", () => {
		const text = plainLocal(makeRepo({ local: { staged: 1, modified: 2, untracked: 3, conflicts: 4 } }));
		expect(text).toBe("4 conflicts, 1 staged, 2 modified, 3 untracked");
	});

	test("shows operation suffix", () => {
		const text = plainLocal(makeRepo({ operation: "rebase" }));
		expect(text).toBe("clean (rebase)");
	});

	test("shows shallow suffix", () => {
		const text = plainLocal(
			makeRepo({
				identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
			}),
		);
		expect(text).toBe("clean (shallow)");
	});

	test("shows combined suffix", () => {
		const text = plainLocal(
			makeRepo({
				operation: "merge",
				identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
			}),
		);
		expect(text).toBe("clean (merge, shallow)");
	});

	test("shows changes with operation suffix", () => {
		const text = plainLocal(
			makeRepo({
				local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
				operation: "rebase",
			}),
		);
		expect(text).toBe("1 staged (rebase)");
	});
});

describe("plainCells", () => {
	test("basic repo returns expected cells", () => {
		const cells = plainCells(makeRepo());
		expect(cells.repo).toBe("test-repo");
		expect(cells.branch).toBe("feature");
		expect(cells.baseName).toBe("origin/main");
		expect(cells.baseDiff).toBe("equal");
		expect(cells.remoteName).toBe("origin/feature");
		expect(cells.remoteDiff).toBe("up to date");
		expect(cells.local).toBe("clean");
	});

	test("detached HEAD", () => {
		const cells = plainCells(
			makeRepo({
				identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
			}),
		);
		expect(cells.branch).toBe("(detached)");
		expect(cells.baseDiff).toBe("");
		expect(cells.remoteName).toBe("detached");
		expect(cells.remoteDiff).toBe("");
	});

	test("configured base shows configuredRef in baseName", () => {
		const cells = plainCells(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: "feat/old",
					ahead: 0,
					behind: 0,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
		);
		expect(cells.baseName).toBe("origin/feat/old");
		expect(cells.baseDiff).toBe("not found");
	});

	test("configured base with baseMergedIntoDefault shows base merged", () => {
		const cells = plainCells(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: "feat/old",
					ahead: 0,
					behind: 0,
					mergedIntoBase: null,
					baseMergedIntoDefault: "merge",
					detectedPr: null,
				},
			}),
		);
		expect(cells.baseName).toBe("origin/feat/old");
		expect(cells.baseDiff).toBe("base merged");
	});

	test("no base branch", () => {
		const cells = plainCells(makeRepo({ base: null }));
		expect(cells.baseName).toBe("");
		expect(cells.baseDiff).toBe("");
	});
});
