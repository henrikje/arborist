import { describe, expect, test } from "bun:test";
import { makeRepo } from "../status/test-helpers";
import type { SectionNode } from "./model";
import { formatVerboseDetail, verboseDetailToNodes } from "./status-verbose";

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

// ── verboseDetailToNodes ──

function sections(nodes: ReturnType<typeof verboseDetailToNodes>): SectionNode[] {
	return nodes.filter((n): n is SectionNode => n.kind === "section");
}

describe("verboseDetailToNodes", () => {
	test("returns empty for repo with no verbose data", () => {
		const repo = makeRepo();
		expect(verboseDetailToNodes(repo, undefined)).toEqual([]);
	});

	test("returns empty for repo with empty verbose detail", () => {
		const repo = makeRepo();
		expect(verboseDetailToNodes(repo, {})).toEqual([]);
	});

	test("merged into base produces section with correct header", () => {
		const repo = makeRepo({
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
		});
		const nodes = verboseDetailToNodes(repo, undefined);
		const secs = sections(nodes);
		expect(secs).toHaveLength(1);
		expect(secs[0]?.header.plain).toBe("Branch merged into origin/main (merge)");
		expect(secs[0]?.items).toHaveLength(0);
	});

	test("merged into base with squash strategy", () => {
		const repo = makeRepo({
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
		});
		const secs = sections(verboseDetailToNodes(repo, undefined));
		expect(secs[0]?.header.plain).toContain("(squash)");
	});

	test("merged with detected PR shows PR info in header", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 0,
				behind: 0,
				mergedIntoBase: "merge",
				baseMergedIntoDefault: null,
				detectedPr: { number: 42, url: "https://github.com/org/repo/pull/42" },
			},
		});
		const secs = sections(verboseDetailToNodes(repo, undefined));
		expect(secs[0]?.header.plain).toContain("detected PR #42");
		expect(secs[0]?.header.plain).toContain("https://github.com/org/repo/pull/42");
	});

	test("new commits after merge shows attention section", () => {
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
				detectedPr: null,
			},
		});
		const secs = sections(verboseDetailToNodes(repo, undefined));
		expect(secs).toHaveLength(2);
		expect(secs[1]?.header.plain).toContain("2 new commits after merge");
		expect(secs[1]?.header.spans[0]?.attention).toBe("attention");
	});

	test("base merged into default shows two header-only sections", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: "feature-base",
				ahead: 0,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: "merge",
				detectedPr: null,
			},
		});
		const secs = sections(verboseDetailToNodes(repo, undefined));
		expect(secs.some((s) => s.header.plain.includes("Base branch feature-base has been merged into default"))).toBe(
			true,
		);
		expect(secs.some((s) => s.header.plain.includes("Run 'arb rebase --retarget'"))).toBe(true);
	});

	test("configured base not found shows two header-only sections", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: "missing-branch",
				ahead: 0,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
		});
		const secs = sections(verboseDetailToNodes(repo, undefined));
		expect(secs.some((s) => s.header.plain.includes("Configured base branch missing-branch not found on origin"))).toBe(
			true,
		);
		expect(secs.some((s) => s.header.plain.includes("Run 'arb rebase --retarget'"))).toBe(true);
	});

	test("ahead of base produces section with commit items", () => {
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
		const secs = sections(verboseDetailToNodes(repo, verbose));
		expect(secs).toHaveLength(1);
		expect(secs[0]?.header.plain).toBe("Ahead of origin/main:");
		expect(secs[0]?.items).toHaveLength(2);
		expect(secs[0]?.items[0]?.plain).toBe("aaa1234 commit 1");
		expect(secs[0]?.items[0]?.spans[0]?.attention).toBe("muted"); // hash
		expect(secs[0]?.items[0]?.spans[1]?.attention).toBe("default"); // subject
	});

	test("ahead with merged commits shows muted suffix and header counts", () => {
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
		const secs = sections(verboseDetailToNodes(repo, verbose));
		const aheadSection = secs.find((s) => s.header.plain.includes("Ahead of"));
		expect(aheadSection).toBeDefined();
		expect(aheadSection?.header.plain).toContain("(1 new, 2 already merged)");
		// First commit (new) has no merge tag
		expect(aheadSection?.items[0]?.plain).toBe("aaa1234 new commit");
		// Merged commits get muted tag
		expect(aheadSection?.items[1]?.plain).toContain("(merged as abcdef1)");
		const mergeSpan = aheadSection?.items[1]?.spans.find((s) => s.text.includes("merged as"));
		expect(mergeSpan?.attention).toBe("muted");
	});

	test("behind base produces section with commit items and rebase tags", () => {
		const repo = makeRepo({
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
		});
		const verbose = {
			behindBase: [
				{
					hash: "xxx",
					shortHash: "xxx1234",
					subject: "upstream commit 1",
					rebaseOf: { hash: "local1", shortHash: "loc1234" },
				},
				{
					hash: "yyy",
					shortHash: "yyy1234",
					subject: "upstream commit 2",
					squashOf: { hashes: ["a", "b", "c"], shortHashes: ["aaa1234", "bbb1234", "ccc1234"] },
				},
			],
		};
		const secs = sections(verboseDetailToNodes(repo, verbose));
		expect(secs).toHaveLength(1);
		expect(secs[0]?.header.plain).toBe("Behind origin/main:");
		expect(secs[0]?.items[0]?.plain).toContain("(same as loc1234)");
		expect(secs[0]?.items[1]?.plain).toContain("(squash of aaa1234..ccc1234)");
	});

	test("unpushed commits produce section", () => {
		const repo = makeRepo({
			share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
		});
		const verbose = {
			unpushed: [
				{ hash: "aaa", shortHash: "aaa1234", subject: "commit 1", rebased: false },
				{ hash: "bbb", shortHash: "bbb1234", subject: "commit 2", rebased: true },
			],
		};
		const secs = sections(verboseDetailToNodes(repo, verbose));
		expect(secs).toHaveLength(1);
		expect(secs[0]?.header.plain).toBe("Unpushed to origin/feature:");
		expect(secs[0]?.items[0]?.plain).toBe("aaa1234 commit 1");
		expect(secs[0]?.items[1]?.plain).toContain("(rebased)");
	});

	test("suppresses unpushed when merged and all commits covered by ahead", () => {
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
		const secs = sections(verboseDetailToNodes(repo, verbose));
		expect(secs.some((s) => s.header.plain.includes("Unpushed"))).toBe(false);
	});

	test("staged files produce section", () => {
		const repo = makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } });
		const verbose = {
			staged: [{ file: "src/index.ts", type: "modified" as const }],
		};
		const secs = sections(verboseDetailToNodes(repo, verbose));
		expect(secs).toHaveLength(1);
		expect(secs[0]?.header.plain).toBe("Changes to be committed:");
		expect(secs[0]?.items[0]?.plain).toContain("src/index.ts");
	});

	test("untracked files produce section", () => {
		const repo = makeRepo({ local: { staged: 0, modified: 0, untracked: 2, conflicts: 0 } });
		const verbose = {
			untracked: ["new-file.ts", "temp.log"],
		};
		const secs = sections(verboseDetailToNodes(repo, verbose));
		expect(secs).toHaveLength(1);
		expect(secs[0]?.header.plain).toBe("Untracked files:");
		expect(secs[0]?.items).toHaveLength(2);
	});

	test("output starts with gap and ends with trailing gap", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 1,
				behind: 0,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
		});
		const verbose = {
			aheadOfBase: [{ hash: "aaa", shortHash: "aaa1234", subject: "commit 1" }],
		};
		const nodes = verboseDetailToNodes(repo, verbose);
		expect(nodes[0]?.kind).toBe("gap");
		expect(nodes[nodes.length - 1]?.kind).toBe("gap");
	});

	test("multiple sections each preceded by gap", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 1,
				behind: 1,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
			share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 1, toPull: 0, rebased: null },
		});
		const verbose = {
			aheadOfBase: [{ hash: "aaa", shortHash: "aaa1234", subject: "commit 1" }],
			behindBase: [{ hash: "bbb", shortHash: "bbb1234", subject: "commit 2" }],
			unpushed: [{ hash: "aaa", shortHash: "aaa1234", subject: "commit 1", rebased: false }],
		};
		const nodes = verboseDetailToNodes(repo, verbose);
		const secs = sections(nodes);
		expect(secs).toHaveLength(3); // ahead, behind, unpushed
		// Each section is preceded by a gap
		for (let i = 0; i < nodes.length; i++) {
			if (nodes[i]?.kind === "section") {
				expect(nodes[i - 1]?.kind).toBe("gap");
			}
		}
	});
});
