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
		remote: string | null;
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
		toPush: number | null; // null = unknown
		toPull: number | null; // null = unknown
		rebased: number | null; // count of patch-id-matched commits between push/pull sets
	};
	operation: GitOperation;
	lastCommit: string | null;
}

/** Build the full git ref for a base section (e.g. "origin/main"). */
export function baseRef(base: NonNullable<RepoStatus["base"]>): string {
	return base.remote ? `${base.remote}/${base.ref}` : base.ref;
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
	isGone: boolean;
	isShallow: boolean;
	isMerged: boolean;
	isBaseMerged: boolean;
	baseFellBack: boolean;
}

// ── Named flag sets ──

export const LOSE_WORK_FLAGS = new Set<keyof RepoFlags>([
	"isDirty",
	"isUnpushed",
	"isDetached",
	"isDrifted",
	"hasOperation",
]);

export const AT_RISK_FLAGS = new Set<keyof RepoFlags>([
	...LOSE_WORK_FLAGS,
	"isShallow",
	"isBaseMerged",
	"baseFellBack",
]);

export const STALE_FLAGS = new Set<keyof RepoFlags>(["needsPull", "needsRebase", "isDiverged"]);

/** Flags that are always true when isMerged is true — displaying them adds noise. */
export const MERGED_IMPLIED_FLAGS = new Set<keyof RepoFlags>(["needsRebase", "isDiverged"]);

function hasAnyFlag(flags: RepoFlags, set: Set<keyof RepoFlags>): boolean {
	for (const key of set) {
		if (flags[key]) return true;
	}
	return false;
}

export function isAtRisk(flags: RepoFlags): boolean {
	return hasAnyFlag(flags, AT_RISK_FLAGS);
}

export function isLocalDirty(local: {
	staged: number;
	modified: number;
	untracked: number;
	conflicts: number;
}): boolean {
	return local.staged > 0 || local.modified > 0 || local.untracked > 0 || local.conflicts > 0;
}

export function computeFlags(repo: RepoStatus, expectedBranch: string): RepoFlags {
	const localDirty = isLocalDirty(repo.local);

	const isDetached = repo.identity.headMode.kind === "detached";

	const isGone = repo.share.refMode === "gone";

	// isUnpushed: has commits to push to share remote, or never pushed with commits ahead of base
	// Note: "gone" branches are excluded — the remote deleted the branch (typically after PR merge),
	// so "unpushed" would be misleading. The "gone" flag alone signals the state.
	let isUnpushed = false;
	if (repo.share.toPush !== null && repo.share.toPush > 0) {
		isUnpushed = true;
	} else if (repo.share.refMode === "noRef" && repo.base !== null && repo.base.ahead > 0) {
		isUnpushed = true;
	}

	// needsPull: share remote has commits to pull
	const needsPull = repo.share.toPull !== null && repo.share.toPull > 0;

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

	const baseFellBack = repo.base?.configuredRef != null && repo.base?.baseMergedIntoDefault == null;

	return {
		isDirty: localDirty,
		isUnpushed,
		needsPull,
		needsRebase,
		isDiverged,
		isDrifted,
		isDetached,
		hasOperation: repo.operation !== null,
		isGone,
		isShallow: repo.identity.shallow,
		isMerged,
		isBaseMerged,
		baseFellBack,
	};
}

const FLAG_LABELS: { key: keyof RepoFlags; label: string }[] = [
	// Work-safety / immediate-attention flags.
	{ key: "isDirty", label: "dirty" },
	{ key: "isUnpushed", label: "unpushed" },
	{ key: "hasOperation", label: "operation" },
	{ key: "isDetached", label: "detached" },
	{ key: "isDrifted", label: "drifted" },
	// Other at-risk/infrastructure signals.
	{ key: "baseFellBack", label: "base missing" },
	{ key: "isBaseMerged", label: "base merged" },
	{ key: "isShallow", label: "shallow" },
	// Lifecycle markers.
	{ key: "isMerged", label: "merged" },
	{ key: "isGone", label: "gone" },
	// Staleness and informational tails.
	{ key: "isDiverged", label: "diverged" },
	{ key: "needsPull", label: "behind share" },
	{ key: "needsRebase", label: "behind base" },
];

export function flagLabels(flags: RepoFlags): string[] {
	return FLAG_LABELS.filter(({ key }) => {
		if (!flags[key]) return false;
		if (flags.isMerged && MERGED_IMPLIED_FLAGS.has(key)) return false;
		return true;
	}).map(({ label }) => label);
}

