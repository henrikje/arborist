import { existsSync } from "node:fs";
import { basename } from "node:path";
import { configGet } from "./config";
import { branchExistsLocally, getDefaultBranch, git, hasRemote, parseGitStatus, remoteBranchExists } from "./git";
import { type RepoRemotes, resolveRemotes } from "./remotes";
import { workspaceRepoDirs } from "./repos";
import { workspaceBranch } from "./workspace-branch";

export interface RepoStatus {
	name: string;
	branch: { expected: string; actual: string; drifted: boolean; detached: boolean };
	base: { name: string; ahead: number; behind: number } | null;
	remote: { pushed: boolean; ahead: number; behind: number; local: boolean; trackingBranch: string | null };
	remotes: RepoRemotes;
	local: { staged: number; modified: number; untracked: number; conflicts: number };
	operation: "rebase" | "merge" | "cherry-pick" | null;
}

export interface WorkspaceSummary {
	workspace: string;
	branch: string;
	base: string | null;
	repos: RepoStatus[];
	total: number;
	pushed: number;
	dirty: number;
	behind: number;
	drifted: number;
}

export type Verdict = "ok" | "dirty" | "unpushed" | "at-risk" | "local";

export function getVerdict(repo: RepoStatus): Verdict {
	if (repo.remote.local) return "local";

	const isDirty =
		repo.local.staged > 0 || repo.local.modified > 0 || repo.local.untracked > 0 || repo.local.conflicts > 0;
	const isUnpushed = !repo.remote.pushed || repo.remote.ahead > 0;

	if (repo.branch.drifted || repo.branch.detached || repo.operation !== null || (isDirty && isUnpushed))
		return "at-risk";
	if (isDirty) return "dirty";
	if (isUnpushed) return "unpushed";
	return "ok";
}

export function isClean(repo: RepoStatus): boolean {
	return getVerdict(repo) === "ok";
}

