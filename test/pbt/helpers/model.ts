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
  /** Untracked files in working tree. */
  untracked: number;
  /** Staged (new) files in the index. */
  staged: number;
  /** Cumulative base commits absorbed via rebase since last push. */
  baseAbsorbedSinceLastPush: number;
  /** Whether we've rebased since the last push (changes share divergence shape). */
  rebasedSinceLastPush: boolean;
}

export function freshRepoModel(): RepoModel {
  return {
    localCommits: 0,
    pushed: false,
    pushedCommits: 0,
    baseAdvanced: 0,
    remoteShareExists: false,
    externalCommits: 0,
    untracked: 0,
    staged: 0,
    baseAbsorbedSinceLastPush: 0,
    rebasedSinceLastPush: false,
  };
}

// ── Workspace model ──────────────────────────────────────────────

/** Single-workspace model: just a map of repo name → state. */
export interface WorkspaceModel {
  repos: Record<string, RepoModel>;
  /** Snapshot of the model before the last undoable operation (Rebase, Pull). */
  lastOperationSnapshot: { repos: Record<string, RepoModel> } | null;
  /** Whether an undoable operation record currently exists. */
  hasOperationRecord: boolean;
  /** After undo, commit matching (outdated counts) is unpredictable — skip those assertions. */
  skipOutdatedAssertions: boolean;
}

export function freshWorkspaceModel(repoNames: string[]): WorkspaceModel {
  return {
    repos: Object.fromEntries(repoNames.map((r) => [r, freshRepoModel()])),
    lastOperationSnapshot: null,
    hasOperationRecord: false,
    skipOutdatedAssertions: false,
  };
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
  localStaged: number;
  localModified: number;
  localUntracked: number;
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

  // share.toPush / toPull — shape depends on whether we've rebased since last push
  let shareToPush: number | null;
  let shareToPull: number | null;
  if (repo.pushed && repo.rebasedSinceLastPush) {
    // After rebase: all local commits have new SHAs, base commits are incorporated.
    // merge-base moves back to the point before base commits were absorbed.
    shareToPush = repo.localCommits + repo.baseAbsorbedSinceLastPush;
    shareToPull = repo.pushedCommits + repo.externalCommits;
  } else if (repo.pushed) {
    shareToPush = repo.localCommits - repo.pushedCommits;
    shareToPull = repo.externalCommits;
  } else if (repo.remoteShareExists) {
    shareToPush = repo.localCommits;
    shareToPull = repo.externalCommits;
  } else {
    shareToPush = null;
    shareToPull = null;
  }

  // share.rebased / replaced / squashed — detection runs when both toPush > 0 and toPull > 0.
  const detectionRan = shareToPush !== null && shareToPush > 0 && shareToPull !== null && shareToPull > 0;
  let shareRebased: number | null = null;
  let shareReplaced: number | null = null;
  let shareSquashed: number | null = null;

  if (detectionRan) {
    if (repo.rebasedSinceLastPush) {
      // After rebase: old pushed commits match new rebased commits by patch-id
      shareRebased = repo.pushedCommits;
      const unmatchedPull = (shareToPull ?? 0) - shareRebased;
      if (unmatchedPull > 0) {
        // External commits don't match reflog or squash patterns
        shareReplaced = 0;
        shareSquashed = 0;
      }
    } else {
      // No rebase: no commits match
      shareRebased = 0;
      shareReplaced = 0;
      shareSquashed = 0;
    }
  }

  // flags
  let isUnpushed = false;
  if (shareToPush !== null && shareToPush > 0) {
    isUnpushed = true;
  } else if (shareRefMode === "noRef" && baseAhead > 0) {
    isUnpushed = true;
  }

  // needsPull: genuine new commits on remote (excluding outdated/rebased)
  const totalOutdatedPull = (shareRebased ?? 0) + (shareReplaced ?? 0) + (shareSquashed ?? 0);
  const needsPull = shareToPull !== null && shareToPull > 0 && shareToPull > totalOutdatedPull;

  const needsRebase = baseBehind > 0;
  const isDiverged = baseAhead > 0 && baseBehind > 0;
  const isDirty = repo.staged > 0 || repo.untracked > 0;

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
    localStaged: repo.staged,
    localModified: 0,
    localUntracked: repo.untracked,
    isDirty,
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
