import { describe, expect, test } from "bun:test";
import type { RepoRemotes } from "../lib/remotes";
import { makeRepo } from "../lib/test-helpers";
import { type PullAssessment, assessPullRepo, formatPullPlan } from "./pull";

const DIR = "/tmp/test-repo";
const SHA = "abc1234";

describe("assessPullRepo", () => {
	test("up-to-date when nothing to pull", () => {
		const a = assessPullRepo(makeRepo(), DIR, "feature", [], "merge", false, SHA);
		expect(a.outcome).toBe("up-to-date");
	});

	test("skips when fetch failed", () => {
		const a = assessPullRepo(makeRepo(), DIR, "feature", ["test-repo"], "merge", false, SHA);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("fetch failed");
		expect(a.skipFlag).toBe("fetch-failed");
	});

	test("skips detached HEAD", () => {
		const a = assessPullRepo(
			makeRepo({ identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false } }),
			DIR,
			"feature",
			[],
			"merge",
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("HEAD is detached");
		expect(a.skipFlag).toBe("detached-head");
	});

	test("skips drifted branch", () => {
		const a = assessPullRepo(
			makeRepo({
				identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
			}),
			DIR,
			"feature",
			[],
			"merge",
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("on branch other, expected feature");
		expect(a.skipFlag).toBe("drifted");
	});

	test("skips dirty without autostash", () => {
		const a = assessPullRepo(
			makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
			DIR,
			"feature",
			[],
			"merge",
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("uncommitted changes");
		expect(a.skipReason).toContain("--autostash");
		expect(a.skipFlag).toBe("dirty");
	});

	test("sets needsStash when dirty with autostash and staged files", () => {
		const a = assessPullRepo(
			makeRepo({
				local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
			}),
			DIR,
			"feature",
			[],
			"merge",
			true,
			SHA,
		);
		expect(a.outcome).toBe("will-pull");
		expect(a.needsStash).toBe(true);
	});

	test("sets needsStash when dirty with autostash and modified files", () => {
		const a = assessPullRepo(
			makeRepo({
				local: { staged: 0, modified: 2, untracked: 0, conflicts: 0 },
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
			}),
			DIR,
			"feature",
			[],
			"merge",
			true,
			SHA,
		);
		expect(a.outcome).toBe("will-pull");
		expect(a.needsStash).toBe(true);
	});

	test("does not set needsStash when only untracked files with autostash", () => {
		const a = assessPullRepo(
			makeRepo({
				local: { staged: 0, modified: 0, untracked: 5, conflicts: 0 },
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
			}),
			DIR,
			"feature",
			[],
			"merge",
			true,
			SHA,
		);
		expect(a.outcome).toBe("will-pull");
		expect(a.needsStash).toBeUndefined();
	});

	test("skips when not pushed yet (noRef)", () => {
		const a = assessPullRepo(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "noRef", toPush: null, toPull: null, rebased: null },
			}),
			DIR,
			"feature",
			[],
			"merge",
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("not pushed yet");
		expect(a.skipFlag).toBe("not-pushed");
	});

	test("skips when remote branch gone", () => {
		const a = assessPullRepo(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
			}),
			DIR,
			"feature",
			[],
			"merge",
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("remote branch gone");
		expect(a.skipFlag).toBe("remote-gone");
	});

	test("skips when base branch merged into default", () => {
		const a = assessPullRepo(
			makeRepo({
				base: {
					remote: "origin",
					ref: "feat/auth",
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
			"merge",
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("base branch feat/auth was merged into default");
		expect(a.skipReason).toContain("retarget");
		expect(a.skipFlag).toBe("base-merged-into-default");
	});

	test("baseMergedIntoDefault shows configuredRef when set", () => {
		const a = assessPullRepo(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: "feat/old",
					ahead: 0,
					behind: 3,
					mergedIntoBase: null,
					baseMergedIntoDefault: "merge",
				},
			}),
			DIR,
			"feature",
			[],
			"merge",
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("base branch feat/old was merged into default");
	});

	test("skips when already merged into base and nothing to pull", () => {
		const a = assessPullRepo(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 0,
					mergedIntoBase: "merge",
					baseMergedIntoDefault: null,
				},
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 0, rebased: null },
			}),
			DIR,
			"feature",
			[],
			"merge",
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("already merged into main");
		expect(a.skipFlag).toBe("already-merged");
	});

	test("does not skip merged-into-base when toPull > 0", () => {
		const a = assessPullRepo(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 0,
					behind: 0,
					mergedIntoBase: "merge",
					baseMergedIntoDefault: null,
				},
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
			}),
			DIR,
			"feature",
			[],
			"merge",
			false,
			SHA,
		);
		expect(a.outcome).toBe("will-pull");
		expect(a.behind).toBe(3);
	});

	test("skips when rebased locally and rebased >= toPull", () => {
		const a = assessPullRepo(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 3, toPull: 2, rebased: 2 },
			}),
			DIR,
			"feature",
			[],
			"merge",
			false,
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("rebased locally");
		expect(a.skipReason).toContain("push --force");
		expect(a.skipFlag).toBe("rebased-locally");
	});

	test("will-pull when commits behind", () => {
		const a = assessPullRepo(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 5, rebased: null },
			}),
			DIR,
			"feature",
			[],
			"merge",
			false,
			SHA,
		);
		expect(a.outcome).toBe("will-pull");
		expect(a.behind).toBe(5);
		expect(a.toPush).toBe(0);
	});

	test("will-pull with diverged (toPush and toPull)", () => {
		const a = assessPullRepo(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 3, rebased: 1 },
			}),
			DIR,
			"feature",
			[],
			"rebase",
			false,
			SHA,
		);
		expect(a.outcome).toBe("will-pull");
		expect(a.behind).toBe(3);
		expect(a.toPush).toBe(2);
		expect(a.rebased).toBe(1);
	});

	test("pullMode passes through", () => {
		const a = assessPullRepo(makeRepo(), DIR, "feature", [], "rebase", false, SHA);
		expect(a.pullMode).toBe("rebase");
	});

	test("headSha passes through", () => {
		const a = assessPullRepo(makeRepo(), DIR, "feature", [], "merge", false, "deadbeef");
		expect(a.headSha).toBe("deadbeef");
	});
});

