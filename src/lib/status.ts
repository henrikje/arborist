import { basename } from "node:path";
import { configGet } from "./config";
import {
	type GitOperation,
	branchExistsLocally,
	detectBranchMerged,
	detectOperation,
	detectRebasedCommits,
	getDefaultBranch,
	getHeadCommitDate,
	git,
	isLinkedWorktree,
	isShallowRepo,
	parseGitStatus,
	remoteBranchExists,
} from "./git";
import { yellow } from "./output";
import { type RepoRemotes, getRemoteNames, resolveRemotes } from "./remotes";
import { workspaceRepoDirs } from "./repos";
import { latestCommitDate } from "./time";
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
		mergedIntoBase: "merge" | "squash" | null;
		baseMergedIntoDefault: "merge" | "squash" | null;
	} | null;
	share: {
		remote: string;
		ref: string | null;
		refMode: "noRef" | "implicit" | "configured" | "gone";
		toPush: number | null; // null = unknown
		toPull: number | null; // null = unknown
		rebased: number | null; // count of patch-id-matched commits between push/pull sets
	} | null; // null when no remote
	operation: GitOperation;
	lastCommit: string | null;
}

export interface RepoFlags {
	isDirty: boolean;
	isUnpushed: boolean;
	needsPull: boolean;
	needsRebase: boolean;
	isDiverged: boolean;
	isDrifted: boolean;
	isDetached: boolean;
	hasOperation: boolean;
	isLocal: boolean;
	isGone: boolean;
	isShallow: boolean;
	isMerged: boolean;
	isBaseMerged: boolean;
}

export function computeFlags(repo: RepoStatus, expectedBranch: string): RepoFlags {
	const localDirty =
		repo.local.staged > 0 || repo.local.modified > 0 || repo.local.untracked > 0 || repo.local.conflicts > 0;

	const isDetached = repo.identity.headMode.kind === "detached";

	const isLocal = repo.share === null;

	const isGone = repo.share !== null && repo.share.refMode === "gone";

	// isUnpushed: has commits to push to share remote, or never pushed with commits ahead of base
	// Note: "gone" branches are excluded — the remote deleted the branch (typically after PR merge),
	// so "unpushed" would be misleading. The "gone" flag alone signals the state.
	let isUnpushed = false;
	if (repo.share !== null) {
		if (repo.share.toPush !== null && repo.share.toPush > 0) {
			isUnpushed = true;
		} else if (repo.share.refMode === "noRef" && repo.base !== null && repo.base.ahead > 0) {
			isUnpushed = true;
		}
	}

	// needsPull: share remote has commits to pull
	const needsPull = repo.share !== null && repo.share.toPull !== null && repo.share.toPull > 0;

	// needsRebase: behind base branch
	const needsRebase = repo.base !== null && repo.base.behind > 0;

	// isDiverged: both ahead of and behind base branch (non-trivial rebase/merge needed)
	const isDiverged = repo.base !== null && repo.base.ahead > 0 && repo.base.behind > 0;

	// isDrifted: on the wrong branch (not detached, but branch doesn't match expected)
	let isDrifted = false;
	if (repo.identity.headMode.kind === "attached") {
		isDrifted = repo.identity.headMode.branch !== expectedBranch;
	}

	const isMerged = repo.base?.mergedIntoBase != null;

	const isBaseMerged = repo.base?.baseMergedIntoDefault != null;

	return {
		isDirty: localDirty,
		isUnpushed,
		needsPull,
		needsRebase,
		isDiverged,
		isDrifted,
		isDetached,
		hasOperation: repo.operation !== null,
		isLocal,
		isGone,
		isShallow: repo.identity.shallow,
		isMerged,
		isBaseMerged,
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
		flags.isDiverged ||
		flags.isShallow ||
		flags.isBaseMerged
	);
}

const FLAG_LABELS: { key: keyof RepoFlags; label: string }[] = [
	{ key: "isDirty", label: "dirty" },
	{ key: "isUnpushed", label: "unpushed" },
	{ key: "needsPull", label: "behind share" },
	{ key: "needsRebase", label: "behind base" },
	{ key: "isDiverged", label: "diverged" },
	{ key: "isDrifted", label: "drifted" },
	{ key: "isDetached", label: "detached" },
	{ key: "hasOperation", label: "operation" },
	{ key: "isLocal", label: "local" },
	{ key: "isGone", label: "gone" },
	{ key: "isShallow", label: "shallow" },
	{ key: "isMerged", label: "merged" },
	{ key: "isBaseMerged", label: "base merged" },
];

export function flagLabels(flags: RepoFlags): string[] {
	return FLAG_LABELS.filter(({ key }) => flags[key]).map(({ label }) => label);
}

const YELLOW_FLAGS = new Set<keyof RepoFlags>([
	"isDirty",
	"isUnpushed",
	"isDrifted",
	"isDetached",
	"hasOperation",
	"isLocal",
	"isShallow",
	"isBaseMerged",
]);

