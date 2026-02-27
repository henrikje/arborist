import { describe, expect, test } from "bun:test";
import { type RepoAssessment, classifyRepo, formatIntegratePlan } from "./integrate";
import { formatVerboseCommits } from "./status-verbose";
import { makeRepo } from "./test-helpers";

const DIR = "/tmp/test-repo";
const SHA = "abc1234";

describe("classifyRepo", () => {
	test("up-to-date when behind base is 0", () => {
		const a = classifyRepo(makeRepo(), DIR, "feature", [], false, SHA);
		expect(a.outcome).toBe("up-to-date");
		expect(a.baseBranch).toBe("main");
	});

	test("will-operate when behind base > 0", () => {
		const a = classifyRepo(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 1,
					behind: 3,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
				},
			}),
			DIR,
			"feature",
			[],
			false,
			SHA,
		);
		expect(a.outcome).toBe("will-operate");
		expect(a.behind).toBe(3);
		expect(a.ahead).toBe(1);
		expect(a.baseBranch).toBe("main");
	});

	test("skips when fetch failed", () => {
		const a = classifyRepo(makeRepo(), DIR, "feature", ["test-repo"], false, SHA);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("fetch failed");
		expect(a.skipFlag).toBe("fetch-failed");
	});

	test("skips when operation in progress", () => {
		const a = classifyRepo(makeRepo({ operation: "rebase" }), DIR, "feature", [], false, SHA);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("rebase in progress");
		expect(a.skipFlag).toBe("operation-in-progress");
	});

	test("skips detached HEAD", () => {
		const a = classifyRepo(
			makeRepo({ identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false } }),
			DIR,
			"feature",
			[],
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("HEAD is detached");
		expect(a.skipFlag).toBe("detached-head");
	});

	test("skips drifted branch", () => {
		const a = classifyRepo(
			makeRepo({
				identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
			}),
			DIR,
			"feature",
			[],
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("on branch other, expected feature");
		expect(a.skipFlag).toBe("drifted");
	});

	test("skips dirty without autostash", () => {
		const a = classifyRepo(
			makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
			DIR,
			"feature",
			[],
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("uncommitted changes");
		expect(a.skipReason).toContain("--autostash");
		expect(a.skipFlag).toBe("dirty");
	});

	test("sets needsStash when dirty with autostash and staged files", () => {
		const a = classifyRepo(
			makeRepo({
				local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 3,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
				},
			}),
			DIR,
			"feature",
			[],
			true,
			SHA,
		);
		expect(a.outcome).toBe("will-operate");
		expect(a.needsStash).toBe(true);
	});

	test("sets needsStash when dirty with autostash and modified files", () => {
		const a = classifyRepo(
			makeRepo({
				local: { staged: 0, modified: 3, untracked: 0, conflicts: 0 },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 3,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
				},
			}),
			DIR,
			"feature",
			[],
			true,
			SHA,
		);
		expect(a.outcome).toBe("will-operate");
		expect(a.needsStash).toBe(true);
	});

	test("does not set needsStash when only untracked files with autostash", () => {
		const a = classifyRepo(
			makeRepo({
				local: { staged: 0, modified: 0, untracked: 5, conflicts: 0 },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 3,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
				},
			}),
			DIR,
			"feature",
			[],
			true,
			SHA,
		);
		expect(a.outcome).toBe("will-operate");
		expect(a.needsStash).toBeUndefined();
	});

	test("skips when no base branch", () => {
		const a = classifyRepo(makeRepo({ base: null }), DIR, "feature", [], false, SHA);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("no base branch");
		expect(a.skipFlag).toBe("no-base-branch");
	});

	test("skips when no base remote", () => {
		const a = classifyRepo(
			makeRepo({
				base: {
					remote: null,
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 0,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
				},
			}),
			DIR,
			"feature",
			[],
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("no base remote");
		expect(a.skipFlag).toBe("no-base-remote");
	});

	test("skips when base branch merged into default", () => {
		const a = classifyRepo(
			makeRepo({
				base: {
					remote: "origin",
					ref: "feat/auth",
					configuredRef: "feat/auth",
					ahead: 0,
					behind: 3,
					mergedIntoBase: null,
					baseMergedIntoDefault: "merge",
				},
			}),
			DIR,
			"feature",
			[],
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("base branch feat/auth was merged into default");
		expect(a.skipReason).toContain("--retarget");
		expect(a.skipFlag).toBe("base-merged-into-default");
	});

	test("baseMergedIntoDefault falls back to ref when configuredRef is null", () => {
		const a = classifyRepo(
			makeRepo({
				base: {
					remote: "origin",
					ref: "develop",
					configuredRef: null,
					ahead: 0,
					behind: 3,
					mergedIntoBase: null,
					baseMergedIntoDefault: "merge",
				},
			}),
			DIR,
			"feature",
			[],
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("base branch develop was merged into default");
		expect(a.skipFlag).toBe("base-merged-into-default");
	});

	test("shallow passes through", () => {
		const a = classifyRepo(
			makeRepo({
				identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
			}),
			DIR,
			"feature",
			[],
			false,
			SHA,
		);
		expect(a.shallow).toBe(true);
	});

	test("headSha passes through", () => {
		const a = classifyRepo(makeRepo(), DIR, "feature", [], false, "deadbeef");
		expect(a.headSha).toBe("deadbeef");
	});

	test("baseRemote is set from base.remote", () => {
		const a = classifyRepo(makeRepo(), DIR, "feature", [], false, SHA);
		expect(a.baseRemote).toBe("origin");
	});

	test("ahead passes through for up-to-date", () => {
		const a = classifyRepo(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 5,
					behind: 0,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
				},
			}),
			DIR,
			"feature",
			[],
			false,
			SHA,
		);
		expect(a.outcome).toBe("up-to-date");
		expect(a.ahead).toBe(5);
	});
});

