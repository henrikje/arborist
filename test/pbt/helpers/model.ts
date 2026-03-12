/**
 * Lightweight model for predicting `arb status --json` output.
 *
 * The model tracks per-repo state (commits, push state, remote state) and
 * derives the expected RepoStatus fields + RepoFlags from that state.
 */

import type { TestEnv } from "../../integration/helpers/env";

// ── Per-repo model ───────────────────────────────────────────────

export interface RepoModel {
  /** Commits on feature branch since branching. */
  localCommits: number;
  /** Whether we've ever run `arb push` (sets tracking). */
  pushed: boolean;
  /** localCommits at time of last Push. */
  pushedCommits: number;
  /** Commits added to origin/main since branching. */
  baseAdvanced: number;
  /** Whether origin/<branch> exists (via Push or external push). */
  remoteShareExists: boolean;
  /** Commits pushed by others to origin/<branch> since last fetch. */
  externalCommits: number;
}

export function freshRepoModel(): RepoModel {
  return {
    localCommits: 0,
    pushed: false,
    pushedCommits: 0,
    baseAdvanced: 0,
    remoteShareExists: false,
    externalCommits: 0,
  };
}

// ── Workspace model ──────────────────────────────────────────────

/** Single-workspace model: just a map of repo name → state. */
export interface WorkspaceModel {
  repos: Record<string, RepoModel>;
  /** True when state has changed since the last CheckStatus. */
  dirty: boolean;
}

export function freshWorkspaceModel(repoNames: string[]): WorkspaceModel {
  return { repos: Object.fromEntries(repoNames.map((r) => [r, freshRepoModel()])), dirty: true };
}

// ── Real system wrapper ──────────────────────────────────────────

export interface RealSystem {
  env: TestEnv;
  wsName: string;
  /** Monotonically increasing counter for unique file names. */
  commitCounter: number;
  /** Commands executed so far (for progress reporting). */
  executedCommands: string[];
}

// ── Status predictions ───────────────────────────────────────────

export interface PredictedRepoStatus {
  // base section
  baseAhead: number;
  baseBehind: number;
  // share section
  shareRefMode: "noRef" | "implicit" | "configured";
  shareToPush: number | null;
  shareToPull: number | null;
  shareRebased: number | null;
  shareReplaced: number | null;
  shareSquashed: number | null;
  // local section
  localConflicts: number;
  // flags
  isDirty: boolean;
  isUnpushed: boolean;
  needsPull: boolean;
  needsRebase: boolean;
  isDiverged: boolean;
  isMerged: boolean;
  isDetached: boolean;
  isDrifted: boolean;
  hasOperation: boolean;
  isGone: boolean;
}

export function predictRepoStatus(repo: RepoModel): PredictedRepoStatus {
  const baseAhead = repo.localCommits;
  const baseBehind = repo.baseAdvanced;

  // share.refMode
  let shareRefMode: "noRef" | "implicit" | "configured";
  if (repo.pushed) {
    shareRefMode = "configured";
  } else if (repo.remoteShareExists) {
    shareRefMode = "implicit";
  } else {
    shareRefMode = "noRef";
  }

  // share.toPush / toPull
  let shareToPush: number | null;
  let shareToPull: number | null;
  if (repo.pushed) {
    shareToPush = repo.localCommits - repo.pushedCommits;
    shareToPull = repo.externalCommits;
  } else if (repo.remoteShareExists) {
    shareToPush = repo.localCommits;
    shareToPull = repo.externalCommits;
  } else {
    shareToPush = null;
    shareToPull = null;
  }

  // share.rebased / replaced / squashed — detection only runs when both toPush > 0 and toPull > 0.
  // No force-push scenarios in v1, so when detection runs it finds 0 matches.
  const detectionRan = shareToPush !== null && shareToPush > 0 && shareToPull !== null && shareToPull > 0;
  const shareRebased = detectionRan ? 0 : null;
  const shareReplaced = detectionRan ? 0 : null;
  const shareSquashed = detectionRan ? 0 : null;

  // flags
  let isUnpushed = false;
  if (shareToPush !== null && shareToPush > 0) {
    isUnpushed = true;
  } else if (shareRefMode === "noRef" && baseAhead > 0) {
    isUnpushed = true;
  }

  const needsPull = shareToPull !== null && shareToPull > 0;
  const needsRebase = baseBehind > 0;
  const isDiverged = baseAhead > 0 && baseBehind > 0;

  return {
    baseAhead,
    baseBehind,
    shareRefMode,
    shareToPush,
    shareToPull,
    shareRebased,
    shareReplaced,
    shareSquashed,
    localConflicts: 0,
    isDirty: false,
    isUnpushed,
    needsPull,
    needsRebase,
    isDiverged,
    isMerged: false,
    isDetached: false,
    isDrifted: false,
    hasOperation: false,
    isGone: false,
  };
}
