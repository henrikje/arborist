import type { GitOperation } from "../git/git";

// ── 5-Section Model Types ──

/** Lightweight ref topology — which branch a repo is on and where its base/share refs point.
 * Strict subset of RepoStatus: every field exists in RepoStatus with the same type,
 * but expensive-to-gather analysis fields (counts, merge, divergence) are absent. */
export interface RepoRefs {
  name: string;
  identity: {
    headMode: { kind: "attached"; branch: string } | { kind: "detached" };
  };
  base: {
    remote: string | null;
    ref: string;
    configuredRef: string | null;
  } | null;
  share: {
    remote: string;
    ref: string | null;
    refMode: "noRef" | "implicit" | "configured" | "gone";
  };
}

export interface RepoStatus extends RepoRefs {
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
    merge?: {
      kind: "merge" | "squash";
      newCommitsAfter?: number;
      commitHash?: string;
      detectedPr?: { number: number; url: string | null; mergeCommit?: string };
    };
    baseMergedIntoDefault: "merge" | "squash" | null;
    replayPlan?: {
      totalLocal: number;
      alreadyOnTarget: number;
      toReplay: number;
      contiguous: boolean;
      mergedPrefix?: boolean;
      allRebaseMatched?: boolean;
    };
  } | null;
  share: {
    remote: string;
    ref: string | null;
    refMode: "noRef" | "implicit" | "configured" | "gone";
    toPush: number | null; // null = unknown
    toPull: number | null; // null = unknown
    outdated?: {
      total: number; // rebased + replaced + squashed
      rebased: number; // patch-id matched
      replaced: number; // reflog matched
      squashed: number; // cumulative patch-id matched
    };
  };
  operation: GitOperation;
  headSha?: string;
  timedOut?: boolean;
  lastCommit: string | null;
  lastActivity: string | null;
  lastActivityFile: string | null;
}

export interface RepoFlags {
  isDirty: boolean;
  hasConflict: boolean;
  hasStaged: boolean;
  hasModified: boolean;
  hasUntracked: boolean;
  isAheadOfShare: boolean;
  hasNoShare: boolean;
  isBehindShare: boolean;
  isAheadOfBase: boolean;
  isBehindBase: boolean;
  isDiverged: boolean;
  isWrongBranch: boolean;
  isDetached: boolean;
  hasOperation: boolean;
  isGone: boolean;
  isShallow: boolean;
  isMerged: boolean;
  isBaseMerged: boolean;
  isBaseMissing: boolean;
  isTimedOut: boolean;
}

// ── Named flag sets ──

export const LOSE_WORK_FLAGS = new Set<keyof RepoFlags>([
  "isDirty",
  "isAheadOfShare",
  "isDetached",
  "isWrongBranch",
  "hasOperation",
]);

export const AT_RISK_FLAGS = new Set<keyof RepoFlags>([
  ...LOSE_WORK_FLAGS,
  "isTimedOut",
  "isShallow",
  "isBaseMerged",
  "isBaseMissing",
]);

export const STALE_FLAGS = new Set<keyof RepoFlags>(["isBehindShare", "isBehindBase", "isDiverged"]);

/** Flags that are always true when isMerged is true — displaying them adds noise. */
export const MERGED_IMPLIED_FLAGS = new Set<keyof RepoFlags>(["isBehindBase", "isDiverged"]);

export const FLAG_LABELS: { key: keyof RepoFlags; label: string }[] = [
  // Work-safety / immediate-attention flags.
  { key: "isDirty", label: "dirty" },
  { key: "hasConflict", label: "conflict" },
  { key: "isAheadOfShare", label: "ahead share" },
  { key: "hasOperation", label: "operation" },
  { key: "isDetached", label: "detached" },
  { key: "isWrongBranch", label: "wrong branch" },
  // Other at-risk/infrastructure signals.
  { key: "isTimedOut", label: "timed out" },
  { key: "isBaseMissing", label: "base missing" },
  { key: "isBaseMerged", label: "base merged" },
  { key: "isShallow", label: "shallow" },
  // Lifecycle markers.
  { key: "isMerged", label: "merged" },
  { key: "isGone", label: "gone" },
  // Staleness and informational tails.
  { key: "isDiverged", label: "diverged" },
  { key: "isBehindShare", label: "behind share" },
  { key: "isBehindBase", label: "behind base" },
];

// ── Age Filtering ──

export interface AgeFilter {
  olderThan?: number; // ms
  newerThan?: number; // ms
}

// ── Workspace Summary ──

export interface WorkspaceSummary {
  workspace: string;
  branch: string;
  base: string | null;
  repos: RepoStatus[];
  total: number;
  atRiskCount: number;
  outdatedOnlyCount: number;
  statusCounts: { label: string; count: number; key: keyof RepoFlags }[];
  lastCommit: string | null;
  lastActivity: string | null;
  lastActivityFile: string | null;
}
