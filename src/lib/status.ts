import { basename } from "node:path";
import { configGet } from "./config";
import {
	type GitOperation,
	branchExistsLocally,
	detectOperation,
	getDefaultBranch,
	git,
	isLinkedWorktree,
	isShallowRepo,
	parseGitStatus,
	remoteBranchExists,
} from "./git";
import { type RepoRemotes, getRemoteNames, resolveRemotes } from "./remotes";
import { workspaceRepoDirs } from "./repos";
import { workspaceBranch } from "./workspace-branch";

// ── 5-Section Model Types ──

export interface RepoStatus {
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
		toPush: number | null; // null = unknown
		toPull: number | null; // null = unknown
	} | null; // null when no remote
	operation: GitOperation;
}

export interface RepoFlags {
	isDirty: boolean;
	isUnpushed: boolean;
	needsPull: boolean;
	needsRebase: boolean;
	isDrifted: boolean;
	isDetached: boolean;
	hasOperation: boolean;
	isLocal: boolean;
	isGone: boolean;
	isShallow: boolean;
}

export function computeFlags(repo: RepoStatus, expectedBranch: string): RepoFlags {
	const localDirty =
		repo.local.staged > 0 || repo.local.modified > 0 || repo.local.untracked > 0 || repo.local.conflicts > 0;

	const isDetached = repo.identity.headMode.kind === "detached";

	const isLocal = repo.publish === null;

	const isGone = repo.publish !== null && repo.publish.refMode === "gone";

	// isUnpushed: has commits to push to publish remote, or never pushed with commits ahead of base
	// Note: "gone" branches are excluded — the remote deleted the branch (typically after PR merge),
	// so "unpushed" would be misleading. The "gone" flag alone signals the state.
	let isUnpushed = false;
	if (repo.publish !== null) {
		if (repo.publish.toPush !== null && repo.publish.toPush > 0) {
			isUnpushed = true;
		} else if (repo.publish.refMode === "noRef" && repo.base !== null && repo.base.ahead > 0) {
			isUnpushed = true;
		}
	}

	// needsPull: publish remote has commits to pull
	const needsPull = repo.publish !== null && repo.publish.toPull !== null && repo.publish.toPull > 0;

	// needsRebase: behind base branch
	const needsRebase = repo.base !== null && repo.base.behind > 0;

	// isDrifted: on the wrong branch (not detached, but branch doesn't match expected)
	let isDrifted = false;
	if (repo.identity.headMode.kind === "attached") {
		isDrifted = repo.identity.headMode.branch !== expectedBranch;
	}

	return {
		isDirty: localDirty,
		isUnpushed,
		needsPull,
		needsRebase,
		isDrifted,
		isDetached,
		hasOperation: repo.operation !== null,
		isLocal,
		isGone,
		isShallow: repo.identity.shallow,
	};
}

export function needsAttention(flags: RepoFlags): boolean {
	return (
		flags.isDetached ||
		flags.isDrifted ||
		flags.hasOperation ||
		flags.isDirty ||
		flags.isUnpushed ||
		flags.isGone ||
		flags.needsPull ||
		flags.needsRebase ||
		flags.isShallow
	);
}

const FLAG_LABELS: { key: keyof RepoFlags; label: string }[] = [
	{ key: "isDirty", label: "dirty" },
	{ key: "isUnpushed", label: "unpushed" },
	{ key: "needsPull", label: "behind remote" },
	{ key: "needsRebase", label: "behind base" },
	{ key: "isDrifted", label: "drifted" },
	{ key: "isDetached", label: "detached" },
	{ key: "hasOperation", label: "operation" },
	{ key: "isLocal", label: "local" },
	{ key: "isGone", label: "gone" },
	{ key: "isShallow", label: "shallow" },
];

export function flagLabels(flags: RepoFlags): string[] {
	return FLAG_LABELS.filter(({ key }) => flags[key]).map(({ label }) => label);
}

export function wouldLoseWork(flags: RepoFlags): boolean {
	return flags.isDirty || flags.isUnpushed || flags.isDetached || flags.isDrifted || flags.hasOperation;
}

// ── Workspace Summary ──

export interface WorkspaceSummary {
	workspace: string;
	branch: string;
	base: string | null;
	repos: RepoStatus[];
	total: number;
	withIssues: number;
	issueLabels: string[];
	issueCounts: { label: string; count: number; key: keyof RepoFlags }[];
}

// ── Status Gathering ──