export function formatStatusCounts(
	statusCounts: WorkspaceSummary["statusCounts"],
	rebasedOnlyCount = 0,
	yellowKeys: Set<keyof RepoFlags> = AT_RISK_FLAGS,
): string {
	return statusCounts
		.flatMap(({ label, key, count }) => {
			if (key === "isUnpushed" && rebasedOnlyCount > 0) {
				const genuine = count - rebasedOnlyCount;
				const parts: string[] = [];
				if (genuine > 0) parts.push(yellow(label));
				parts.push("rebased");
				return parts;
			}
			return [yellowKeys.has(key) ? yellow(label) : label];
		})
		.join(", ");
}

export function wouldLoseWork(flags: RepoFlags): boolean {
	return hasAnyFlag(flags, LOSE_WORK_FLAGS);
}

// ── Where Filtering ──

const FILTER_TERMS: Record<string, (f: RepoFlags) => boolean> = {
	// Negative / problem-condition terms
	dirty: (f) => f.isDirty,
	unpushed: (f) => f.isUnpushed,
	"behind-share": (f) => f.needsPull,
	"behind-base": (f) => f.needsRebase,
	diverged: (f) => f.isDiverged,
	drifted: (f) => f.isDrifted,
	detached: (f) => f.isDetached,
	operation: (f) => f.hasOperation,
	gone: (f) => f.isGone,
	shallow: (f) => f.isShallow,
	merged: (f) => f.isMerged,
	"base-merged": (f) => f.isBaseMerged,
	"base-missing": (f) => f.baseFellBack,
	"at-risk": (f) => isAtRisk(f),
	stale: (f) => hasAnyFlag(f, STALE_FLAGS),
	// Positive / healthy-state terms
	clean: (f) => !f.isDirty,
	pushed: (f) => !f.isUnpushed,
	"synced-base": (f) => !f.needsRebase && !f.isDiverged,
	"synced-share": (f) => !f.needsPull,
	synced: (f) => !hasAnyFlag(f, STALE_FLAGS),
	safe: (f) => !isAtRisk(f),
};

const VALID_TERMS = Object.keys(FILTER_TERMS);

/** Strip a leading `^` negation prefix, returning the base term and whether it was negated. */
function parseNegation(term: string): { base: string; negated: boolean } {
	if (term.startsWith("^")) return { base: term.slice(1), negated: true };
	return { base: term, negated: false };
}

export function validateWhere(where: string): string | null {
	const groups = where.split(",");
	const allTerms = groups.flatMap((g) => g.split("+"));
	const invalid = allTerms.filter((t) => !FILTER_TERMS[parseNegation(t).base]);
	if (invalid.length > 0) {
		return `Unknown filter ${invalid.length === 1 ? "term" : "terms"}: ${invalid.join(", ")}. Valid terms: ${VALID_TERMS.join(", ")} (prefix with ^ to negate)`;
	}
	return null;
}

export function repoMatchesWhere(flags: RepoFlags, where: string): boolean {
	const groups = where.split(",");
	return groups.some((group) => {
		const terms = group.split("+");
		return terms.every((t) => {
			const { base, negated } = parseNegation(t);
			const result = FILTER_TERMS[base]?.(flags) ?? false;
			return negated ? !result : result;
		});
	});
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
	atRiskCount: number;
	rebasedOnlyCount: number;
	statusLabels: string[];
	statusCounts: { label: string; count: number; key: keyof RepoFlags }[];
	lastCommit: string | null;
}

export function computeSummaryAggregates(
	repos: RepoStatus[],
	branch: string,
): {
	atRiskCount: number;
	rebasedOnlyCount: number;
	statusLabels: string[];
	statusCounts: WorkspaceSummary["statusCounts"];
} {
	let atRiskCount = 0;
	const allLabels = new Set<string>();
	const flagCounts = new Map<keyof RepoFlags, number>();
	for (const repo of repos) {
		const flags = computeFlags(repo, branch);
		if (isAtRisk(flags)) {
			atRiskCount++;
		}
		for (const { key, label } of FLAG_LABELS) {
			if (flags[key]) {
				if (flags.isMerged && MERGED_IMPLIED_FLAGS.has(key)) continue;
				allLabels.add(label);
				flagCounts.set(key, (flagCounts.get(key) ?? 0) + 1);
			}
		}
	}
	const statusCounts = FLAG_LABELS.filter(({ key }) => flagCounts.has(key)).map(({ key, label }) => ({
		label,
		count: flagCounts.get(key) ?? 0,
		key,
	}));

	let rebasedOnlyCount = 0;
	for (const repo of repos) {
		if (repo.share.rebased != null && repo.share.rebased > 0) {
			const netNew = (repo.share.toPush ?? 0) - repo.share.rebased;
			if (netNew <= 0) rebasedOnlyCount++;
		}
	}

	return { atRiskCount, rebasedOnlyCount, statusLabels: [...allLabels], statusCounts };
}

// ── Status Gathering ──

