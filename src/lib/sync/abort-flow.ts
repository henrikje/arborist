import { basename } from "node:path";
import { writeWorkspaceConfig } from "../core/config";
import { ArbError } from "../core/errors";
import type { OperationRecord } from "../core/operation";
import { deleteOperationRecord } from "../core/operation";
import { detectOperation, gitLocal } from "../git/git";
import { finishSummary } from "../render/render";
import { error, info, inlineResult, inlineStart, plural } from "../terminal/output";
import { workspaceRepoDirs } from "../workspace/repos";
import { confirmOrExit } from "./mutation-flow";

/**
 * Abort an in-progress operation: git abort/reset per repo, restore config, delete record.
 *
 * This is a simplified version of the full undo flow in commands/undo.ts,
 * designed for use by --abort flags on individual commands. It handles the
 * common sync case (rebase/merge abort + HEAD reset). For branch-rename
 * and workspace-rename abort, the per-command handler should call arb undo directly.
 */
export async function runSyncAbort(
  record: OperationRecord,
  wsDir: string,
  options: { yes?: boolean; dryRun?: boolean },
): Promise<void> {
  const repoDirs = workspaceRepoDirs(wsDir);
  const repoDirMap = new Map(repoDirs.map((d) => [basename(d), d]));

  // Count actionable repos
  let actionable = 0;
  for (const [_, state] of Object.entries(record.repos)) {
    if (state.status === "completed" || state.status === "conflicting") actionable++;
  }

  if (actionable === 0) {
    deleteOperationRecord(wsDir);
    const configFile = `${wsDir}/.arbws/config.json`;
    if (record.configBefore) writeWorkspaceConfig(configFile, record.configBefore);
    info("Nothing to abort — operation record cleaned up");
    return;
  }

  if (options.dryRun) {
    info(`Would abort ${record.command} in ${plural(actionable, "repo")}`);
    return;
  }

  await confirmOrExit({
    yes: options.yes,
    message: `Abort ${record.command} in ${plural(actionable, "repo")}?`,
  });

  process.stderr.write("\n");

  let undone = 0;
  const failures: string[] = [];

  // Abort in-progress git operations
  for (const [repoName, state] of Object.entries(record.repos)) {
    if (state.status !== "conflicting") continue;
    const repoDir = repoDirMap.get(repoName);
    if (!repoDir) continue;

    const op = await detectOperation(repoDir);
    if (op) {
      inlineStart(repoName, "aborting");
      const abortCmd = op === "merge" ? "merge" : "rebase";
      const result = await gitLocal(repoDir, abortCmd, "--abort");
      if (result.exitCode === 0) {
        inlineResult(repoName, `aborted ${abortCmd}`);
        undone++;
      } else {
        inlineResult(repoName, `failed to abort ${abortCmd}`);
        failures.push(repoName);
      }
    }
  }

  // Reset completed repos
  for (const [repoName, state] of Object.entries(record.repos)) {
    if (state.status !== "completed") continue;
    const repoDir = repoDirMap.get(repoName);
    if (!repoDir) continue;

    inlineStart(repoName, "resetting");
    const result = await gitLocal(repoDir, "reset", "--hard", state.preHead);
    if (result.exitCode === 0) {
      if (state.stashSha) {
        const stashResult = await gitLocal(repoDir, "stash", "apply", "--index", state.stashSha);
        if (stashResult.exitCode !== 0) {
          await gitLocal(repoDir, "stash", "apply", state.stashSha);
        }
      }
      inlineResult(repoName, `reset to ${state.preHead.slice(0, 7)}`);
      undone++;
    } else {
      inlineResult(repoName, "failed to reset");
      failures.push(repoName);
    }
  }

  // Config restore + record cleanup
  const configFile = `${wsDir}/.arbws/config.json`;
  if (record.configBefore) writeWorkspaceConfig(configFile, record.configBefore);

  if (failures.length > 0) {
    process.stderr.write("\n");
    error(`Failed to abort ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
    throw new ArbError(`Failed to abort ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
  }

  deleteOperationRecord(wsDir);
  process.stderr.write("\n");
  finishSummary([`Aborted ${plural(undone, "repo")}`], false);
}
