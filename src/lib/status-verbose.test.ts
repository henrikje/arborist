import { describe, expect, test } from "bun:test";
import { formatVerboseDetail } from "./status-verbose";
import { makeRepo } from "./test-helpers";

describe("formatVerboseDetail", () => {
	test("annotates already-merged commits with merge commit hash", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 3,
				behind: 1,
				mergedIntoBase: "squash",
				newCommitsAfterMerge: 1,
				mergeCommitHash: "abcdef1234567890",
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
		});
		const verbose = {
			aheadOfBase: [
				{ hash: "aaa", shortHash: "aaa1234", subject: "new commit" },
				{ hash: "bbb", shortHash: "bbb1234", subject: "old commit 1" },
				{ hash: "ccc", shortHash: "ccc1234", subject: "old commit 2" },
			],
		};
		const output = formatVerboseDetail(repo, verbose);
		expect(output).toContain("(1 new, 2 already merged)");
		expect(output).toContain("aaa1234 new commit");
		expect(output).not.toContain("aaa1234 new commit (");
		expect(output).toContain("bbb1234 old commit 1 (merged as abcdef1)");
		expect(output).toContain("ccc1234 old commit 2 (merged as abcdef1)");
	});

	test("annotates new commits that have a rebase match on base", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 2,
				behind: 2,
				mergedIntoBase: "squash",
				newCommitsAfterMerge: 1,
				mergeCommitHash: "squash123456",
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
		});
		const verbose = {
			aheadOfBase: [
				{
					hash: "aaa",
					shortHash: "aaa1234",
					subject: "fix: improve coverage",
					matchedOnBase: { hash: "xxx", shortHash: "xxx1234" },
				},
				{ hash: "bbb", shortHash: "bbb1234", subject: "feat: detect merge commits" },
			],
		};
		const output = formatVerboseDetail(repo, verbose);
		// The "new" commit has a base match — header should show 0 new, 2 already merged
		expect(output).toContain("(0 new, 2 already merged)");
		// The matched commit should show its base equivalent
		expect(output).toContain("aaa1234 fix: improve coverage (same as xxx1234)");
		// The old commit should show the merge hash
		expect(output).toContain("bbb1234 feat: detect merge commits (merged as squash1)");
	});

	test("suppresses unpushed section when merged and all commits are in ahead-of-base", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 1,
				behind: 0,
				mergedIntoBase: "merge",
				newCommitsAfterMerge: 1,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 1, toPull: 0, rebased: null },
		});
		const verbose = {
			aheadOfBase: [{ hash: "aaa", shortHash: "aaa1234", subject: "new commit" }],
			unpushed: [{ hash: "aaa", shortHash: "aaa1234", subject: "new commit", rebased: false }],
		};
		const output = formatVerboseDetail(repo, verbose);
		expect(output).not.toContain("Unpushed to");
	});

	test("shows unpushed section when not merged even if commits overlap", () => {
		const repo = makeRepo({
			share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 1, toPull: 0, rebased: null },
		});
		const verbose = {
			aheadOfBase: [{ hash: "aaa", shortHash: "aaa1234", subject: "commit 1" }],
			unpushed: [{ hash: "aaa", shortHash: "aaa1234", subject: "commit 1", rebased: false }],
		};
		const output = formatVerboseDetail(repo, verbose);
		expect(output).toContain("Unpushed to origin/feature");
	});

	test("shows unpushed section when merged but unpushed has extra commits", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 1,
				behind: 0,
				mergedIntoBase: "merge",
				newCommitsAfterMerge: 1,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
		});
		const verbose = {
			aheadOfBase: [{ hash: "aaa", shortHash: "aaa1234", subject: "new commit" }],
			unpushed: [
				{ hash: "aaa", shortHash: "aaa1234", subject: "new commit", rebased: false },
				{ hash: "bbb", shortHash: "bbb1234", subject: "extra commit", rebased: false },
			],
		};
		const output = formatVerboseDetail(repo, verbose);
		expect(output).toContain("Unpushed to origin/feature");
	});

	test("unpushed label uses share.ref when available, falls back to remote", () => {
		const repoWithRef = makeRepo({
			share: { remote: "origin", ref: "origin/my-branch", refMode: "configured", toPush: 1, toPull: 0, rebased: null },
		});
		const repoNoRef = makeRepo({
			share: { remote: "origin", ref: null, refMode: "noRef", toPush: 1, toPull: 0, rebased: null },
		});
		const verbose = {
			unpushed: [{ hash: "aaa", shortHash: "aaa1234", subject: "commit", rebased: false }],
		};
		expect(formatVerboseDetail(repoWithRef, verbose)).toContain("Unpushed to origin/my-branch");
		expect(formatVerboseDetail(repoNoRef, verbose)).toContain("Unpushed to origin");
	});

	test("shows no annotations when no newCommitsAfterMerge", () => {
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
		});
		const verbose = {
			aheadOfBase: [
				{ hash: "aaa", shortHash: "aaa1234", subject: "commit 1" },
				{ hash: "bbb", shortHash: "bbb1234", subject: "commit 2" },
			],
		};
		const output = formatVerboseDetail(repo, verbose);
		expect(output).not.toContain("already merged");
		expect(output).not.toContain("merged as");
		expect(output).toContain("aaa1234 commit 1");
		expect(output).toContain("bbb1234 commit 2");
	});
});