export async function gatherRepoStatus(
	repoDir: string,
	reposDir: string,
	expectedBranch: string,
	configBase: string | null,
	remotes?: RepoRemotes,
): Promise<RepoStatus> {
	const repo = basename(repoDir);
	const repoPath = `${reposDir}/${repo}`;

	// Current branch (empty string when detached)
	const branchResult = await git(repoDir, "branch", "--show-current");
	const actual = branchResult.exitCode === 0 ? branchResult.stdout.trim() : "";
	const detached = actual === "";
	const drifted = detached || actual !== expectedBranch;

	// Remote detection
	const repoHasRemote = await hasRemote(repoPath);

	// Resolve remote names (upstream for base, publish for tracking)
	const upstreamRemote = remotes?.upstream ?? "origin";
	const publishRemote = remotes?.publish ?? "origin";
	const effectiveRemotes: RepoRemotes = remotes ?? { upstream: "origin", publish: "origin" };

	// Base branch resolution
	let defaultBranch: string | null = null;
	if (configBase) {
		const baseExists = repoHasRemote
			? await remoteBranchExists(repoPath, configBase, upstreamRemote)
			: await branchExistsLocally(repoPath, configBase);
		if (baseExists) {
			defaultBranch = configBase;
		}
	}
	if (!defaultBranch) {
		defaultBranch = await getDefaultBranch(repoPath, upstreamRemote);
	}

	// Ahead/behind base branch
	let baseStatus: RepoStatus["base"] = null;
	if (defaultBranch && !detached) {
		const compareRef = repoHasRemote ? `${upstreamRemote}/${defaultBranch}` : defaultBranch;
		const lr = await git(repoDir, "rev-list", "--left-right", "--count", `${compareRef}...HEAD`);
		if (lr.exitCode === 0) {
			const parts = lr.stdout.trim().split(/\s+/);
			const behind = Number.parseInt(parts[0] ?? "0", 10);
			const ahead = Number.parseInt(parts[1] ?? "0", 10);
			baseStatus = { name: defaultBranch, ahead, behind };
		}
	}

	// Actual upstream tracking branch
	let trackingBranch: string | null = null;
	if (repoHasRemote && !detached) {
		const upstreamResult = await git(repoDir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
		if (upstreamResult.exitCode === 0) {
			trackingBranch = upstreamResult.stdout.trim();
		}
	}

	// Remote push status
	let remoteStatus: RepoStatus["remote"];
	if (!repoHasRemote) {
		remoteStatus = { pushed: false, ahead: 0, behind: 0, local: true, trackingBranch: null };
	} else if (detached) {
		remoteStatus = { pushed: false, ahead: 0, behind: 0, local: false, trackingBranch: null };
	} else if (trackingBranch) {
		// Use actual tracking branch for comparison
		const pushLr = await git(repoDir, "rev-list", "--left-right", "--count", `${trackingBranch}...HEAD`);
		let pushAhead = 0;
		let pushBehind = 0;
		if (pushLr.exitCode === 0) {
			const parts = pushLr.stdout.trim().split(/\s+/);
			pushBehind = Number.parseInt(parts[0] ?? "0", 10);
			pushAhead = Number.parseInt(parts[1] ?? "0", 10);
		}
		remoteStatus = { pushed: true, ahead: pushAhead, behind: pushBehind, local: false, trackingBranch };
	} else if (await remoteBranchExists(repoDir, actual, publishRemote)) {
		// No tracking branch set but remote branch exists — compare against it
		const pushLr = await git(repoDir, "rev-list", "--left-right", "--count", `${publishRemote}/${actual}...HEAD`);
		let pushAhead = 0;
		let pushBehind = 0;
		if (pushLr.exitCode === 0) {
			const parts = pushLr.stdout.trim().split(/\s+/);
			pushBehind = Number.parseInt(parts[0] ?? "0", 10);
			pushAhead = Number.parseInt(parts[1] ?? "0", 10);
		}
		remoteStatus = { pushed: true, ahead: pushAhead, behind: pushBehind, local: false, trackingBranch: null };
	} else {
		remoteStatus = { pushed: false, ahead: 0, behind: 0, local: false, trackingBranch: null };
	}

	// Working tree status
	const local = await parseGitStatus(repoDir);

	// Detect in-progress operations via git dir sentinel files
	const gitDirResult = await git(repoDir, "rev-parse", "--git-dir");
	let operation: RepoStatus["operation"] = null;
	if (gitDirResult.exitCode === 0) {
		const gitDir = gitDirResult.stdout.trim();
		const absGitDir = gitDir.startsWith("/") ? gitDir : `${repoDir}/${gitDir}`;
		if (existsSync(`${absGitDir}/rebase-merge`) || existsSync(`${absGitDir}/rebase-apply`)) {
			operation = "rebase";
		} else if (existsSync(`${absGitDir}/MERGE_HEAD`)) {
			operation = "merge";
		} else if (existsSync(`${absGitDir}/CHERRY_PICK_HEAD`)) {
			operation = "cherry-pick";
		}
	}

	return {
		name: repo,
		branch: { expected: expectedBranch, actual, drifted, detached },
		base: baseStatus,
		remote: remoteStatus,
		remotes: effectiveRemotes,
		local,
		operation,
	};
}

export async function gatherWorkspaceSummary(wsDir: string, reposDir: string): Promise<WorkspaceSummary> {
	const workspace = basename(wsDir);
	const wb = await workspaceBranch(wsDir);
	const branch = wb?.branch ?? workspace.toLowerCase();
	const configBase = configGet(`${wsDir}/.arbws/config`, "base");
	const repoDirs = workspaceRepoDirs(wsDir);

	const repos: RepoStatus[] = [];
	for (const repoDir of repoDirs) {
		const repo = basename(repoDir);
		let remotes: RepoRemotes | undefined;
		try {
			remotes = await resolveRemotes(`${reposDir}/${repo}`);
		} catch {
			// Local repo or ambiguous remotes — use defaults
		}
		repos.push(await gatherRepoStatus(repoDir, reposDir, branch, configBase, remotes));
	}

	let pushed = 0;
	let dirty = 0;
	let behind = 0;
	let drifted = 0;

	for (const repo of repos) {
		if (repo.remote.local || (repo.remote.pushed && repo.remote.ahead === 0)) pushed++;
		if (repo.local.staged > 0 || repo.local.modified > 0 || repo.local.untracked > 0 || repo.local.conflicts > 0)
			dirty++;
		if (repo.base && repo.base.behind > 0) behind++;
		if (repo.remote.behind > 0) behind++;
		if (repo.branch.drifted) drifted++;
	}

	return {
		workspace,
		branch,
		base: configBase,
		repos,
		total: repos.length,
		pushed,
		dirty,
		behind,
		drifted,
	};
}
