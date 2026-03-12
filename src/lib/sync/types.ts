import type { SkipFlag } from "../status/skip-flags";

export interface RepoAssessment {
  repo: string;
  repoDir: string;
  outcome: "will-operate" | "up-to-date" | "skip";
  skipReason?: string;
  skipFlag?: SkipFlag;
  branch: string;
  baseBranch?: string;
  baseRemote: string;
  behind: number;
  ahead: number;
  headSha: string;
  shallow: boolean;
  conflictPrediction?: "no-conflict" | "clean" | "conflict" | null;
  retargetFrom?: string;
  retargetTo?: string;
  retargetBlocked?: boolean;
  retargetWarning?: string;
  needsStash?: boolean;
  stashPopConflictFiles?: string[];
  commits?: { shortHash: string; subject: string; rebaseOf?: string; squashOf?: string[] }[];
  totalCommits?: number;
  matchedCount?: number;
  mergeBaseSha?: string;
  outgoingCommits?: { shortHash: string; subject: string }[];
  totalOutgoingCommits?: number;
  diffStats?: { files: number; insertions: number; deletions: number };
  conflictCommits?: { shortHash: string; files: string[] }[];
  retargetReplayCount?: number;
  retargetAlreadyOnTarget?: number;
  retargetReason?: "base-merged" | "branch-merged";
  drifted?: boolean;
}
