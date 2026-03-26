import type { CommitDisplayEntry, DiffStats } from "../types";

export type UndoAction = "needs-undo" | "needs-abort" | "already-at-target" | "no-action" | "skip" | "drifted";

export interface UndoStats {
  commitCount: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
  hasStash: boolean;
}

export interface UndoVerboseInfo {
  commits: CommitDisplayEntry[];
  totalCommits: number;
  diffStats?: DiffStats;
}

export interface RepoUndoAssessment {
  repo: string;
  repoDir: string;
  action: UndoAction;
  detail?: string;
  stats?: UndoStats;
  verbose?: UndoVerboseInfo;
}

export interface UndoResult {
  undone: number;
  failures: string[];
}
