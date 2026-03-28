export type { RepoUndoAssessment, UndoAction, UndoResult, UndoStats, UndoVerboseInfo } from "./types";

import { rm } from "node:fs/promises";
import { basename } from "node:path";
import { writeWorkspaceConfig } from "../../core/config";
import { ArbError } from "../../core/errors";
import type { OperationRecord } from "../../core/operation";
import {
  classifyContinueRepo,
  finalizeOperationRecord,
  readOperationRecord,
  writeOperationRecord,
} from "../../core/operation";
import { gitLocal } from "../../git/git";
import { finishSummary } from "../../render/render";
import { dryRunNotice, error, info, plural, warn } from "../../terminal/output";
import { workspaceRepoDirs } from "../../workspace/repos";
import { confirmOrExit } from "../mutation-flow";
import { assessUndo, gatherUndoVerboseCommits } from "./assess";
import { executeBranchRenameUndo, executeRenameUndo, executeSyncUndo } from "./execute";
import { formatUndoPlan } from "./plan";
import type { RepoUndoAssessment, UndoResult } from "./types";

export async function runUndoFlow(params: {
  wsDir: string;
  arbRootDir: string;
  reposDir: string;
  options: { yes?: boolean; dryRun?: boolean; verbose?: boolean; force?: boolean };
  /** "undo" for arb undo, "abort" for --abort (changes wording in prompts/summary) */
  verb?: "undo" | "abort";
  /** When provided, only undo these repos (selective undo). Empty/undefined = all repos. */
  repos?: string[];
  /** Pre-read operation record — avoids a second read when the caller already validated it. */
  record?: OperationRecord;
}): Promise<void> {
  const { wsDir, arbRootDir, reposDir, options } = params;
  const verb = params.verb ?? "undo";
  const verbLabel = verb === "abort" ? "Abort" : "Undo";
  const verbed = verb === "abort" ? "Aborted" : "Undone";
  const selectedRepos = params.repos ?? [];
  const isSelective = selectedRepos.length > 0;

  const record = params.record ?? readOperationRecord(wsDir);
  if (!record) {
    const msg = `Nothing to ${verb}`;
    error(msg);
    throw new ArbError(msg);
  }

  // Stale warning (>7 days + stash)
  const ageMs = Date.now() - new Date(record.startedAt).getTime();
  const hasStash = Object.values(record.repos).some((r) => r.stashSha);
  if (ageMs > 7 * 24 * 60 * 60 * 1000 && hasStash) {
    warn("This operation is older than 7 days — stashed changes may have been garbage collected by git");
  }

  // Reconcile conflicting repos that were manually continued/aborted via git
  await reconcileConflictingRepos(record, wsDir);

  const allAssessments = await assessUndo(record, wsDir, arbRootDir);

  // Filter to selected repos when selective
  const assessments = isSelective ? allAssessments.filter((a) => selectedRepos.includes(a.repo)) : allAssessments;

  if (options.verbose) {
    await gatherUndoVerboseCommits(record, assessments);
  }

  // Force reclassification: drifted → needs-undo (skip structural blockers)
  if (options.force) {
    const isRename = record.command === "branch-rename" || record.command === "rename";
    for (const a of assessments) {
      if (a.action !== "drifted") continue;
      // "already exists" is a structural blocker (target branch exists), not a safety guard
      if (a.detail?.includes("already exists")) continue;
      const state = record.repos[a.repo];
      const preHead = state?.preHead;
      if (!preHead) continue;
      a.action = "needs-undo";
      a.forced = true;
      a.detail = isRename
        ? `force undo (was: ${a.detail})`
        : `force reset to ${preHead.slice(0, 7)} (was: ${a.detail})`;
    }
  }

  // Drift check — scoped to active assessments only
  const drifted = assessments.filter((a) => a.action === "drifted");
  if (drifted.length > 0) {
    process.stderr.write(formatUndoPlan(record, assessments, verb, options.verbose));
    const msg = `Cannot ${verb} — ${plural(drifted.length, "repo")} drifted since the operation`;
    error(msg);
    throw new ArbError(msg);
  }

  // Nothing to do
  const actionable = assessments.filter((a) => a.action === "needs-undo" || a.action === "needs-abort");
  if (actionable.length === 0) {
    // Check if ALL repos (not just selected) are resolved
    const fullyResolved = allReposResolved(allAssessments);
    if (fullyResolved) {
      const configFile = `${wsDir}/.arbws/config.json`;
      if (record.configBefore) {
        writeWorkspaceConfig(configFile, record.configBefore);
      }
      finalizeOperationRecord(wsDir, "completed");
    }
    info(
      fullyResolved ? `Nothing to ${verb} — operation record cleaned up` : `Nothing to ${verb} for the selected repos`,
    );
    return;
  }

  process.stderr.write(formatUndoPlan(record, assessments, verb, options.verbose));

  if (options.dryRun) {
    dryRunNotice();
    return;
  }

  await confirmOrExit({
    yes: options.yes,
    message: `${verbLabel} ${record.command} in ${plural(actionable.length, "repo")}?`,
  });

  process.stderr.write("\n");

  // Execute — for selective rename, defer directory rename
  const isPartialRenameUndo = isSelective && record.command === "rename";
  let result: UndoResult;
  switch (record.command) {
    case "branch-rename":
      result = await executeBranchRenameUndo(record, assessments);
      break;
    case "retarget":
    case "rebase":
    case "merge":
    case "pull":
    case "reset":
      result = await executeSyncUndo(record, assessments);
      break;
    case "rename":
      result = await executeRenameUndo(record, assessments, wsDir, arbRootDir, reposDir, {
        skipDirectoryRename: isPartialRenameUndo,
      });
      break;
    case "extract": {
      result = await executeSyncUndo(record, assessments);
      // Remove worktrees and workspace directory created during extract
      const extractWsDir = `${arbRootDir}/${record.targetWorkspace}`;
      for (const repoName of Object.keys(record.repos)) {
        const repoDir = `${reposDir}/${repoName}`;
        const worktreePath = `${extractWsDir}/${repoName}`;
        await gitLocal(repoDir, "worktree", "remove", "--force", worktreePath).catch(() => {});
        await gitLocal(repoDir, "branch", "-D", record.targetBranch).catch(() => {});
      }
      await rm(extractWsDir, { recursive: true, force: true }).catch(() => {});
      break;
    }
    default: {
      const _exhaustive: never = record;
      throw new ArbError("Undo is not yet supported for this operation");
    }
  }

  // After rename undo (non-selective), the directory may have moved
  const dirRenamed = record.command === "rename" && !isPartialRenameUndo && record.oldName !== record.newName;
  const effectiveWsDir = dirRenamed ? `${arbRootDir}/${record.oldName}` : wsDir;

  // Mark undone repos in the record
  for (const repoName of result.undoneRepos) {
    const existing = record.repos[repoName];
    if (existing) {
      record.repos[repoName] = { ...existing, status: "undone" };
    }
  }
  writeOperationRecord(effectiveWsDir, record);

  if (result.failures.length > 0) {
    process.stderr.write("\n");
    error(`Failed to ${verb} ${plural(result.failures.length, "repo")}: ${result.failures.join(", ")}`);
    throw new ArbError(`Failed to ${verb} ${plural(result.failures.length, "repo")}: ${result.failures.join(", ")}`);
  }

  // When rename undo already moved the directory, skip re-assessment (it would fail
  // because assessRenameUndo checks the old directory doesn't exist — but we just renamed to it).
  if (dirRenamed) {
    finalizeFull(record, effectiveWsDir, verb);
    process.stderr.write("\n");
    finishSummary([`${verbed} ${plural(result.undone, "repo")}`], false);
    return;
  }

  // Re-assess: are all repos now resolved?
  const updatedAllAssessments = await assessUndo(record, effectiveWsDir, arbRootDir);
  if (allReposResolved(updatedAllAssessments)) {
    // For selective rename with deferred directory rename, execute it now
    if (isPartialRenameUndo && record.oldName !== record.newName) {
      await executeDeferredDirectoryRename(record, wsDir, arbRootDir, reposDir);
      const renamedWsDir = `${arbRootDir}/${record.oldName}`;
      finalizeFull(record, renamedWsDir, verb);
    } else {
      finalizeFull(record, effectiveWsDir, verb);
    }
    process.stderr.write("\n");
    finishSummary([`${verbed} ${plural(result.undone, "repo")}`], false);
  } else {
    // Partial undo — summarize with remaining count and hint
    const remaining = updatedAllAssessments.filter((a) => a.action === "needs-undo" || a.action === "needs-abort");
    process.stderr.write("\n");
    finishSummary([`${verbed} ${plural(result.undone, "repo")}`, `${remaining.length} remaining`], false);
    info(`Use 'arb undo' to undo the remaining ${plural(remaining.length, "repo")}`);
  }
}