export async function gatherRepoStatus(
	repoDir: string,
	reposDir: string,
	configBase: string | null,
	remotes?: RepoRemotes,
	knownHasRemote?: boolean,
): Promise<RepoStatus> {
	const repo = basename(repoDir);
	const repoPath = `${reposDir}/${repo}`;

	// ── Section 1: Identity ──

	// Worktree kind check
	const worktreeKind: "full" | "linked" = isLinkedWorktree(repoDir) ? "linked" : "full";

	// Parallel group: branch, porcelain status, shallow check, git-dir for operations
	const [branchResult, local, shallow, gitDirResult] = await Promise.all([
		git(repoDir, "branch", "--show-current"),
		parseGitStatus(repoDir),
		isShallowRepo(repoDir),
		detectOperation(repoDir),
	]);

	const actualBranch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : "";
	const detached = actualBranch === "";
	const headMode: RepoStatus["identity"]["headMode"] = detached
		? { kind: "detached" }
		: { kind: "attached", branch: actualBranch };

	// Remote detection — use pre-resolved value if available
	const repoHasRemote = knownHasRemote ?? (await getRemoteNames(repoPath)).length > 0;

	// Resolve remote names (upstream for base, publish for tracking)
	const upstreamRemote = remotes?.upstream ?? "origin";
	const publishRemote = remotes?.publish ?? "origin";

	// ── Section 2: Local (working tree status) ──
	// Gathered above in the parallel group (parseGitStatus → local).

	// ── Section 3: Base (integration status vs upstream default branch) ──

	let baseStatus: RepoStatus["base"] = null;
	if (!detached) {
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
		if (!defaultBranch && repoHasRemote) {
			defaultBranch = await getDefaultBranch(repoPath, upstreamRemote);
		}

		if (defaultBranch) {
			const compareRef = repoHasRemote ? `${upstreamRemote}/${defaultBranch}` : defaultBranch;
			const lr = await git(repoDir, "rev-list", "--left-right", "--count", `${compareRef}...HEAD`);
			if (lr.exitCode === 0) {
				const parts = lr.stdout.trim().split(/\s+/);
				const behind = Number.parseInt(parts[0] ?? "0", 10);
				const ahead = Number.parseInt(parts[1] ?? "0", 10);
				baseStatus = { remote: upstreamRemote, ref: defaultBranch, ahead, behind };
			}
		}
	}

	// ── Section 4: Publish (push/pull status vs publish remote) ──

	let publishStatus: RepoStatus["publish"] = null;
	if (repoHasRemote && !detached) {
		// Step 1: Try configured tracking branch
		const upstreamResult = await git(repoDir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
		if (upstreamResult.exitCode === 0) {
			const trackingRef = upstreamResult.stdout.trim();
			// refMode = configured
			const pushLr = await git(repoDir, "rev-list", "--left-right", "--count", `${trackingRef}...HEAD`);
			let toPush: number | null = null;
			let toPull: number | null = null;
			if (pushLr.exitCode === 0) {
				const parts = pushLr.stdout.trim().split(/\s+/);
				toPull = Number.parseInt(parts[0] ?? "0", 10);
				toPush = Number.parseInt(parts[1] ?? "0", 10);
			}
			publishStatus = {
				remote: publishRemote,
				ref: trackingRef,
				refMode: "configured",
				toPush,
				toPull,
			};
		} else if (await remoteBranchExists(repoDir, actualBranch, publishRemote)) {
			// Step 2: No tracking config but remote ref exists → implicit
			const pushLr = await git(
				repoDir,
				"rev-list",
				"--left-right",
				"--count",
				`${publishRemote}/${actualBranch}...HEAD`,
			);
			let toPush: number | null = null;
			let toPull: number | null = null;
			if (pushLr.exitCode === 0) {
				const parts = pushLr.stdout.trim().split(/\s+/);
				toPull = Number.parseInt(parts[0] ?? "0", 10);
				toPush = Number.parseInt(parts[1] ?? "0", 10);
			}
			publishStatus = {
				remote: publishRemote,
				ref: `${publishRemote}/${actualBranch}`,
				refMode: "implicit",
				toPush,
				toPull,
			};
		} else {
			// Step 3: Check if tracking config exists (→ gone) or not (→ noRef)
			const configRemote = await git(repoDir, "config", `branch.${actualBranch}.remote`);
			const isGone = configRemote.exitCode === 0 && configRemote.stdout.trim().length > 0;
			publishStatus = {
				remote: publishRemote,
				ref: null,
				refMode: isGone ? "gone" : "noRef",
				toPush: null,
				toPull: null,
			};
		}
	} else if (!repoHasRemote) {
		// No remote at all — publish is null (local repo)
		publishStatus = null;
	} else {
		// Detached — publish is present but no ref comparison possible
		publishStatus = {
			remote: publishRemote,
			ref: null,
			refMode: "noRef",
			toPush: null,
			toPull: null,
		};
	}

	return {
		name: repo,
		identity: { worktreeKind, headMode, shallow },
		local,
		base: baseStatus,
		publish: publishStatus,
		operation: gitDirResult,
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

			const status = await gatherRepoStatus(repoDir, reposDir, configBase, remotes, repoHasRemote);
			scanned++;
			onProgress?.(scanned, repoDirs.length);
			return status;
		}),
	);

	// Compute aggregate flags
	let withIssues = 0;
	const allLabels = new Set<string>();
	const flagCounts = new Map<keyof RepoFlags, number>();

	for (const repo of repos) {
		const flags = computeFlags(repo, branch);
		if (needsAttention(flags)) {
			withIssues++;
			for (const { key, label } of FLAG_LABELS) {
				if (flags[key]) {
					allLabels.add(label);
					flagCounts.set(key, (flagCounts.get(key) ?? 0) + 1);
				}
			}
		}
	}

	const issueCounts = FLAG_LABELS.filter(({ key }) => flagCounts.has(key)).map(({ key, label }) => ({
		label,
		count: flagCounts.get(key) ?? 0,
		key,
	}));

	return {
		workspace,
		branch,
		base: configBase,
		repos,
		total: repos.length,
		withIssues,
		issueLabels: [...allLabels],
		issueCounts,
	};
}
