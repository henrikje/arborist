import type { GitOperation } from "../git/git";

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
  lastCommit: string | null;
  lastActivity: string | null;
  lastActivityFile: string | null;
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

export const FLAG_LABELS: { key: keyof RepoFlags; label: string }[] = [
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
