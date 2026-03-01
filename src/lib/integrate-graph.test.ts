import { describe, expect, test } from "bun:test";
import type { RepoAssessment } from "./integrate";
import { formatBranchGraph } from "./integrate-graph";

function makeAssessment(overrides: Partial<RepoAssessment> = {}): RepoAssessment {
	return {
		repo: "repo-a",
		repoDir: "/tmp/repo-a",
		outcome: "will-operate",
		behind: 3,
		ahead: 2,
		baseRemote: "origin",
		baseBranch: "main",
		headSha: "abc1234",
		shallow: false,
		mergeBaseSha: "ghi9012",
		...overrides,
	};
}

describe("formatBranchGraph", () => {
	test("renders diverged graph with ahead and behind", () => {
		const graph = formatBranchGraph(makeAssessment(), "feat/xyz", false);
		expect(graph).toContain("feat/xyz  HEAD");
		expect(graph).toContain("2 ahead");
		expect(graph).toContain("merge-base");
		expect(graph).toContain("ghi9012");
		expect(graph).toContain("origin/main");
		expect(graph).toContain("3 behind");
	});

	test("renders fast-forward graph when ahead is 0", () => {
		const graph = formatBranchGraph(makeAssessment({ ahead: 0 }), "feat/xyz", false);
		expect(graph).toContain("feat/xyz  HEAD");
		expect(graph).toContain("at merge-base");
		expect(graph).toContain("ghi9012");
		expect(graph).toContain("origin/main");
		expect(graph).toContain("3 behind");
		expect(graph).not.toContain("--o--");
	});

	test("renders verbose graph with outgoing commits", () => {
		const graph = formatBranchGraph(
			makeAssessment({
				outgoingCommits: [
					{ shortHash: "abc1234", subject: "feat: add widget" },
					{ shortHash: "def5678", subject: "feat: update API" },
				],
				totalOutgoingCommits: 2,
			}),
			"feat/xyz",
			true,
		);
		expect(graph).toContain("abc1234");
		expect(graph).toContain("feat: add widget");
		expect(graph).toContain("def5678");
		expect(graph).toContain("feat: update API");
	});

	test("renders verbose graph with incoming commits", () => {
		const graph = formatBranchGraph(
			makeAssessment({
				commits: [
					{ shortHash: "jkl3456", subject: "fix: alignment" },
					{ shortHash: "mno7890", subject: "refactor: auth" },
				],
				totalCommits: 2,
			}),
			"feat/xyz",
			true,
		);
		expect(graph).toContain("jkl3456");
		expect(graph).toContain("fix: alignment");
		expect(graph).toContain("mno7890");
		expect(graph).toContain("refactor: auth");
	});

	test("shows truncation hint for outgoing commits", () => {
		const graph = formatBranchGraph(
			makeAssessment({
				outgoingCommits: [{ shortHash: "abc1234", subject: "feat: something" }],
				totalOutgoingCommits: 10,
			}),
			"feat/xyz",
			true,
		);
		expect(graph).toContain("... and 9 more");
	});

	test("shows truncation hint for incoming commits", () => {
		const graph = formatBranchGraph(
			makeAssessment({
				commits: [{ shortHash: "jkl3456", subject: "fix: something" }],
				totalCommits: 30,
			}),
			"feat/xyz",
			true,
		);
		expect(graph).toContain("... and 29 more");
	});

	test("renders retarget graph with x at cut point", () => {
		const graph = formatBranchGraph(
			makeAssessment({
				retargetFrom: "feat/auth",
				retargetTo: "main",
				ahead: 2,
			}),
			"feat/xyz",
			false,
		);
		expect(graph).toContain("feat/xyz  HEAD");
		expect(graph).toContain("2 commits to rebase");
		expect(graph).toContain("--x--");
		expect(graph).toContain("feat/auth");
		expect(graph).toContain("old base, merged");
		expect(graph).toContain("origin/main");
		expect(graph).toContain("new base");
		expect(graph).not.toContain("--o--");
	});

	test("renders retarget graph with : connector", () => {
		const graph = formatBranchGraph(
			makeAssessment({
				retargetFrom: "feat/auth",
				retargetTo: "main",
			}),
			"feat/xyz",
			false,
		);
		// The : connector between old base and new base
		expect(graph).toContain(":");
	});

	test("retarget with verbose shows outgoing commits above cut point", () => {
		const graph = formatBranchGraph(
			makeAssessment({
				retargetFrom: "feat/auth",
				retargetTo: "main",
				ahead: 2,
				outgoingCommits: [
					{ shortHash: "abc1234", subject: "feat: add widget" },
					{ shortHash: "def5678", subject: "feat: update API" },
				],
				totalOutgoingCommits: 2,
			}),
			"feat/xyz",
			true,
		);
		expect(graph).toContain("abc1234");
		expect(graph).toContain("feat: add widget");
		expect(graph).toContain("--x--");
		expect(graph).toContain("feat/auth");
	});

	test("retarget shows merge-base sha at cut point", () => {
		const graph = formatBranchGraph(
			makeAssessment({
				retargetFrom: "feat/auth",
				retargetTo: "main",
				mergeBaseSha: "xyz7890",
			}),
			"feat/xyz",
			false,
		);
		expect(graph).toContain("xyz7890");
	});

	test("renders without merge-base sha when not available", () => {
		const graph = formatBranchGraph(makeAssessment({ mergeBaseSha: undefined }), "feat/xyz", false);
		expect(graph).toContain("--o-- merge-base");
		expect(graph).not.toContain("undefined");
	});

	test("fast-forward verbose shows incoming commits below HEAD", () => {
		const graph = formatBranchGraph(
			makeAssessment({
				ahead: 0,
				commits: [
					{ shortHash: "jkl3456", subject: "fix: alignment" },
					{ shortHash: "mno7890", subject: "refactor: auth" },
				],
				totalCommits: 2,
			}),
			"feat/xyz",
			true,
		);
		expect(graph).toContain("at merge-base");
		expect(graph).toContain("jkl3456");
		expect(graph).toContain("fix: alignment");
	});

	test("retarget at cut point shows at cut point label", () => {
		const graph = formatBranchGraph(
			makeAssessment({
				retargetFrom: "feat/auth",
				retargetTo: "main",
				ahead: 0,
			}),
			"feat/xyz",
			false,
		);
		expect(graph).toContain("at cut point");
	});
});
