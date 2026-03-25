import { existsSync } from "node:fs";
import { basename } from "node:path";
import { ArbError } from "../../core/errors";
import type { OperationRecord } from "../../core/operation";
import { branchExistsLocally, detectOperation, getDiffShortstat, gitLocal } from "../../git/git";
import { error } from "../../terminal/output";
import { workspaceRepoDirs } from "../../workspace/repos";
import type { RepoUndoAssessment } from "./types";

export async function assessBranchRenameUndo(
  record: OperationRecord & { command: "branch-rename" },
  wsDir: string,
): Promise<RepoUndoAssessment[]> {
  const repoDirs = workspaceRepoDirs(wsDir);
  const repoDirMap = new Map(repoDirs.map((d) => [basename(d), d]));

  const assessments: RepoUndoAssessment[] = [];

  for (const [repoName, state] of Object.entries(record.repos)) {
    const repoDir = repoDirMap.get(repoName);
    if (!repoDir) {
      assessments.push({ repo: repoName, repoDir: "", action: "skip", detail: "repo not in workspace" });
      continue;
    }

    if (state.status === "skipped" || state.status === "pending") {
      assessments.push({ repo: repoName, repoDir, action: "skip" });
      continue;
    }

    if (state.status === "conflicting") {
      assessments.push({ repo: repoName, repoDir, action: "no-action", detail: "rename did not complete" });
      continue;
    }

    const headResult = await gitLocal(repoDir, "symbolic-ref", "--short", "HEAD");
    const currentBranch = headResult.exitCode === 0 ? headResult.stdout.trim() : null;

    if (currentBranch === record.newBranch) {
      const currentHead = await gitLocal(repoDir, "rev-parse", "HEAD");
      const currentSha = currentHead.stdout.trim();
      if (currentSha !== state.preHead) {
        assessments.push({
          repo: repoName,
          repoDir,
          action: "drifted",
          detail: `HEAD moved from ${state.preHead.slice(0, 7)} to ${currentSha.slice(0, 7)}`,
        });
        continue;
      }
      const targetExists = await branchExistsLocally(repoDir, record.oldBranch);
      if (targetExists) {
        assessments.push({
          repo: repoName,
          repoDir,
          action: "drifted",
          detail: `branch '${record.oldBranch}' already exists (cannot rename back)`,
        });
        continue;
      }
      assessments.push({
        repo: repoName,
        repoDir,
        action: "needs-undo",
        detail: `rename ${record.newBranch} back to ${record.oldBranch}`,
      });
    } else if (currentBranch === record.oldBranch) {
      assessments.push({ repo: repoName, repoDir, action: "already-at-target" });
    } else {
      assessments.push({
        repo: repoName,
        repoDir,
        action: "drifted",
        detail: `on branch ${currentBranch ?? "unknown"}, expected ${record.newBranch}`,
      });
    }
  }

  return assessments;
}

export async function assessRenameUndo(
  record: OperationRecord & { command: "rename" },
  wsDir: string,
  arbRootDir: string,
): Promise<RepoUndoAssessment[]> {
  if (record.oldName !== record.newName) {
    const targetDir = `${arbRootDir}/${record.oldName}`;
    if (existsSync(targetDir)) {
      error(`Cannot undo — directory '${record.oldName}' already exists`);
      throw new ArbError(`Cannot undo — directory '${record.oldName}' already exists`);
    }
  }

  const oldBranch = record.configBefore?.branch;
  const newBranch = record.configAfter?.branch;

  if (!oldBranch || !newBranch || oldBranch === newBranch) {
    return Object.entries(record.repos).map(([repoName]) => ({
      repo: repoName,
      repoDir: "",
      action: "skip" as const,
    }));
  }

  const repoDirs = workspaceRepoDirs(wsDir);
  const repoDirMap = new Map(repoDirs.map((d) => [basename(d), d]));

  const assessments: RepoUndoAssessment[] = [];
  for (const [repoName, state] of Object.entries(record.repos)) {
    const repoDir = repoDirMap.get(repoName);
    if (!repoDir) {
      assessments.push({ repo: repoName, repoDir: "", action: "skip", detail: "repo not in workspace" });
      continue;
    }
    if (state.status === "skipped" || state.status === "pending") {
      assessments.push({ repo: repoName, repoDir, action: "skip" });
      continue;
    }
    if (state.status === "conflicting") {
      assessments.push({ repo: repoName, repoDir, action: "no-action", detail: "rename did not complete" });
      continue;
    }

    const headResult = await gitLocal(repoDir, "symbolic-ref", "--short", "HEAD");
    const currentBranch = headResult.exitCode === 0 ? headResult.stdout.trim() : null;

    if (currentBranch === newBranch) {
      const currentHead = await gitLocal(repoDir, "rev-parse", "HEAD");
      if (currentHead.stdout.trim() !== state.preHead) {
        assessments.push({
          repo: repoName,
          repoDir,
          action: "drifted",
          detail: `HEAD moved from ${state.preHead.slice(0, 7)} to ${currentHead.stdout.trim().slice(0, 7)}`,
        });
        continue;
      }
      const targetExists = await branchExistsLocally(repoDir, oldBranch);
      if (targetExists) {
        assessments.push({
          repo: repoName,
          repoDir,
          action: "drifted",
          detail: `branch '${oldBranch}' already exists (cannot rename back)`,
        });
        continue;
      }
      assessments.push({
        repo: repoName,
        repoDir,
        action: "needs-undo",
        detail: `rename ${newBranch} back to ${oldBranch}`,
      });
    } else if (currentBranch === oldBranch) {
      assessments.push({ repo: repoName, repoDir, action: "already-at-target" });
    } else {
      assessments.push({
        repo: repoName,
        repoDir,
        action: "drifted",
        detail: `on branch ${currentBranch ?? "unknown"}, expected ${newBranch}`,
      });
    }
  }
  return assessments;
}

