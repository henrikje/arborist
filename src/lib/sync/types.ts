import type { SkipFlag } from "../status/skip-flags";

export type ConflictPrediction = "no-conflict" | "clean" | "conflict" | null;

export interface CommitDisplayEntry {
  shortHash: string;
  subject: string;
}

export interface IntegrateCommitDisplayEntry extends CommitDisplayEntry {
  rebaseOf?: string;
  squashOf?: string[];
}

export interface ConflictCommitEntry {
  shortHash: string;
  files: string[];
}

export interface DiffStats {
  files: number;
  insertions: number;
  deletions: number;
}

export interface IntegrateRetargetInfo {
  from?: string;
  to?: string;
  blocked?: boolean;
  warning?: string;
  replayCount?: number;
  alreadyOnTarget?: number;
  reason?: "base-merged" | "branch-merged";
}

export interface IntegrateVerboseInfo {
  commits?: IntegrateCommitDisplayEntry[];
  totalCommits?: number;
  matchedCount?: number;
  mergeBaseSha?: string;
  outgoingCommits?: CommitDisplayEntry[];
  totalOutgoingCommits?: number;
  diffStats?: DiffStats;
  conflictCommits?: ConflictCommitEntry[];
}

interface IntegrateAssessmentBase {
  repo: string;
  repoDir: string;
  branch: string;
  baseBranch?: string;
  baseRemote: string;
  behind: number;
  ahead: number;
  headSha: string;
  shallow: boolean;
  conflictPrediction?: ConflictPrediction;
  retarget?: IntegrateRetargetInfo;
  baseFallback?: string;
  needsStash?: boolean;
  stashPopConflictFiles?: string[];
  verbose?: IntegrateVerboseInfo;
  wrongBranch?: boolean;
}

export interface IntegrateSkipAssessment extends IntegrateAssessmentBase {
  outcome: "skip";
  skipReason: string;
  skipFlag: SkipFlag;
}

export interface IntegrateUpToDateAssessment extends IntegrateAssessmentBase {
  outcome: "up-to-date";
  skipReason?: never;
  skipFlag?: never;
}

export interface IntegrateWillOperateAssessment extends IntegrateAssessmentBase {
  outcome: "will-operate";
  skipReason?: never;
  skipFlag?: never;
}

export type RepoAssessment = IntegrateSkipAssessment | IntegrateUpToDateAssessment | IntegrateWillOperateAssessment;

interface PullAssessmentBase {
  repo: string;
  repoDir: string;
  behind: number;
  toPush: number;
  rebased: number;
  replaced: number;
  squashed: number;
  rebasedKnown: boolean;
  fromBaseCount: number;
  pullMode: "rebase" | "merge";
  pullStrategy?: "rebase-pull" | "merge-pull" | "safe-reset" | "forced-reset";
  branch: string;
  headSha: string;
  shallow: boolean;
  safeReset?: PullSafeResetInfo;
  conflictPrediction?: ConflictPrediction;
  needsStash?: boolean;
  stashPopConflictFiles?: string[];
  verbose?: PullVerboseInfo;
  wrongBranch?: boolean;
}

export interface PullSkipAssessment extends PullAssessmentBase {
  outcome: "skip";
  skipReason: string;
  skipFlag: SkipFlag;
}

export interface PullUpToDateAssessment extends PullAssessmentBase {
  outcome: "up-to-date";
  skipReason?: never;
  skipFlag?: never;
}

export interface PullWillPullAssessment extends PullAssessmentBase {
  outcome: "will-pull";
  skipReason?: never;
  skipFlag?: never;
}

export interface PullSafeResetInfo {
  reason?: string;
  blockedBy?: string;
  target?: string;
  oldRemoteTip?: string;
}

export interface PullVerboseInfo {
  commits?: CommitDisplayEntry[];
  totalCommits?: number;
  diffStats?: DiffStats;
  conflictCommits?: ConflictCommitEntry[];
}

export type PullAssessment = PullSkipAssessment | PullUpToDateAssessment | PullWillPullAssessment;

interface PushAssessmentBase {
  repo: string;
  repoDir: string;
  ahead: number;
  behind: number;
  rebased: number;
  replaced: number;
  squashed: number;
  baseAhead: number;
  baseRef: string;
  branch: string;
  shareRemote: string;
  newBranch: boolean;
  headSha: string;
  recreate: boolean;
  behindBase: number;
  baseConflictPrediction?: ConflictPrediction;
  shallow: boolean;
  wrongBranch?: boolean;
  verbose?: {
    commits?: CommitDisplayEntry[];
    totalCommits?: number;
  };
}

export interface PushSkipAssessment extends PushAssessmentBase {
  outcome: "skip";
  skipReason: string;
  skipFlag: SkipFlag;
}

export interface PushUpToDateAssessment extends PushAssessmentBase {
  outcome: "up-to-date";
  skipReason?: never;
  skipFlag?: never;
}

export interface PushWillPushAssessment extends PushAssessmentBase {
  outcome: "will-push";
  skipReason?: never;
  skipFlag?: never;
}

export interface PushWillForcePushAssessment extends PushAssessmentBase {
  outcome: "will-force-push";
  skipReason?: never;
  skipFlag?: never;
}

export interface PushWillForcePushOutdatedAssessment extends PushAssessmentBase {
  outcome: "will-force-push-outdated";
  skipReason?: never;
  skipFlag?: never;
}

export type PushAssessment =
  | PushSkipAssessment
  | PushUpToDateAssessment
  | PushWillPushAssessment
  | PushWillForcePushAssessment
  | PushWillForcePushOutdatedAssessment;
