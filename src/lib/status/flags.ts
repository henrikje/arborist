import {
  AT_RISK_FLAGS,
  FLAG_LABELS,
  LOSE_WORK_FLAGS,
  MERGED_IMPLIED_FLAGS,
  type RepoFlags,
  type RepoStatus,
  type WorkspaceSummary,
} from "./types";

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
  const isDirty = isLocalDirty(repo.local);
  const hasConflict = repo.local.conflicts > 0;

  const isDetached = repo.identity.headMode.kind === "detached";

  const isGone = repo.share.refMode === "gone";

  const hasNoShare = repo.share.refMode === "noRef";

  // isAheadOfShare: has commits to push to share remote, or never pushed with commits ahead of base
  // Note: "gone" branches are excluded — the remote deleted the branch (typically after PR merge),
  // so "ahead of share" would be misleading. The "gone" flag alone signals the state.
  let isAheadOfShare = false;
  if (repo.share.toPush !== null && repo.share.toPush > 0) {
    isAheadOfShare = true;
  } else if (hasNoShare && repo.base !== null && repo.base.ahead > 0) {
    isAheadOfShare = true;
  }

  // isBehindShare: share remote has genuinely new commits (not just outdated/replaced)
  const isBehindShare = repo.share.toPull !== null && repo.share.toPull > (repo.share.outdated?.total ?? 0);

  // isAheadOfBase: has commits ahead of base branch
  const isAheadOfBase = repo.base !== null && repo.base.ahead > 0;

  // isBehindBase: behind base branch
  const isBehindBase = repo.base !== null && repo.base.behind > 0;

  // isDiverged: both ahead of and behind base branch (non-trivial rebase/merge needed)
  const isDiverged = repo.base !== null && repo.base.ahead > 0 && repo.base.behind > 0;

  // isWrongBranch: on the wrong branch (not detached, but branch doesn't match expected)
  let isWrongBranch = false;
  if (repo.identity.headMode.kind === "attached") {
    isWrongBranch = repo.identity.headMode.branch !== expectedBranch;
  }

  const isMerged = repo.base?.merge != null;

  const isBaseMerged = repo.base?.baseMergedIntoDefault != null;

  const isBaseMissing = repo.base?.configuredRef != null && repo.base.baseMergedIntoDefault == null;

  return {
    isDirty,
    hasConflict,
    isAheadOfShare,
    hasNoShare,
    isBehindShare,
    isAheadOfBase,
    isBehindBase,
    isDiverged,
    isWrongBranch,
    isDetached,
    hasOperation: repo.operation !== null,
    isGone,
    isShallow: repo.identity.shallow,
    isMerged,
    isBaseMerged,
    isBaseMissing,
    isTimedOut: repo.timedOut === true,
  };
}

export function wouldLoseWork(flags: RepoFlags): boolean {
  return hasAnyFlag(flags, LOSE_WORK_FLAGS);
}

export function isWorkspaceSafe(repos: RepoStatus[], branch: string): boolean {
  for (const repo of repos) {
    const flags = computeFlags(repo, branch);
    if (wouldLoseWork(flags)) return false;
  }
  return true;
}

export function computeSummaryAggregates(
  repos: RepoStatus[],
  branch: string,
): {
  atRiskCount: number;
  outdatedOnlyCount: number;
  statusCounts: WorkspaceSummary["statusCounts"];
} {
  let atRiskCount = 0;
  const flagCounts = new Map<keyof RepoFlags, number>();
  for (const repo of repos) {
    const flags = computeFlags(repo, branch);
    if (isAtRisk(flags)) {
      atRiskCount++;
    }
    for (const { key } of FLAG_LABELS) {
      if (flags[key]) {
        if (flags.isMerged && MERGED_IMPLIED_FLAGS.has(key)) continue;
        flagCounts.set(key, (flagCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const statusCounts = FLAG_LABELS.filter(({ key }) => flagCounts.has(key)).map(({ key, label }) => ({
    label,
    count: flagCounts.get(key) ?? 0,
    key,
  }));

  let outdatedOnlyCount = 0;
  for (const repo of repos) {
    const totalMatched = repo.share.outdated?.total ?? 0;
    if (totalMatched > 0) {
      const netNew = (repo.share.toPush ?? 0) - totalMatched;
      if (netNew <= 0) outdatedOnlyCount++;
    }
  }

  return { atRiskCount, outdatedOnlyCount, statusCounts };
}
