import { describe, expect, test } from "bun:test";
import type { RepoRemotes } from "../lib/remotes";
import { makeRepo } from "../lib/test-helpers";
import { type PushAssessment, assessPushRepo, formatPushPlan } from "./push";

const DIR = "/tmp/test-repo";
const SHA = "abc1234";

describe("assessPushRepo", () => {
	test("up-to-date when nothing to push or pull", () => {
		const a = assessPushRepo(makeRepo(), DIR, "feature", SHA);
		expect(a.outcome).toBe("up-to-date");
	});

	test("skips detached HEAD", () => {
		const a = assessPushRepo(
			makeRepo({ identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false } }),
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("HEAD is detached");
		expect(a.skipFlag).toBe("detached-head");
	});

	test("skips drifted branch", () => {
		const a = assessPushRepo(
			makeRepo({
				identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
			}),
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("on branch other, expected feature");
		expect(a.skipFlag).toBe("drifted");
	});

	test("skips when base branch merged into default", () => {
		const a = assessPushRepo(
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
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("base branch feat/auth was merged into default");
		expect(a.skipReason).toContain("retarget");
		expect(a.skipFlag).toBe("base-merged-into-default");
	});

	test("skips gone+merged without force", () => {
		const a = assessPushRepo(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
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
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("already merged into main");
		expect(a.skipReason).toContain("--force to recreate");
		expect(a.skipFlag).toBe("already-merged");
	});

	test("will-push gone+merged with force (recreate)", () => {
		const a = assessPushRepo(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
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
			DIR,
			"feature",
			SHA,
			{ force: true },
		);
		expect(a.outcome).toBe("will-push");
		expect(a.recreate).toBe(true);
		expect(a.ahead).toBe(2);
	});

	test("will-push gone+not-merged (recreate)", () => {
		const a = assessPushRepo(
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
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("will-push");
		expect(a.recreate).toBe(true);
		expect(a.ahead).toBe(3);
	});

	test("skips merged-not-gone without force", () => {
		const a = assessPushRepo(
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
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("already merged into main");
		expect(a.skipReason).toContain("--force");
		expect(a.skipFlag).toBe("already-merged");
	});

	test("uses merged-new-work skip flag when gone+merged with new commits", () => {
		const a = assessPushRepo(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 3,
					behind: 0,
					mergedIntoBase: "squash",
					newCommitsAfterMerge: 1,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("merged into main with 1 new commit");
		expect(a.skipReason).toContain("rebase or --force");
		expect(a.skipFlag).toBe("merged-new-work");
	});

	test("uses merged-new-work skip flag when merged-not-gone with new commits", () => {
		const a = assessPushRepo(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: null,
					ahead: 3,
					behind: 0,
					mergedIntoBase: "squash",
					newCommitsAfterMerge: 2,
					baseMergedIntoDefault: null,
					detectedPr: null,
				},
			}),
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("merged into main with 2 new commits");
		expect(a.skipReason).toContain("rebase or --force");
		expect(a.skipFlag).toBe("merged-new-work");
	});

	test("uses already-merged skip flag for standard merged branch (no new commits)", () => {
		const a = assessPushRepo(
			makeRepo({
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
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
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipFlag).toBe("already-merged");
		expect(a.skipReason).toContain("already merged");
	});

	test("will-push noRef with commits (new branch)", () => {
		const a = assessPushRepo(
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
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("will-push");
		expect(a.newBranch).toBe(true);
		expect(a.ahead).toBe(3);
	});

	test("skips noRef with no commits", () => {
		const a = assessPushRepo(
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
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toBe("no commits to push");
		expect(a.skipFlag).toBe("no-commits");
	});

	test("skips when only behind share", () => {
		const a = assessPushRepo(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 3, rebased: null },
			}),
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("behind origin");
		expect(a.skipReason).toContain("pull first");
		expect(a.skipFlag).toBe("behind-remote");
	});

	test("will-force-push when diverged", () => {
		const a = assessPushRepo(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 3, toPull: 2, rebased: 1 },
			}),
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("will-force-push");
		expect(a.ahead).toBe(3);
		expect(a.behind).toBe(2);
		expect(a.rebased).toBe(1);
	});

	test("will-push normal push", () => {
		const a = assessPushRepo(
			makeRepo({
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("will-push");
		expect(a.ahead).toBe(2);
	});

	test("behindBase passes through from status", () => {
		const a = assessPushRepo(
			makeRepo({
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
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("will-push");
		expect(a.behindBase).toBe(5);
	});

	test("headSha passes through", () => {
		const a = assessPushRepo(makeRepo(), DIR, "feature", "deadbeef");
		expect(a.headSha).toBe("deadbeef");
	});

	test("gone falls back to ahead=1 when base is null", () => {
		const a = assessPushRepo(
			makeRepo({
				base: null,
				share: { remote: "origin", ref: null, refMode: "gone", toPush: null, toPull: null, rebased: null },
			}),
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("will-push");
		expect(a.ahead).toBe(1);
		expect(a.recreate).toBe(true);
	});

	test("merged-not-gone with force falls through to push logic", () => {
		const a = assessPushRepo(
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
				share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 2, toPull: 0, rebased: null },
			}),
			DIR,
			"feature",
			SHA,
			{ force: true },
		);
		expect(a.outcome).toBe("will-push");
		expect(a.ahead).toBe(2);
	});

	test("baseMergedIntoDefault shows configuredRef when set", () => {
		const a = assessPushRepo(
			makeRepo({
				base: {
					remote: "origin",
					ref: "main",
					configuredRef: "feat/old",
					ahead: 0,
					behind: 3,
					mergedIntoBase: null,
					baseMergedIntoDefault: "merge",
					detectedPr: null,
				},
			}),
			DIR,
			"feature",
			SHA,
		);
		expect(a.outcome).toBe("skip");
		expect(a.skipReason).toContain("base branch feat/old was merged into default");
	});
});

describe("formatPushPlan", () => {
	function makeAssessment(overrides: Partial<PushAssessment> = {}): PushAssessment {
		return {
			repo: "repo-a",
			repoDir: "/tmp/repo-a",
			outcome: "will-push",
			ahead: 2,
			behind: 0,
			rebased: 0,
			branch: "feature",
			shareRemote: "origin",
			newBranch: false,
			headSha: "abc1234",
			recreate: false,
			behindBase: 0,
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

	test("shows commit count for will-push", () => {
		const plan = formatPushPlan([makeAssessment({ ahead: 3 })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("3 commits to push");
	});

	test("shows new branch annotation", () => {
		const plan = formatPushPlan([makeAssessment({ newBranch: true })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("(new branch)");
	});

	test("shows recreate annotation", () => {
		const plan = formatPushPlan([makeAssessment({ recreate: true })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("(recreate)");
	});

	test("shows force with rebased count", () => {
		const plan = formatPushPlan(
			[makeAssessment({ outcome: "will-force-push", ahead: 3, rebased: 2 })],
			makeRemotesMap(["repo-a", {}]),
		);
		expect(plan).toContain("1 new + 2 rebased");
		expect(plan).toContain("(force)");
	});

	test("shows force with all rebased (no new commits)", () => {
		const plan = formatPushPlan(
			[makeAssessment({ outcome: "will-force-push", ahead: 2, rebased: 2 })],
			makeRemotesMap(["repo-a", {}]),
		);
		expect(plan).toContain("2 rebased");
		expect(plan).not.toContain("new");
	});

	test("shows force with behind count when not rebased", () => {
		const plan = formatPushPlan(
			[makeAssessment({ outcome: "will-force-push", ahead: 3, behind: 2, rebased: 0 })],
			makeRemotesMap(["repo-a", {}]),
		);
		expect(plan).toContain("(force");
		expect(plan).toContain("2 behind origin");
	});

	test("shows up-to-date", () => {
		const plan = formatPushPlan([makeAssessment({ outcome: "up-to-date" })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("up to date");
	});

	test("shows skipped with reason", () => {
		const plan = formatPushPlan(
			[makeAssessment({ outcome: "skip", skipReason: "HEAD is detached" })],
			makeRemotesMap(["repo-a", {}]),
		);
		expect(plan).toContain("skipped");
		expect(plan).toContain("HEAD is detached");
	});

	test("shows behind-base annotation and hint", () => {
		const plan = formatPushPlan([makeAssessment({ behindBase: 3 })], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("3 behind base");
		expect(plan).toContain("consider 'arb rebase'");
	});

	test("no behind-base hint when behindBase is 0", () => {
		const plan = formatPushPlan([makeAssessment({ behindBase: 0 })], makeRemotesMap(["repo-a", {}]));
		expect(plan).not.toContain("behind base");
		expect(plan).not.toContain("consider");
	});

	test("shows fork suffix when base differs from share", () => {
		const plan = formatPushPlan(
			[makeAssessment({ shareRemote: "origin" })],
			makeRemotesMap(["repo-a", { base: "upstream", share: "origin" }]),
		);
		expect(plan).toContain("→ origin");
	});

	test("no fork suffix when base equals share", () => {
		const plan = formatPushPlan([makeAssessment()], makeRemotesMap(["repo-a", { base: "origin", share: "origin" }]));
		expect(plan).not.toContain("→");
	});

	test("shows verbose commits when verbose is true", () => {
		const plan = formatPushPlan(
			[
				makeAssessment({
					commits: [
						{ shortHash: "aaa1111", subject: "feat: new feature" },
						{ shortHash: "bbb2222", subject: "fix: a bug" },
					],
					totalCommits: 2,
				}),
			],
			makeRemotesMap(["repo-a", {}]),
			true,
		);
		expect(plan).toContain("Outgoing to origin:");
		expect(plan).toContain("aaa1111");
		expect(plan).toContain("feat: new feature");
		expect(plan).toContain("bbb2222");
		expect(plan).toContain("fix: a bug");
	});

	test("does not show verbose commits when verbose is false", () => {
		const plan = formatPushPlan(
			[
				makeAssessment({
					commits: [{ shortHash: "aaa1111", subject: "feat: new feature" }],
					totalCommits: 1,
				}),
			],
			makeRemotesMap(["repo-a", {}]),
			false,
		);
		expect(plan).not.toContain("Outgoing to");
		expect(plan).not.toContain("aaa1111");
	});

	test("shows truncation hint for push verbose", () => {
		const plan = formatPushPlan(
			[
				makeAssessment({
					commits: [{ shortHash: "aaa1111", subject: "feat: something" }],
					totalCommits: 30,
				}),
			],
			makeRemotesMap(["repo-a", {}]),
			true,
		);
		expect(plan).toContain("... and 29 more");
	});

	test("shows verbose commits for will-force-push", () => {
		const plan = formatPushPlan(
			[
				makeAssessment({
					outcome: "will-force-push",
					ahead: 3,
					rebased: 2,
					commits: [{ shortHash: "aaa1111", subject: "feat: rebased work" }],
					totalCommits: 1,
				}),
			],
			makeRemotesMap(["repo-a", {}]),
			true,
		);
		expect(plan).toContain("Outgoing to origin:");
		expect(plan).toContain("aaa1111");
	});

	test("does not show verbose commits for up-to-date repos", () => {
		const plan = formatPushPlan(
			[
				makeAssessment({
					outcome: "up-to-date",
					commits: [{ shortHash: "aaa1111", subject: "feat: something" }],
					totalCommits: 1,
				}),
			],
			makeRemotesMap(["repo-a", {}]),
			true,
		);
		expect(plan).not.toContain("Outgoing to");
	});

	test("shows merged-new-work hint when repos have the flag", () => {
		const plan = formatPushPlan(
			[
				makeAssessment({
					outcome: "skip",
					skipReason: "merged into main with 1 new commit (rebase or --force)",
					skipFlag: "merged-new-work",
				}),
			],
			makeRemotesMap(["repo-a", {}]),
		);
		expect(plan).toContain("hint:");
		expect(plan).toContain("merged with new commits");
		expect(plan).toContain("arb rebase");
	});

	test("no merged-new-work hint when no repos have the flag", () => {
		const plan = formatPushPlan(
			[makeAssessment({ outcome: "skip", skipReason: "already merged", skipFlag: "already-merged" })],
			makeRemotesMap(["repo-a", {}]),
		);
		expect(plan).not.toContain("merged with new commits");
	});

	// ── Header & alignment tests ────────────────────────────────

	test("includes REPO and ACTION column headers", () => {
		const plan = formatPushPlan([makeAssessment()], makeRemotesMap(["repo-a", {}]));
		expect(plan).toContain("REPO");
		expect(plan).toContain("ACTION");
	});

	test("aligns actions across repos with different name lengths", () => {
		const plan = formatPushPlan(
			[
				makeAssessment({ repo: "short", ahead: 2 }),
				makeAssessment({ repo: "much-longer-repo-name", outcome: "up-to-date" }),
			],
			makeRemotesMap(["short", {}], ["much-longer-repo-name", {}]),
		);
		const lines = plan.split("\n").filter((l) => l.trim().length > 0);
		const dataLines = lines.slice(1);
		// Find where the action text starts (first match of the action content)
		const actionStarts = dataLines.map((l) => {
			const pushIdx = l.indexOf("2 commits");
			const upIdx = l.indexOf("up to date");
			return pushIdx !== -1 ? pushIdx : upIdx;
		});
		const nonNeg = actionStarts.filter((s) => s >= 0);
		expect(nonNeg.length).toBe(2);
		expect(nonNeg[0]).toBe(nonNeg[1]);
	});
});