export async function gatherRepoStatus(
	repoDir: string,
	reposDir: string,
	configBase: string | null,
	remotes?: RepoRemotes,
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

	// Resolve remote names (upstream for base, share for tracking).
	// When caller didn't pre-resolve, resolve here. Errors propagate.
	const resolvedRemotes = remotes ?? (await resolveRemotes(repoPath));
	const baseRemote = resolvedRemotes.base;
	const shareRemote = resolvedRemotes.share;

	// ── Section 2: Local (working tree status) ──
	// Gathered above in the parallel group (parseGitStatus → local).

	// ── Section 3: Base (integration status vs upstream default branch) ──

	let baseStatus: RepoStatus["base"] = null;
	if (!detached) {
		// Base branch resolution
		let defaultBranch: string | null = null;
		let fellBack = false;
		if (configBase) {
			const baseExists = await remoteBranchExists(repoPath, configBase, baseRemote);
			if (baseExists) {
				defaultBranch = configBase;
			}
		}
		if (!defaultBranch && baseRemote) {
			defaultBranch = await getDefaultBranch(repoPath, baseRemote);
			if (configBase && defaultBranch) fellBack = true;
		}

		if (defaultBranch) {
			const compareRef = baseRemote ? `${baseRemote}/${defaultBranch}` : defaultBranch;
			const lr = await git(repoDir, "rev-list", "--left-right", "--count", `${compareRef}...HEAD`);
			if (lr.exitCode === 0) {
				const parts = lr.stdout.trim().split(/\s+/);
				const behind = Number.parseInt(parts[0] ?? "0", 10);
				const ahead = Number.parseInt(parts[1] ?? "0", 10);
				baseStatus = {
					remote: baseRemote ?? null,
					ref: defaultBranch,
					configuredRef: fellBack ? configBase : null,
					ahead,
					behind,
					mergedIntoBase: null,
					baseMergedIntoDefault: null,
				};
			}
		}
	}

	// ── Section 4: Share (push/pull status vs share remote) ──

	let shareStatus: RepoStatus["share"];
	if (!detached) {
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
	// Run when there's divergence from base (ahead/behind > 0), OR when the remote branch is
	// gone (catches fast-forward merges where ahead=0, behind=0 after the branch was deleted).
	// Skip when on the base branch itself (base-is-share scenario, e.g. main tracking origin/main).
	// Skip when branch was never pushed and has no unique commits — the ancestor check would
	// trivially pass (HEAD is always an ancestor of a ref ahead of it with no diverging commits).
	// Ancestor check is cheap (single git command), always run when eligible.
	// Squash check is more expensive — only run when branch is gone OR share is up to date.
	const hasWork = baseStatus !== null && (baseStatus.ahead > 0 || baseStatus.behind > 0);
	const isGone = shareStatus.refMode === "gone";
	const isOnBaseBranch = actualBranch === baseStatus?.ref;
	const skipForNeverPushed = baseStatus !== null && baseStatus.ahead === 0 && shareStatus.refMode === "noRef";
	if (baseStatus !== null && !detached && (hasWork || isGone) && !isOnBaseBranch && !skipForNeverPushed) {
		const compareRef = baseRemote ? `${baseRemote}/${baseStatus.ref}` : baseStatus.ref;
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
	if (configBase && baseStatus !== null && baseRemote && !detached) {
		if (baseStatus.ref === configBase) {
			// Base branch exists on remote — use remote ref for detection
			const trueDefault = await getDefaultBranch(repoPath, baseRemote);
			if (trueDefault && trueDefault !== configBase) {
				const configBaseRef = `${baseRemote}/${configBase}`;
				const defaultRef = `${baseRemote}/${trueDefault}`;
				baseStatus.baseMergedIntoDefault = await detectBranchMerged(repoDir, defaultRef, 200, configBaseRef);
			}
		} else {
			// Base branch gone from remote — try local branch ref for detection
			const localExists = await branchExistsLocally(repoPath, configBase);
			if (localExists) {
				const defaultRef = `${baseRemote}/${baseStatus.ref}`;
				baseStatus.baseMergedIntoDefault = await detectBranchMerged(repoDir, defaultRef, 200, configBase);
			}
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
			const remotes = await resolveRemotes(canonicalPath, remoteNames);

			const [status, commitDate] = await Promise.all([
				gatherRepoStatus(repoDir, reposDir, configBase, remotes),
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

	const { atRiskCount, rebasedOnlyCount, statusLabels, statusCounts } = computeSummaryAggregates(repos, branch);

	const lastCommit = latestCommitDate(repoResults.map((r) => r.commitDate));

	return {
		workspace,
		branch,
		base: configBase,
		repos,
		total: repos.length,
		atRiskCount,
		rebasedOnlyCount,
		statusLabels,
		statusCounts,
		lastCommit,
	};
}
