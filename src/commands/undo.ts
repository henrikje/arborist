import { basename } from "node:path";
import type { Command } from "commander";
import {
  ArbError,
  type OperationRecord,
  arbAction,
  deleteOperationRecord,
  readOperationRecord,
  writeWorkspaceConfig,
} from "../lib/core";
import { detectOperation, gitLocal } from "../lib/git";
import { type RenderContext, finishSummary, render } from "../lib/render";
import type { Cell, OutputNode } from "../lib/render";
import { cell } from "../lib/render";
import { confirmOrExit } from "../lib/sync";
import { dryRunNotice, error, info, inlineResult, inlineStart, plural, shouldColor, warn } from "../lib/terminal";
import { requireWorkspace, workspaceRepoDirs } from "../lib/workspace";

// ── Per-repo undo classification ──

type UndoAction = "needs-undo" | "needs-abort" | "already-at-target" | "no-action" | "skip" | "drifted";

interface RepoUndoAssessment {
  repo: string;
  repoDir: string;
  action: UndoAction;
  detail?: string;
}

// ── Undo logic per command type ──

async function assessBranchRenameUndo(
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
      // Rename didn't complete — nothing to reverse
      assessments.push({ repo: repoName, repoDir, action: "no-action", detail: "rename did not complete" });
      continue;
    }

    // status === "completed" — check current state
    const headResult = await gitLocal(repoDir, "symbolic-ref", "--short", "HEAD");
    const currentBranch = headResult.exitCode === 0 ? headResult.stdout.trim() : null;

    if (currentBranch === record.newBranch) {
      // Check for drift (user made commits after rename)
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

interface UndoResult {
  undone: number;
  failures: string[];
}

async function executeBranchRenameUndo(
  record: OperationRecord & { command: "branch-rename" },
  assessments: RepoUndoAssessment[],
): Promise<UndoResult> {
  let undone = 0;
  const failures: string[] = [];

  for (const a of assessments) {
    if (a.action !== "needs-undo") continue;

    inlineStart(a.repo, "reverting");
    const result = await gitLocal(a.repoDir, "branch", "-m", record.newBranch, record.oldBranch);
    if (result.exitCode === 0) {
      // Clear stale tracking
      await gitLocal(a.repoDir, "config", "--unset", `branch.${record.oldBranch}.remote`);
      await gitLocal(a.repoDir, "config", "--unset", `branch.${record.oldBranch}.merge`);
      inlineResult(a.repo, `reverted to ${record.oldBranch}`);
      undone++;
    } else {
      inlineResult(a.repo, "failed to revert");
      failures.push(a.repo);
    }
  }

  return { undone, failures };
}

// ── Sync undo (retarget, rebase, merge) ──

async function assessSyncUndo(record: OperationRecord, wsDir: string): Promise<RepoUndoAssessment[]> {
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
      // Check if git operation is still in progress
      const op = await detectOperation(repoDir);
      if (op) {
        assessments.push({
          repo: repoName,
          repoDir,
          action: "needs-abort",
          detail: `abort in-progress ${op}`,
        });
        continue;
      }
      // No git op — check if user manually resolved or aborted
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

    // status === "completed"
    const headResult = await gitLocal(repoDir, "rev-parse", "HEAD");
    const currentHead = headResult.stdout.trim();

    if (state.postHead && currentHead === state.postHead) {
      assessments.push({
        repo: repoName,
        repoDir,
        action: "needs-undo",
        detail: `reset to ${state.preHead.slice(0, 7)}`,
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

async function executeSyncUndo(record: OperationRecord, assessments: RepoUndoAssessment[]): Promise<UndoResult> {
  let undone = 0;
  const failures: string[] = [];

  // First: abort in-progress git operations
  for (const a of assessments) {
    if (a.action !== "needs-abort") continue;

    inlineStart(a.repo, "aborting");
    const op = await detectOperation(a.repoDir);
    const abortCmd = op === "merge" ? "merge" : "rebase";
    const result = await gitLocal(a.repoDir, abortCmd, "--abort");
    if (result.exitCode === 0) {
      inlineResult(a.repo, `aborted ${abortCmd}`);
      undone++;
    } else {
      inlineResult(a.repo, `failed to abort ${abortCmd}`);
      failures.push(a.repo);
    }
  }

  // Then: reset completed repos
  for (const a of assessments) {
    if (a.action !== "needs-undo") continue;

    const state = record.repos[a.repo];
    if (!state) continue;

    inlineStart(a.repo, "resetting");
    const result = await gitLocal(a.repoDir, "reset", "--hard", state.preHead);
    if (result.exitCode === 0) {
      // Restore stash if one was captured
      if (state.stashSha) {
        const stashResult = await gitLocal(a.repoDir, "stash", "apply", "--index", state.stashSha);
        if (stashResult.exitCode !== 0) {
          // Try without --index
          const fallbackResult = await gitLocal(a.repoDir, "stash", "apply", state.stashSha);
          if (fallbackResult.exitCode !== 0) {
            inlineResult(
              a.repo,
              `reset to ${state.preHead.slice(0, 7)} (stash restore failed — run 'git stash apply ${state.stashSha}' manually)`,
            );
            undone++;
            continue;
          }
        }
      }
      inlineResult(a.repo, `reset to ${state.preHead.slice(0, 7)}`);
      undone++;
    } else {
      inlineResult(a.repo, "failed to reset");
      failures.push(a.repo);
    }
  }

  return { undone, failures };
}

// ── Shared undo infrastructure ──

async function assessUndo(record: OperationRecord, wsDir: string): Promise<RepoUndoAssessment[]> {
  switch (record.command) {
    case "branch-rename":
      return assessBranchRenameUndo(record, wsDir);
    case "retarget":
    case "rebase":
    case "merge":
    case "pull":
    case "reset":
    case "rename":
      return assessSyncUndo(record, wsDir);
    default: {
      const _exhaustive: never = record;
      throw new ArbError("Undo is not yet supported for this operation");
    }
  }
}

function formatUndoPlan(record: OperationRecord, assessments: RepoUndoAssessment[]): string {
  const commandLabel = record.command === "branch-rename" ? "branch rename" : record.command;

  const nodes: OutputNode[] = [
    { kind: "gap" },
    { kind: "message", level: "default", text: `Undo ${commandLabel} from ${formatTime(record.startedAt)}` },
    { kind: "gap" },
  ];

  const rows = assessments
    .filter((a) => a.action !== "skip")
    .map((a) => {
      let actionCell: Cell;
      switch (a.action) {
        case "needs-undo":
          actionCell = cell(a.detail ?? "undo");
          break;
        case "needs-abort":
          actionCell = cell(a.detail ?? "abort in-progress operation");
          break;
        case "already-at-target":
          actionCell = cell("already at original state", "muted");
          break;
        case "no-action":
          actionCell = cell(a.detail ?? "no action needed", "muted");
          break;
        case "drifted":
          actionCell = cell(`drifted — ${a.detail}`, "danger");
          break;
        default:
          actionCell = cell("unknown");
      }
      return { cells: { repo: cell(a.repo), action: actionCell } };
    });

  nodes.push({
    kind: "table",
    columns: [
      { header: "REPO", key: "repo" },
      { header: "ACTION", key: "action" },
    ],
    rows,
  });

  nodes.push({ kind: "gap" });

  const rCtx: RenderContext = { tty: shouldColor() };
  return render(nodes, rCtx);
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

// ── Command registration ──

export function registerUndoCommand(program: Command): void {
  program
    .command("undo")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("-f, --force", "Delete a corrupted operation record without attempting to undo")
    .summary("Undo the last workspace operation")
    .description(
      "Reverses the most recent workspace operation (branch rename, retarget, rebase, merge, or pull). Reads the operation record from .arbws/operation.json, shows what will be undone, and asks for confirmation.\n\nFor branch renames: reverses the git branch -m and restores the workspace config.\nFor sync operations (rebase, merge, retarget): resets repos to their pre-operation HEAD and aborts any in-progress git operations.\n\nIf any repo has drifted (HEAD moved since the operation), undo is refused with an explanation. Use --yes to skip the confirmation prompt.\n\nUse --force to delete a corrupted operation record without attempting to undo. This is an escape hatch when the record is unreadable.",
    )
    .action(
      arbAction(async (ctx, options: { yes?: boolean; dryRun?: boolean; force?: boolean }) => {
        const { wsDir } = requireWorkspace(ctx);

        // --force: delete corrupted record without reading it
        if (options.force) {
          deleteOperationRecord(wsDir);
          info("Operation record cleared");
          return;
        }

        const record = readOperationRecord(wsDir);
        if (!record) {
          const msg = "Nothing to undo";
          error(msg);
          throw new ArbError(msg);
        }

        // Warn if operation is older than 7 days (stash GC risk)
        const ageMs = Date.now() - new Date(record.startedAt).getTime();
        const hasStash = Object.values(record.repos).some((r) => r.stashSha);
        if (ageMs > 7 * 24 * 60 * 60 * 1000 && hasStash) {
          warn("This operation is older than 7 days — stashed changes may have been garbage collected by git");
        }

        const assessments = await assessUndo(record, wsDir);

        // Check for drift
        const drifted = assessments.filter((a) => a.action === "drifted");
        if (drifted.length > 0) {
          process.stderr.write(formatUndoPlan(record, assessments));
          const msg = `Cannot undo — ${plural(drifted.length, "repo")} drifted since the operation`;
          error(msg);
          throw new ArbError(msg);
        }

        const actionable = assessments.filter((a) => a.action === "needs-undo" || a.action === "needs-abort");
        if (actionable.length === 0) {
          // Nothing to undo but record exists — clean up
          deleteOperationRecord(wsDir);
          const configFile = `${wsDir}/.arbws/config.json`;
          if (record.configBefore) {
            writeWorkspaceConfig(configFile, record.configBefore);
          }
          info("Nothing to undo — operation record cleaned up");
          return;
        }

        process.stderr.write(formatUndoPlan(record, assessments));

        if (options.dryRun) {
          dryRunNotice();
          return;
        }

        await confirmOrExit({
          yes: options.yes,
          message: `Undo ${record.command} in ${plural(actionable.length, "repo")}?`,
        });

        process.stderr.write("\n");

        // Execute command-specific undo
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
          case "rename":
            result = await executeSyncUndo(record, assessments);
            break;
          default: {
            const _exhaustive: never = record;
            throw new ArbError("Undo is not yet supported for this operation");
          }
        }

        // Shared tail: always restore config (even on partial failure).
        // Config should reflect the pre-operation state regardless of which repos succeeded.
        const configFile = `${wsDir}/.arbws/config.json`;
        if (record.configBefore) {
          writeWorkspaceConfig(configFile, record.configBefore);
        }

        if (result.failures.length > 0) {
          // Don't delete record — user can re-run undo after fixing the failed repos
          process.stderr.write("\n");
          error(`Failed to undo ${plural(result.failures.length, "repo")}: ${result.failures.join(", ")}`);
          throw new ArbError(`Failed to undo ${plural(result.failures.length, "repo")}: ${result.failures.join(", ")}`);
        }

        deleteOperationRecord(wsDir);
        process.stderr.write("\n");
        finishSummary([`Undone ${plural(result.undone, "repo")}`], false);
      }),
    );
}
