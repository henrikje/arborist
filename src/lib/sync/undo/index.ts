export type { RepoUndoAssessment, UndoAction, UndoResult, UndoStats } from "./types";

import { writeWorkspaceConfig } from "../../core/config";
import { ArbError } from "../../core/errors";
import { deleteOperationRecord, readOperationRecord } from "../../core/operation";
import { finishSummary } from "../../render/render";
import { dryRunNotice, error, info, plural, warn } from "../../terminal/output";
import { confirmOrExit } from "../mutation-flow";
import { assessUndo } from "./assess";
import { executeBranchRenameUndo, executeRenameUndo, executeSyncUndo } from "./execute";
import { formatUndoPlan } from "./plan";
import type { UndoResult } from "./types";

export async function runUndoFlow(params: {
  wsDir: string;
  arbRootDir: string;
  reposDir: string;
  options: { yes?: boolean; dryRun?: boolean };
  /** "undo" for arb undo, "abort" for --abort (changes wording in prompts/summary) */
  verb?: "undo" | "abort";
}): Promise<void> {
  const { wsDir, arbRootDir, reposDir, options } = params;
  const verb = params.verb ?? "undo";
  const verbLabel = verb === "abort" ? "Abort" : "Undo";
  const verbed = verb === "abort" ? "Aborted" : "Undone";

  const record = readOperationRecord(wsDir);
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

  const assessments = await assessUndo(record, wsDir, arbRootDir);

  // Drift check
  const drifted = assessments.filter((a) => a.action === "drifted");
  if (drifted.length > 0) {
    process.stderr.write(formatUndoPlan(record, assessments, verb));
    const msg = `Cannot ${verb} — ${plural(drifted.length, "repo")} drifted since the operation`;
    error(msg);
    throw new ArbError(msg);
  }

  // Nothing to do
  const actionable = assessments.filter((a) => a.action === "needs-undo" || a.action === "needs-abort");
  if (actionable.length === 0) {
    deleteOperationRecord(wsDir);
    const configFile = `${wsDir}/.arbws/config.json`;
    if (record.configBefore) {
      writeWorkspaceConfig(configFile, record.configBefore);
    }
    info(`Nothing to ${verb} — operation record cleaned up`);
    return;
  }

  process.stderr.write(formatUndoPlan(record, assessments, verb));

  if (options.dryRun) {
    dryRunNotice();
    return;
  }

  await confirmOrExit({
    yes: options.yes,
    message: `${verbLabel} ${record.command} in ${plural(actionable.length, "repo")}?`,
  });

  process.stderr.write("\n");

  // Execute
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
      result = await executeRenameUndo(record, assessments, wsDir, arbRootDir, reposDir);
      break;
    default: {
      const _exhaustive: never = record;
      throw new ArbError("Undo is not yet supported for this operation");
    }
  }

  // Config restore
  const effectiveWsDir =
    record.command === "rename" && record.oldName !== record.newName ? `${arbRootDir}/${record.oldName}` : wsDir;
  const configFile = `${effectiveWsDir}/.arbws/config.json`;
  if (record.configBefore) {
    writeWorkspaceConfig(configFile, record.configBefore);
  }

  if (result.failures.length > 0) {
    process.stderr.write("\n");
    error(`Failed to ${verb} ${plural(result.failures.length, "repo")}: ${result.failures.join(", ")}`);
    throw new ArbError(`Failed to ${verb} ${plural(result.failures.length, "repo")}: ${result.failures.join(", ")}`);
  }

  deleteOperationRecord(effectiveWsDir);
  process.stderr.write("\n");
  finishSummary([`${verbed} ${plural(result.undone, "repo")}`], false);
}
