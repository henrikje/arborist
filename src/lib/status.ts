import { basename } from "node:path";
import { configGet } from "./config";
import { branchExistsLocally, detectOperation, getDefaultBranch, git, parseGitStatus, remoteBranchExists } from "./git";
import { type RepoRemotes, getRemoteNames, resolveRemotes } from "./remotes";
import { workspaceRepoDirs } from "./repos";
import { workspaceBranch } from "./workspace-branch";

export interface RepoStatus {
	name: string;
	head: string;
	branch: { expected: string; actual: string; drifted: boolean; detached: boolean };
	base: { name: string; ahead: number; behind: number } | null;
	remote: {
		pushed: boolean;
		ahead: number;
		behind: number;
		local: boolean;
		gone: boolean;
		trackingBranch: string | null;
	};
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

export function isDirty(repo: RepoStatus): boolean {
	return repo.local.staged > 0 || repo.local.modified > 0 || repo.local.untracked > 0 || repo.local.conflicts > 0;
}

export function isUnpushed(repo: RepoStatus): boolean {
	if (repo.remote.gone) return false;
	return repo.remote.ahead > 0 || (!repo.remote.pushed && repo.base !== null && repo.base.ahead > 0);
}

export function getVerdict(repo: RepoStatus): Verdict {
	if (repo.remote.local) return "local";
	if (repo.branch.drifted || repo.branch.detached || repo.operation !== null || (isDirty(repo) && isUnpushed(repo)))
		return "at-risk";
	if (isDirty(repo)) return "dirty";
	if (isUnpushed(repo)) return "unpushed";
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
	knownHasRemote?: boolean,
): Promise<RepoStatus> {
	const repo = basename(repoDir);
	const repoPath = `${reposDir}/${repo}`;

	// HEAD SHA (short)
	const headResult = await git(repoDir, "rev-parse", "--short", "HEAD");
	const head = headResult.exitCode === 0 ? headResult.stdout.trim() : "";

	// Current branch (empty string when detached)
	const branchResult = await git(repoDir, "branch", "--show-current");
	const actual = branchResult.exitCode === 0 ? branchResult.stdout.trim() : "";
	const detached = actual === "";
	const drifted = detached || actual !== expectedBranch;

	// Remote detection — use pre-resolved value if available
	const repoHasRemote = knownHasRemote ?? (await getRemoteNames(repoPath)).length > 0;

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
		remoteStatus = { pushed: false, ahead: 0, behind: 0, local: true, gone: false, trackingBranch: null };
	} else if (detached) {
		remoteStatus = { pushed: false, ahead: 0, behind: 0, local: false, gone: false, trackingBranch: null };
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
		remoteStatus = { pushed: true, ahead: pushAhead, behind: pushBehind, local: false, gone: false, trackingBranch };
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
		remoteStatus = {
			pushed: true,
			ahead: pushAhead,
			behind: pushBehind,
			local: false,
			gone: false,
			trackingBranch: null,
		};
	} else {
		const configRemote = await git(repoDir, "config", `branch.${actual}.remote`);
		const gone = configRemote.exitCode === 0 && configRemote.stdout.trim().length > 0;
		remoteStatus = gone
			? { pushed: true, ahead: 0, behind: 0, local: false, gone: true, trackingBranch: null }
			: { pushed: false, ahead: 0, behind: 0, local: false, gone: false, trackingBranch: null };
	}

	// Working tree status
	const local = await parseGitStatus(repoDir);

	// Detect in-progress operations via git dir sentinel files
	const operation = await detectOperation(repoDir);

	return {
		name: repo,
		head,
		branch: { expected: expectedBranch, actual, drifted, detached },
		base: baseStatus,
		remote: remoteStatus,
		remotes: effectiveRemotes,
		local,
		operation,
	};
}

export async function gatherWorkspaceSummary(
	wsDir: string,
	reposDir: string,
	onProgress?: (scanned: number, total: number) => void,
): Promise<WorkspaceSummary> {
	const workspace = basename(wsDir);
	const wb = await workspaceBranch(wsDir);
	const branch = wb?.branch ?? workspace.toLowerCase();
	const configBase = configGet(`${wsDir}/.arbws/config`, "base");
	const repoDirs = workspaceRepoDirs(wsDir);
	const total = repoDirs.length;
	let scanned = 0;

	const repos = await Promise.all(
		repoDirs.map(async (repoDir) => {
			const repo = basename(repoDir);
			const canonicalPath = `${reposDir}/${repo}`;

			const remoteNames = await getRemoteNames(canonicalPath);
			const repoHasRemote = remoteNames.length > 0;

			let remotes: RepoRemotes | undefined;
			if (repoHasRemote) {
				try {
					remotes = await resolveRemotes(canonicalPath, remoteNames);
				} catch {
					// Ambiguous remotes — use defaults
				}
			}

			const status = await gatherRepoStatus(repoDir, reposDir, branch, configBase, remotes, repoHasRemote);
			scanned++;
			onProgress?.(scanned, total);
			return status;
		}),
	);

	let pushed = 0;
	let dirty = 0;
	let behind = 0;
	let drifted = 0;

	for (const repo of repos) {
		if (repo.remote.local || !isUnpushed(repo)) pushed++;
		if (isDirty(repo)) dirty++;
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
