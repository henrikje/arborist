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
		ahead: number;
		behind: number;
	} | null;
	publish: {
		remote: string;
		ref: string | null;
		refMode: "noRef" | "implicit" | "configured" | "gone";
		toPush: number | null;
		toPull: number | null;
	} | null;
	operation: GitOperation;
	lastCommit: string | null;
}

export interface StatusJsonOutput {
	workspace: string;
	branch: string;
	base: string | null;
	repos: StatusJsonRepo[];
	total: number;
	withIssues: number;
	issueLabels: string[];
	lastCommit: string | null;
}

export interface ListJsonEntry {
	workspace: string;
	active: boolean;
	branch: string | null;
	base: string | null;
	repoCount: number | null;
	status: "config-missing" | "empty" | null;
	withIssues?: number;
	issueLabels?: string[];
	issueCounts?: { label: string; count: number }[];
	lastCommit?: string | null;
}