export function formatIssueCounts(issueCounts: WorkspaceSummary["issueCounts"], rebasedOnlyCount = 0): string {
	return issueCounts
		.flatMap(({ label, key, count }) => {
			if (key === "isUnpushed" && rebasedOnlyCount > 0) {
				const genuine = count - rebasedOnlyCount;
				const parts: string[] = [];
				if (genuine > 0) parts.push(yellow(label));
				parts.push("rebased");
				return parts;
			}
			return [YELLOW_FLAGS.has(key) ? yellow(label) : label];
		})
		.join(", ");
}

export function wouldLoseWork(flags: RepoFlags): boolean {
	return flags.isDirty || flags.isUnpushed || flags.isDetached || flags.isDrifted || flags.hasOperation;
}

// ── Where Filtering ──

const FILTER_TERMS: Record<string, (f: RepoFlags) => boolean> = {
	dirty: (f) => f.isDirty,
	unpushed: (f) => f.isUnpushed,
	"behind-share": (f) => f.needsPull,
	"behind-base": (f) => f.needsRebase,
	diverged: (f) => f.isDiverged,
	drifted: (f) => f.isDrifted,
	detached: (f) => f.isDetached,
	operation: (f) => f.hasOperation,
	local: (f) => f.isLocal,
	gone: (f) => f.isGone,
	shallow: (f) => f.isShallow,
	merged: (f) => f.isMerged,
	"base-merged": (f) => f.isBaseMerged,
	"at-risk": (f) => needsAttention(f),
};

const VALID_TERMS = Object.keys(FILTER_TERMS);

export function validateWhere(where: string): string | null {
	const terms = where.split(",");
	const invalid = terms.filter((t) => !FILTER_TERMS[t]);
	if (invalid.length > 0) {
		return `Unknown filter ${invalid.length === 1 ? "term" : "terms"}: ${invalid.join(", ")}. Valid terms: ${VALID_TERMS.join(", ")}`;
	}
	return null;
}

export function repoMatchesWhere(flags: RepoFlags, where: string): boolean {
	const terms = where.split(",");
	return terms.some((t) => FILTER_TERMS[t]?.(flags) ?? false);
}

export function workspaceMatchesWhere(repos: RepoStatus[], branch: string, where: string): boolean {
	return repos.some((repo) => {
		const flags = computeFlags(repo, branch);
		return repoMatchesWhere(flags, where);
	});
}

export function isWorkspaceSafe(repos: RepoStatus[], branch: string): boolean {
	for (const repo of repos) {
		const flags = computeFlags(repo, branch);
		if (wouldLoseWork(flags)) return false;
		if (repo.share === null && repo.base !== null && repo.base.ahead > 0) return false;
	}
	return true;
}

// ── Workspace Summary ──

export interface WorkspaceSummary {
	workspace: string;
	branch: string;
	base: string | null;
	repos: RepoStatus[];
	total: number;
	withIssues: number;
	rebasedOnlyCount: number;
	issueLabels: string[];
	issueCounts: { label: string; count: number; key: keyof RepoFlags }[];
	lastCommit: string | null;
}