export async function assessSyncUndo(record: OperationRecord, wsDir: string): Promise<RepoUndoAssessment[]> {
  const repoDirs = workspaceRepoDirs(wsDir);
  const repoDirMap = new Map(repoDirs.map((d) => [basename(d), d]));

  const assessments: RepoUndoAssessment[] = [];

  for (const [repoName, state] of Object.entries(record.repos)) {
    const repoDir = repoDirMap.get(repoName);
    if (!repoDir) {
      assessments.push({ repo: repoName, repoDir: "", action: "skip", detail: "repo not in workspace" });
      continue;
    }

    if (state.status === "skipped" || state.status === "pending") {
      assessments.push({ repo: repoName, repoDir, action: "skip" });
      continue;
    }

    if (state.status === "conflicting") {
      const op = await detectOperation(repoDir);
      if (op) {
        assessments.push({ repo: repoName, repoDir, action: "needs-abort", detail: `abort in-progress ${op}` });
        continue;
      }
      const headResult = await gitLocal(repoDir, "rev-parse", "HEAD");
      const currentHead = headResult.stdout.trim();
      if (currentHead === state.preHead) {
        assessments.push({ repo: repoName, repoDir, action: "already-at-target" });
      } else {
        assessments.push({
          repo: repoName,
          repoDir,
          action: "drifted",
          detail: `HEAD moved from ${state.preHead.slice(0, 7)} to ${currentHead.slice(0, 7)} (manually continued?)`,
        });
      }
      continue;
    }

    const headResult = await gitLocal(repoDir, "rev-parse", "HEAD");
    const currentHead = headResult.stdout.trim();

    if (state.postHead && currentHead === state.postHead) {
      const commitCountResult = await gitLocal(repoDir, "rev-list", "--count", `${state.preHead}..${state.postHead}`);
      const commitCount = Number.parseInt(commitCountResult.stdout.trim(), 10) || 0;
      const diffStats = await getDiffShortstat(repoDir, state.preHead, state.postHead);

      assessments.push({
        repo: repoName,
        repoDir,
        action: "needs-undo",
        detail: `reset to ${state.preHead.slice(0, 7)}`,
        stats: {
          commitCount,
          filesChanged: diffStats?.files ?? 0,
          insertions: diffStats?.insertions ?? 0,
          deletions: diffStats?.deletions ?? 0,
          hasStash: state.stashSha != null,
        },
      });
    } else if (currentHead === state.preHead) {
      assessments.push({ repo: repoName, repoDir, action: "already-at-target" });
    } else {
      assessments.push({
        repo: repoName,
        repoDir,
        action: "drifted",
        detail: `HEAD at ${currentHead.slice(0, 7)}, expected ${(state.postHead ?? state.preHead).slice(0, 7)}`,
      });
    }
  }

  return assessments;
}

export async function assessUndo(
  record: OperationRecord,
  wsDir: string,
  arbRootDir: string,
): Promise<RepoUndoAssessment[]> {
  switch (record.command) {
    case "branch-rename":
      return assessBranchRenameUndo(record, wsDir);
    case "retarget":
    case "rebase":
    case "merge":
    case "pull":
    case "reset":
      return assessSyncUndo(record, wsDir);
    case "rename":
      return assessRenameUndo(record, wsDir, arbRootDir);
    default: {
      const _exhaustive: never = record;
      throw new ArbError("Undo is not yet supported for this operation");
    }
  }
}
