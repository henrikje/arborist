import type { GitOperation } from "./git";

// ── Public JSON schema types ──
// These types define the stable JSON contract for machine-readable output.
// Internal types may carry extra fields; these types ensure we only expose
// what we intend to.

export interface StatusJsonRepo {
	name: string;
	identity: {
		worktreeKind: "full" | "linked";
		headMode: { kind: "attached"; branch: string } | { kind: "detached" };
		shallow: boolean;
	};
	local: { staged: number; modified: number; untracked: number; conflicts: number };
	base: {
		remote: string;
		ref: string;
		configuredRef: string | null;
		ahead: number;
		behind: number;
		mergedIntoBase: "merge" | "squash" | null;
		baseMergedIntoDefault: "merge" | "squash" | null;
	} | null;
	share: {
		remote: string;
		ref: string | null;
		refMode: "noRef" | "implicit" | "configured" | "gone";
		toPush: number | null;
		toPull: number | null;
		rebased: number | null;
	} | null;
	operation: GitOperation;
	lastCommit: string | null;
	verbose?: {
		aheadOfBase?: { hash: string; subject: string }[];
		behindBase?: { hash: string; subject: string }[];
		unpushed?: { hash: string; subject: string; rebased: boolean }[];
		staged?: { file: string; type: "new file" | "modified" | "deleted" | "renamed" | "copied" }[];
		unstaged?: { file: string; type: "modified" | "deleted" }[];
		untracked?: string[];
	};
}

export interface StatusJsonOutput {
	workspace: string;
	branch: string;
	base: string | null;
	repos: StatusJsonRepo[];
	total: number;
	atRiskCount: number;
	statusLabels: string[];
	lastCommit: string | null;
}

// ── Log JSON types ──

export type LogJsonRepoStatus = "ok" | "detached" | "drifted" | "no-base" | "fallback-base";

export interface LogJsonCommit {
	hash: string;
	shortHash: string;
	subject: string;
}

export interface LogJsonRepo {
	name: string;
	status: LogJsonRepoStatus;
	reason?: string;
	commits: LogJsonCommit[];
}

export interface LogJsonOutput {
	workspace: string;
	branch: string;
	base: string | null;
	repos: LogJsonRepo[];
	totalCommits: number;
}

// ── Diff JSON types ──

export type DiffJsonRepoStatus = "ok" | "detached" | "drifted" | "no-base" | "fallback-base" | "clean";

export interface DiffJsonFileStat {
	file: string;
	insertions: number;
	deletions: number;
}

export interface DiffJsonRepo {
	name: string;
	status: DiffJsonRepoStatus;
	reason?: string;
	stat: { files: number; insertions: number; deletions: number };
	fileStat?: DiffJsonFileStat[];
}

export interface DiffJsonOutput {
	workspace: string;
	branch: string;
	base: string | null;
	repos: DiffJsonRepo[];
	totalFiles: number;
	totalInsertions: number;
	totalDeletions: number;
}

// ── List JSON types ──

export interface ListJsonEntry {
	workspace: string;
	active: boolean;
	branch: string | null;
	base: string | null;
	repoCount: number | null;
	status: "config-missing" | "empty" | null;
	atRiskCount?: number;
	statusLabels?: string[];
	statusCounts?: { label: string; count: number }[];
	lastCommit?: string | null;
}