export function computeSummaryAggregates(
	repos: RepoStatus[],
	branch: string,
): {
	withIssues: number;
	rebasedOnlyCount: number;
	issueLabels: string[];
	issueCounts: WorkspaceSummary["issueCounts"];
} {
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

	let rebasedOnlyCount = 0;
	for (const repo of repos) {
		if (repo.share?.rebased != null && repo.share.rebased > 0) {
			const netNew = (repo.share.toPush ?? 0) - repo.share.rebased;
			if (netNew <= 0) rebasedOnlyCount++;
		}
	}

	return { withIssues, rebasedOnlyCount, issueLabels: [...allLabels], issueCounts };
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

	// Resolve remote names (upstream for base, share for tracking)
	const upstreamRemote = remotes?.upstream ?? "origin";
	const shareRemote = remotes?.share ?? "origin";

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
				baseStatus = {
					remote: upstreamRemote,
					ref: defaultBranch,
					ahead,
					behind,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
				};
			}
		}
	}

	// ── Section 4: Share (push/pull status vs share remote) ──

	let shareStatus: RepoStatus["share"] = null;
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
			let rebased: number | null = null;
			if (toPush !== null && toPush > 0 && toPull !== null && toPull > 0) {
				const result = await detectRebasedCommits(repoDir, trackingRef);
				rebased = result?.count ?? null;
			}
			shareStatus = {
				remote: shareRemote,
				ref: trackingRef,
				refMode: "configured",
				toPush,
				toPull,
				rebased,
			};
		} else if (await remoteBranchExists(repoDir, actualBranch, shareRemote)) {
			// Step 2: No tracking config but remote ref exists → implicit
			const implicitRef = `${shareRemote}/${actualBranch}`;
			const pushLr = await git(repoDir, "rev-list", "--left-right", "--count", `${implicitRef}...HEAD`);
			let toPush: number | null = null;
			let toPull: number | null = null;
			if (pushLr.exitCode === 0) {
				const parts = pushLr.stdout.trim().split(/\s+/);
				toPull = Number.parseInt(parts[0] ?? "0", 10);
				toPush = Number.parseInt(parts[1] ?? "0", 10);
			}
			let rebased: number | null = null;
			if (toPush !== null && toPush > 0 && toPull !== null && toPull > 0) {
				const result = await detectRebasedCommits(repoDir, implicitRef);
				rebased = result?.count ?? null;
			}
			shareStatus = {
				remote: shareRemote,
				ref: implicitRef,
				refMode: "implicit",
				toPush,
				toPull,
				rebased,
			};
		} else {
			// Step 3: Check if tracking config exists (→ gone) or not (→ noRef)
			const configRemote = await git(repoDir, "config", `branch.${actualBranch}.remote`);
			const isGone = configRemote.exitCode === 0 && configRemote.stdout.trim().length > 0;
			shareStatus = {
				remote: shareRemote,
				ref: null,
				refMode: isGone ? "gone" : "noRef",
				toPush: null,
				toPull: null,
				rebased: null,
			};
		}
	} else if (!repoHasRemote) {
		// No remote at all — share is null (local repo)
		shareStatus = null;
	} else {
		// Detached — share is present but no ref comparison possible
		shareStatus = {
			remote: shareRemote,
			ref: null,
			refMode: "noRef",
			toPush: null,
			toPull: null,
			rebased: null,
		};
	}

	// ── Merge detection ──
	// Skip when branch is at the exact same point as base (ahead=0, behind=0) — nothing to detect.
	// Ancestor check is cheap (single git command), always run when there's divergence.
	// Squash check is more expensive — only run when branch is gone OR share is up to date.
	const hasWork = baseStatus !== null && (baseStatus.ahead > 0 || baseStatus.behind > 0);
	if (baseStatus !== null && !detached && hasWork) {
		const compareRef = repoHasRemote ? `${upstreamRemote}/${baseStatus.ref}` : baseStatus.ref;
		const shareUpToDate =
			shareStatus !== null && shareStatus.toPush === 0 && shareStatus.toPull === 0 && shareStatus.refMode !== "noRef";
		const shouldCheckSquash = (shareStatus !== null && shareStatus.refMode === "gone") || shareUpToDate;

		// Phase 1: Ancestor check (instant) — detects merge commits and fast-forwards
		const ancestorResult = await git(repoDir, "merge-base", "--is-ancestor", "HEAD", compareRef);
		if (ancestorResult.exitCode === 0) {
			baseStatus.mergedIntoBase = "merge";
		} else if (shouldCheckSquash) {
			// Phase 2: Squash merge detection via cumulative patch-id
			baseStatus.mergedIntoBase = await detectBranchMerged(repoDir, compareRef);
		}
	}

	// ── Stacked base merge detection ──
	// When configBase is set and resolved, check if the base branch itself
	// has been merged into the repo's true default branch.
	if (configBase && baseStatus !== null && baseStatus.ref === configBase && repoHasRemote && !detached) {
		const trueDefault = await getDefaultBranch(repoPath, upstreamRemote);
		if (trueDefault && trueDefault !== configBase) {
			const configBaseRef = `${upstreamRemote}/${configBase}`;
			const defaultRef = `${upstreamRemote}/${trueDefault}`;
			baseStatus.baseMergedIntoDefault = await detectBranchMerged(repoDir, defaultRef, 200, configBaseRef);
		}
	}

	return {
		name: repo,
		identity: { worktreeKind, headMode, shallow },
		local,
		base: baseStatus,
		share: shareStatus,
		operation: gitDirResult,
		lastCommit: null,
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

	const repoResults = await Promise.all(
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

			const [status, commitDate] = await Promise.all([
				gatherRepoStatus(repoDir, reposDir, configBase, remotes, repoHasRemote),
				getHeadCommitDate(repoDir),
			]);
			scanned++;
			onProgress?.(scanned, repoDirs.length);
			return { status, commitDate };
		}),
	);

	const repos = repoResults.map((r) => {
		r.status.lastCommit = r.commitDate;
		return r.status;
	});

	const { withIssues, rebasedOnlyCount, issueLabels, issueCounts } = computeSummaryAggregates(repos, branch);

	const lastCommit = latestCommitDate(repoResults.map((r) => r.commitDate));

	return {
		workspace,
		branch,
		base: configBase,
		repos,
		total: repos.length,
		withIssues,
		rebasedOnlyCount,
		issueLabels,
		issueCounts,
		lastCommit,
	};
}
