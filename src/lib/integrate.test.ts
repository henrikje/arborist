import { describe, expect, test } from "bun:test";
import { type RepoAssessment, classifyRepo, formatIntegratePlan } from "./integrate";
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
	});

	test("skips when operation in progress", () => {
		const a = classifyRepo(makeRepo({ operation: "rebase" }), DIR, "feature", [], false, SHA);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("rebase in progress");
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
});