describe("formatIntegratePlan", () => {
	function makeAssessment(overrides: Partial<RepoAssessment> = {}): RepoAssessment {
		return {
			repo: "repo-a",
			repoDir: "/tmp/repo-a",
			outcome: "will-operate",
			behind: 3,
			ahead: 1,
			baseRemote: "origin",
			baseBranch: "main",
			headSha: "abc1234",
			shallow: false,
			...overrides,
		};
	}

	test("shows rebase action", () => {
		const plan = formatIntegratePlan([makeAssessment()], "rebase", "feature");
		expect(plan).toContain("rebase feature onto origin/main");
	});

	test("shows merge action", () => {
		const plan = formatIntegratePlan([makeAssessment()], "merge", "feature");
		expect(plan).toContain("merge origin/main into feature");
	});

	test("shows behind/ahead counts", () => {
		const plan = formatIntegratePlan([makeAssessment({ behind: 5, ahead: 2 })], "rebase", "feature");
		expect(plan).toContain("5 behind");
		expect(plan).toContain("2 ahead");
	});

	test("shows fast-forward for merge with ahead=0", () => {
		const plan = formatIntegratePlan([makeAssessment({ ahead: 0 })], "merge", "feature");
		expect(plan).toContain("(fast-forward)");
	});

	test("shows three-way for merge with ahead>0", () => {
		const plan = formatIntegratePlan([makeAssessment({ ahead: 2 })], "merge", "feature");
		expect(plan).toContain("(three-way)");
	});

	test("shows conflict likely for rebase", () => {
		const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "conflict" })], "rebase", "feature");
		expect(plan).toContain("conflict likely");
	});

	test("shows will conflict for merge", () => {
		const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "conflict" })], "merge", "feature");
		expect(plan).toContain("will conflict");
	});

	test("shows no conflict for rebase with no-conflict prediction", () => {
		const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "no-conflict" })], "rebase", "feature");
		expect(plan).toContain("no conflict");
	});

	test("shows no conflict for merge with no-conflict prediction", () => {
		const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "no-conflict" })], "merge", "feature");
		expect(plan).toContain("no conflict");
	});

	test("shows conflict unlikely for rebase", () => {
		const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "clean" })], "rebase", "feature");
		expect(plan).toContain("conflict unlikely");
	});

	test("shows no conflict for merge", () => {
		const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "clean" })], "merge", "feature");
		expect(plan).toContain("no conflict");
	});

	test("shows retarget display", () => {
		const plan = formatIntegratePlan(
			[makeAssessment({ retargetFrom: "feat/old", retargetTo: "main", baseBranch: "main" })],
			"rebase",
			"feature",
		);
		expect(plan).toContain("rebase onto origin/main from feat/old (retarget)");
	});

	test("shows retarget warning", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					retargetFrom: "feat/old",
					retargetTo: "main",
					baseBranch: "main",
					retargetWarning: "base branch feat/old may not be merged",
				}),
			],
			"rebase",
			"feature",
		);
		expect(plan).toContain("base branch feat/old may not be merged");
	});

	test("shows retarget with autostash hint", () => {
		const plan = formatIntegratePlan(
			[makeAssessment({ retargetFrom: "feat/old", retargetTo: "main", baseBranch: "main", needsStash: true })],
			"rebase",
			"feature",
		);
		expect(plan).toContain("(retarget)");
		expect(plan).toContain("(autostash)");
	});

	test("shows retarget with stash pop conflict likely", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					retargetFrom: "feat/old",
					retargetTo: "main",
					baseBranch: "main",
					needsStash: true,
					stashPopConflictFiles: ["file.ts"],
				}),
			],
			"rebase",
			"feature",
		);
		expect(plan).toContain("(retarget)");
		expect(plan).toContain("stash pop conflict likely");
	});

	test("shows retarget with stash pop conflict unlikely", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					retargetFrom: "feat/old",
					retargetTo: "main",
					baseBranch: "main",
					needsStash: true,
					stashPopConflictFiles: [],
				}),
			],
			"rebase",
			"feature",
		);
		expect(plan).toContain("(retarget)");
		expect(plan).toContain("stash pop conflict unlikely");
	});

	test("shows autostash hint", () => {
		const plan = formatIntegratePlan([makeAssessment({ needsStash: true })], "rebase", "feature");
		expect(plan).toContain("(autostash)");
	});

	test("shows stash pop conflict likely hint", () => {
		const plan = formatIntegratePlan(
			[makeAssessment({ needsStash: true, stashPopConflictFiles: ["file.ts"] })],
			"rebase",
			"feature",
		);
		expect(plan).toContain("stash pop conflict likely");
	});

	test("shows stash pop conflict unlikely hint", () => {
		const plan = formatIntegratePlan(
			[makeAssessment({ needsStash: true, stashPopConflictFiles: [] })],
			"rebase",
			"feature",
		);
		expect(plan).toContain("stash pop conflict unlikely");
	});

	test("shows up-to-date", () => {
		const plan = formatIntegratePlan([makeAssessment({ outcome: "up-to-date" })], "rebase", "feature");
		expect(plan).toContain("up to date");
	});

	test("shows skipped with reason", () => {
		const plan = formatIntegratePlan(
			[makeAssessment({ outcome: "skip", skipReason: "HEAD is detached" })],
			"rebase",
			"feature",
		);
		expect(plan).toContain("skipped");
		expect(plan).toContain("HEAD is detached");
	});

	test("shows shallow clone warning", () => {
		const plan = formatIntegratePlan([makeAssessment({ shallow: true })], "rebase", "feature");
		expect(plan).toContain("shallow clone");
		expect(plan).toContain("rebase may fail");
	});

	test("no shallow warning when not shallow", () => {
		const plan = formatIntegratePlan([makeAssessment({ shallow: false })], "rebase", "feature");
		expect(plan).not.toContain("shallow clone");
	});

	test("shows verbose commits when verbose is true", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					commits: [
						{ shortHash: "def5678", subject: "feat: add new auth flow" },
						{ shortHash: "890abcd", subject: "fix: handle edge case" },
					],
					totalCommits: 2,
				}),
			],
			"rebase",
			"feature",
			true,
		);
		expect(plan).toContain("Incoming from origin/main:");
		expect(plan).toContain("def5678");
		expect(plan).toContain("feat: add new auth flow");
		expect(plan).toContain("890abcd");
		expect(plan).toContain("fix: handle edge case");
	});

	test("does not show verbose commits when verbose is false", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					commits: [{ shortHash: "def5678", subject: "feat: add new auth flow" }],
					totalCommits: 1,
				}),
			],
			"rebase",
			"feature",
			false,
		);
		expect(plan).not.toContain("Incoming from");
		expect(plan).not.toContain("def5678");
	});

	test("shows truncation hint when totalCommits exceeds commit list", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					commits: [{ shortHash: "def5678", subject: "feat: something" }],
					totalCommits: 30,
				}),
			],
			"rebase",
			"feature",
			true,
		);
		expect(plan).toContain("... and 29 more");
	});

	test("does not show verbose commits for up-to-date repos", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					outcome: "up-to-date",
					commits: [{ shortHash: "def5678", subject: "feat: something" }],
					totalCommits: 1,
				}),
			],
			"rebase",
			"feature",
			true,
		);
		expect(plan).not.toContain("Incoming from");
	});

	test("does not show verbose commits for skipped repos", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					outcome: "skip",
					skipReason: "HEAD is detached",
					commits: [{ shortHash: "def5678", subject: "feat: something" }],
					totalCommits: 1,
				}),
			],
			"rebase",
			"feature",
			true,
		);
		expect(plan).not.toContain("Incoming from");
	});

	test("shows matched count breakdown in behind string", () => {
		const plan = formatIntegratePlan(
			[makeAssessment({ behind: 5, ahead: 3, matchedCount: 3 })],
			"rebase",
			"feature",
			true,
		);
		expect(plan).toContain("5 behind (3 same, 2 new)");
	});

	test("preserves existing behind format when matchedCount is 0", () => {
		const plan = formatIntegratePlan([makeAssessment({ behind: 5, ahead: 3, matchedCount: 0 })], "rebase", "feature");
		expect(plan).toContain("5 behind");
		expect(plan).not.toContain("same");
		expect(plan).not.toContain("new)");
	});

	test("preserves existing behind format when matchedCount is undefined", () => {
		const plan = formatIntegratePlan([makeAssessment({ behind: 5, ahead: 3 })], "rebase", "feature");
		expect(plan).toContain("5 behind");
		expect(plan).not.toContain("same");
		expect(plan).not.toContain("new)");
	});

	test("shows rebaseOf annotation on verbose commits", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					commits: [
						{ shortHash: "abc1234", subject: "feat: add auth flow", rebaseOf: "def5678" },
						{ shortHash: "890abcd", subject: "fix: typo in readme" },
					],
					totalCommits: 2,
				}),
			],
			"rebase",
			"feature",
			true,
		);
		expect(plan).toContain("(same as def5678)");
		// The unannotated commit should appear without a tag
		expect(plan).toContain("890abcd");
		expect(plan).toContain("fix: typo in readme");
		expect(plan).not.toContain("890abcd fix: typo in readme (same as");
		expect(plan).not.toContain("890abcd fix: typo in readme (squash of");
	});

	test("shows squashOf annotation on verbose commits", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					commits: [{ shortHash: "fed4321", subject: "squash: combine changes", squashOf: ["aaa1111", "bbb2222"] }],
					totalCommits: 1,
				}),
			],
			"rebase",
			"feature",
			true,
		);
		expect(plan).toContain("(squash of aaa1111..bbb2222)");
	});

	// ── Graph tests ─────────────────────────────────────────────

	test("shows graph for will-operate repos", () => {
		const plan = formatIntegratePlan([makeAssessment({ mergeBaseSha: "ghi9012" })], "rebase", "feature", false, true);
		expect(plan).toContain("merge-base");
		expect(plan).toContain("ghi9012");
		expect(plan).toContain("origin/main");
	});

	test("does not show graph for up-to-date repos", () => {
		const plan = formatIntegratePlan(
			[makeAssessment({ outcome: "up-to-date", mergeBaseSha: "ghi9012" })],
			"rebase",
			"feature",
			false,
			true,
		);
		expect(plan).not.toContain("merge-base");
	});

	test("does not show graph for skipped repos", () => {
		const plan = formatIntegratePlan(
			[makeAssessment({ outcome: "skip", skipReason: "HEAD is detached", mergeBaseSha: "ghi9012" })],
			"rebase",
			"feature",
			false,
			true,
		);
		expect(plan).not.toContain("merge-base");
	});

	test("graph suppresses separate verbose section when both flags are true", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					mergeBaseSha: "ghi9012",
					commits: [{ shortHash: "def5678", subject: "feat: add new auth flow" }],
					totalCommits: 1,
				}),
			],
			"rebase",
			"feature",
			true,
			true,
		);
		// Graph should be present
		expect(plan).toContain("merge-base");
		// Separate "Incoming from..." section should NOT be present
		expect(plan).not.toContain("Incoming from");
	});

	test("shows diff stats on verbose label when diffStats present", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					commits: [{ shortHash: "def5678", subject: "feat: add auth" }],
					totalCommits: 1,
					diffStats: { files: 47, insertions: 320, deletions: 180 },
				}),
			],
			"rebase",
			"feature",
			true,
		);
		expect(plan).toContain("47 files changed, +320, -180");
	});

	test("does not show diff stats when diffStats is undefined", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					commits: [{ shortHash: "def5678", subject: "feat: add auth" }],
					totalCommits: 1,
				}),
			],
			"rebase",
			"feature",
			true,
		);
		expect(plan).not.toContain("files changed");
	});

	test("retarget repos get retarget-style graph", () => {
		const plan = formatIntegratePlan(
			[
				makeAssessment({
					retargetFrom: "feat/old",
					retargetTo: "main",
					baseBranch: "main",
					mergeBaseSha: "xyz7890",
				}),
			],
			"rebase",
			"feature",
			false,
			true,
		);
		expect(plan).toContain("--x--");
		expect(plan).toContain("feat/old");
		expect(plan).toContain("old base, merged");
		expect(plan).toContain("new base");
	});
});

describe("formatVerboseCommits", () => {
	test("appends diff stats to label when provided", () => {
		const out = formatVerboseCommits(
			[{ shortHash: "abc1234", subject: "feat: something" }],
			1,
			"Incoming from origin/main:",
			{ diffStats: { files: 5, insertions: 100, deletions: 20 } },
		);
		expect(out).toContain("5 files changed, +100, -20");
		expect(out).toContain("abc1234");
	});

	test("uses singular 'file' for 1 file", () => {
		const out = formatVerboseCommits(
			[{ shortHash: "abc1234", subject: "feat: something" }],
			1,
			"Incoming from origin/main:",
			{ diffStats: { files: 1, insertions: 10, deletions: 5 } },
		);
		expect(out).toContain("1 file changed");
		expect(out).not.toContain("1 files changed");
	});

	test("does not modify label when no options provided", () => {
		const out = formatVerboseCommits(
			[{ shortHash: "abc1234", subject: "feat: something" }],
			1,
			"Incoming from origin/main:",
		);
		expect(out).toContain("Incoming from origin/main:");
		expect(out).not.toContain("files changed");
	});
});
