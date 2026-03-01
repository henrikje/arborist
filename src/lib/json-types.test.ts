import { describe, expect, test } from "bun:test";
import {
	BranchJsonOutputSchema,
	DiffJsonOutputSchema,
	DiffJsonRepoSchema,
	ListJsonEntrySchema,
	LogJsonOutputSchema,
	LogJsonRepoSchema,
	RepoListJsonEntrySchema,
	StatusJsonOutputSchema,
	StatusJsonRepoSchema,
} from "./json-types";
import type { RepoStatus, WorkspaceSummary } from "./status";

// These tests verify structural compatibility at compile time (via type
// annotations) and runtime conformance (via zod .parse()).

describe("json-types structural compatibility", () => {
	test("RepoStatus is assignable to StatusJsonRepo", () => {
		const repo: RepoStatus = {} as RepoStatus;
		const _json: Parameters<typeof StatusJsonRepoSchema.parse>[0] = repo;
		expect(true).toBe(true);
	});

	test("WorkspaceSummary is assignable to StatusJsonOutput", () => {
		const summary: WorkspaceSummary = {} as WorkspaceSummary;
		const _json: Parameters<typeof StatusJsonOutputSchema.parse>[0] = summary;
		expect(true).toBe(true);
	});
});

describe("json-types zod validation", () => {
	test("StatusJsonRepoSchema parses a representative repo", () => {
		const repo = {
			name: "api",
			identity: {
				worktreeKind: "linked" as const,
				headMode: { kind: "attached" as const, branch: "feat-x" },
				shallow: false,
			},
			local: { staged: 1, modified: 2, untracked: 0, conflicts: 0 },
			base: {
				remote: "upstream",
				ref: "upstream/main",
				configuredRef: null,
				ahead: 3,
				behind: 1,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
			},
			share: {
				remote: "origin",
				ref: "origin/feat-x",
				refMode: "implicit" as const,
				toPush: 2,
				toPull: 0,
				rebased: null,
			},
			operation: null,
			lastCommit: "2025-01-15T10:30:00Z",
		};
		expect(() => StatusJsonRepoSchema.parse(repo)).not.toThrow();
	});

	test("StatusJsonRepoSchema parses detached repo with null base", () => {
		const repo = {
			name: "web",
			identity: {
				worktreeKind: "linked" as const,
				headMode: { kind: "detached" as const },
				shallow: false,
			},
			local: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
			base: null,
			share: {
				remote: "origin",
				ref: null,
				refMode: "noRef" as const,
				toPush: null,
				toPull: null,
				rebased: null,
			},
			operation: null,
			lastCommit: null,
		};
		expect(() => StatusJsonRepoSchema.parse(repo)).not.toThrow();
	});

	test("StatusJsonOutputSchema parses a representative output", () => {
		const output = {
			workspace: "my-feature",
			branch: "feat-x",
			base: "main",
			repos: [],
			total: 0,
			atRiskCount: 0,
			rebasedOnlyCount: 0,
			statusLabels: [],
			statusCounts: [],
			lastCommit: null,
		};
		expect(() => StatusJsonOutputSchema.parse(output)).not.toThrow();
	});

	test("LogJsonRepoSchema parses repo with commits", () => {
		const repo = {
			name: "api",
			status: "ok" as const,
			commits: [{ hash: "abc123def", shortHash: "abc123d", subject: "Add feature" }],
		};
		expect(() => LogJsonRepoSchema.parse(repo)).not.toThrow();
	});

	test("LogJsonOutputSchema parses a representative output", () => {
		const output = {
			workspace: "my-feature",
			branch: "feat-x",
			base: "main",
			repos: [],
			totalCommits: 0,
		};
		expect(() => LogJsonOutputSchema.parse(output)).not.toThrow();
	});

	test("DiffJsonRepoSchema parses repo with stat", () => {
		const repo = {
			name: "api",
			status: "ok" as const,
			stat: { files: 3, insertions: 42, deletions: 7 },
			fileStat: [{ file: "src/index.ts", insertions: 30, deletions: 5 }],
		};
		expect(() => DiffJsonRepoSchema.parse(repo)).not.toThrow();
	});

	test("DiffJsonOutputSchema parses a representative output", () => {
		const output = {
			workspace: "my-feature",
			branch: "feat-x",
			base: "main",
			repos: [],
			totalFiles: 0,
			totalInsertions: 0,
			totalDeletions: 0,
		};
		expect(() => DiffJsonOutputSchema.parse(output)).not.toThrow();
	});

	test("RepoListJsonEntrySchema parses an entry", () => {
		const entry = {
			name: "api",
			url: "git@github.com:org/api.git",
			share: { name: "origin", url: "git@github.com:org/api.git" },
			base: { name: "origin", url: "git@github.com:org/api.git" },
		};
		expect(() => RepoListJsonEntrySchema.parse(entry)).not.toThrow();
	});

	test("ListJsonEntrySchema parses a basic entry", () => {
		const entry = {
			workspace: "test",
			active: true,
			branch: "main",
			base: null,
			repoCount: 2,
			status: null,
		};
		expect(() => ListJsonEntrySchema.parse(entry)).not.toThrow();
	});

	test("ListJsonEntrySchema parses an entry with status details", () => {
		const entry = {
			workspace: "feat",
			active: false,
			branch: "feat-x",
			base: "main",
			repoCount: 3,
			status: null,
			atRiskCount: 1,
			statusLabels: ["1 unpushed"],
			statusCounts: [{ label: "unpushed", count: 1 }],
			lastCommit: "2025-01-15T10:30:00Z",
		};
		expect(() => ListJsonEntrySchema.parse(entry)).not.toThrow();
	});

	test("BranchJsonOutputSchema parses a representative output", () => {
		const output = {
			branch: "feat-x",
			base: "main",
			repos: [
				{ name: "api", branch: "feat-x" },
				{ name: "web", branch: null },
			],
		};
		expect(() => BranchJsonOutputSchema.parse(output)).not.toThrow();
	});
});