describe("formatPullPlan", () => {
	function makeAssessment(overrides: Partial<PullAssessment> = {}): PullAssessment {
		return {
			repo: "repo-a",
			repoDir: "/tmp/repo-a",
			outcome: "will-pull",
			behind: 3,
			toPush: 0,
			rebased: 0,
			pullMode: "merge",
			headSha: "abc1234",
			...overrides,
		};
	}

	function makeRemotesMap(...entries: [string, Partial<RepoRemotes>][]): Map<string, RepoRemotes> {
		const map = new Map<string, RepoRemotes>();
		for (const [repo, remotes] of entries) {
			map.set(repo, { base: "origin", share: "origin", ...remotes });
		}
		return map;
	}

	test("shows commit count for will-pull", () => {
		const plan = formatPullPlan([makeAssessment({ behind: 5 })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("5 commits to pull");
	});

	test("shows pull mode", () => {
		const plan = formatPullPlan([makeAssessment({ pullMode: "rebase" })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("(rebase");
	});

	test("shows rebased hint when rebased > 0", () => {
		const plan = formatPullPlan([makeAssessment({ rebased: 2 })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("2 rebased");
	});

	test("shows conflict likely hint", () => {
		const plan = formatPullPlan([makeAssessment({ conflictPrediction: "conflict" })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("conflict likely");
	});

	test("shows no conflict hint for no-conflict prediction", () => {
		const plan = formatPullPlan(
			[makeAssessment({ conflictPrediction: "no-conflict" })],
			makeRemotesMap(["repo-a", {}]),
		);
		expect(plan).toContain("no conflict");
	});

	test("shows conflict unlikely hint", () => {
		const plan = formatPullPlan([makeAssessment({ conflictPrediction: "clean" })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("conflict unlikely");
	});

	test("shows autostash hint", () => {
		const plan = formatPullPlan([makeAssessment({ needsStash: true })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("(autostash)");
	});

	test("shows stash pop conflict likely hint", () => {
		const plan = formatPullPlan(
			[makeAssessment({ needsStash: true, stashPopConflictFiles: ["file.ts"] })],
			makeRemotesMap(["repo-a", {}]),
		);
		expect(plan).toContain("stash pop conflict likely");
	});

	test("shows stash pop conflict unlikely hint", () => {
		const plan = formatPullPlan(
			[makeAssessment({ needsStash: true, stashPopConflictFiles: [] })],
			makeRemotesMap(["repo-a", {}]),
		);
		expect(plan).toContain("stash pop conflict unlikely");
	});

	test("shows up-to-date", () => {
		const plan = formatPullPlan([makeAssessment({ outcome: "up-to-date" })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("up to date");
	});

	test("shows skipped with reason", () => {
		const plan = formatPullPlan(
			[makeAssessment({ outcome: "skip", skipReason: "not pushed yet" })],
			makeRemotesMap(["repo-a", {}]),
		);
		expect(plan).toContain("skipped");
		expect(plan).toContain("not pushed yet");
	});

	test("shows fork suffix when base differs from share", () => {
		const plan = formatPullPlan([makeAssessment()], makeRemotesMap(["repo-a", { base: "upstream", share: "origin" }]));
		expect(plan).toContain("← origin");
	});

	test("no fork suffix when base equals share", () => {
		const plan = formatPullPlan([makeAssessment()], makeRemotesMap(["repo-a", { base: "origin", share: "origin" }]));
		expect(plan).not.toContain("←");
	});

	test("shows verbose commits when verbose is true", () => {
		const plan = formatPullPlan(
			[
				makeAssessment({
					commits: [
						{ shortHash: "ccc3333", subject: "feat: remote change" },
						{ shortHash: "ddd4444", subject: "fix: remote fix" },
					],
					totalCommits: 2,
				}),
			],
			makeRemotesMap(["repo-a", {}]),
			true,
		);
		expect(plan).toContain("Incoming from origin:");
		expect(plan).toContain("ccc3333");
		expect(plan).toContain("feat: remote change");
		expect(plan).toContain("ddd4444");
		expect(plan).toContain("fix: remote fix");
	});

	test("does not show verbose commits when verbose is false", () => {
		const plan = formatPullPlan(
			[
				makeAssessment({
					commits: [{ shortHash: "ccc3333", subject: "feat: remote change" }],
					totalCommits: 1,
				}),
			],
			makeRemotesMap(["repo-a", {}]),
			false,
		);
		expect(plan).not.toContain("Incoming from");
		expect(plan).not.toContain("ccc3333");
	});

	test("shows truncation hint for pull verbose", () => {
		const plan = formatPullPlan(
			[
				makeAssessment({
					commits: [{ shortHash: "ccc3333", subject: "feat: something" }],
					totalCommits: 30,
				}),
			],
			makeRemotesMap(["repo-a", {}]),
			true,
		);
		expect(plan).toContain("... and 29 more");
	});

	test("does not show verbose commits for up-to-date repos", () => {
		const plan = formatPullPlan(
			[
				makeAssessment({
					outcome: "up-to-date",
					commits: [{ shortHash: "ccc3333", subject: "feat: something" }],
					totalCommits: 1,
				}),
			],
			makeRemotesMap(["repo-a", {}]),
			true,
		);
		expect(plan).not.toContain("Incoming from");
	});

	test("does not show verbose commits for skipped repos", () => {
		const plan = formatPullPlan(
			[
				makeAssessment({
					outcome: "skip",
					skipReason: "not pushed yet",
					commits: [{ shortHash: "ccc3333", subject: "feat: something" }],
					totalCommits: 1,
				}),
			],
			makeRemotesMap(["repo-a", {}]),
			true,
		);
		expect(plan).not.toContain("Incoming from");
	});
});