/** Check whether all repos in the assessments are resolved (nothing left to undo). */
function allReposResolved(assessments: RepoUndoAssessment[]): boolean {
  return assessments.every(
    (a) =>
      a.action === "already-at-target" ||
      a.action === "already-undone" ||
      a.action === "skip" ||
      a.action === "no-action",
  );
}

/** Restore config and finalize the operation record. */
function finalizeFull(record: OperationRecord, wsDir: string, verb: "undo" | "abort"): void {
  const configFile = `${wsDir}/.arbws/config.json`;
  if (record.configBefore) {
    writeWorkspaceConfig(configFile, record.configBefore);
  }
  finalizeOperationRecord(wsDir, verb === "abort" ? "aborted" : "undone");
}

/** Execute only the directory rename portion of a rename undo (no branch renames). */
async function executeDeferredDirectoryRename(
  record: OperationRecord & { command: "rename" },
  wsDir: string,
  arbRootDir: string,
  reposDir: string,
): Promise<void> {
  // Pass empty assessments — only the directory rename runs (branch renames were already done).
  await executeRenameUndo(record, [], wsDir, arbRootDir, reposDir);
}

/**
 * Patch the operation record for repos the user resolved outside arb (e.g. `git rebase --continue`
 * or `git rebase --abort`). Without this, `assessSyncUndo` would classify them as "drifted" and
 * block the undo. The same classification logic is used by the gate (`assertNoInProgressOperation`).
 */
async function reconcileConflictingRepos(record: OperationRecord, wsDir: string): Promise<void> {
  if (record.status !== "in-progress") return;

  const syncCommands = new Set(["rebase", "merge", "pull", "retarget", "reset"]);
  if (!syncCommands.has(record.command)) return;

  const conflicting = Object.entries(record.repos).filter(([, s]) => s.status === "conflicting");
  if (conflicting.length === 0) return;

  const repoDirMap = new Map(workspaceRepoDirs(wsDir).map((d) => [basename(d), d]));

  let changed = false;
  for (const [repoName, state] of conflicting) {
    const repoDir = repoDirMap.get(repoName);
    if (!repoDir) continue;

    const c = await classifyContinueRepo(repoDir, state);
    if (c.action === "manually-continued") {
      record.repos[repoName] = { ...state, status: "completed", postHead: c.postHead };
      changed = true;
    } else if (c.action === "manually-aborted") {
      record.repos[repoName] = { ...state, status: "completed" };
      changed = true;
    }
  }

  if (changed) {
    writeOperationRecord(wsDir, record);
  }
}
