import { basename } from "node:path";
import { ArbError } from "../core/errors";
import type { OperationRecord } from "../core/operation";
import { classifyContinueRepo, withReflogAction, writeOperationRecord } from "../core/operation";
import { gitLocal, parseGitStatus } from "../git/git";
import { buildConflictReport, buildStashPopFailureReport } from "../render/conflict-report";
import type { Cell, OutputNode } from "../render/model";
import { cell } from "../render/model";
import { type RenderContext, finishSummary, render } from "../render/render";
import { dryRunNotice, info, inlineResult, inlineStart, plural, yellow } from "../terminal/output";
import { shouldColor } from "../terminal/tty";
import { workspaceRepoDirs } from "../workspace/repos";
import { confirmOrExit } from "./mutation-flow";

export interface ContinueFlowParams {
  record: OperationRecord;
  wsDir: string;
  /** Display label: "retarget", "rebase", "merge", "pull" */
  mode: string;
  /** Static git subcommand ("rebase") or async per-repo detector (for pull) */
  gitContinueCmd: string | ((repoDir: string) => Promise<string>);
  options: { yes?: boolean; dryRun?: boolean };
  /** Called when all repos complete — e.g., apply configAfter, show config message */
  onComplete?: (record: OperationRecord) => Promise<void> | void;
}

export async function runContinueFlow(params: ContinueFlowParams): Promise<void> {
  const { record, wsDir, mode, gitContinueCmd, options, onComplete } = params;

  const repoDirs = workspaceRepoDirs(wsDir);
  const repoDirMap = new Map(repoDirs.map((d) => [basename(d), d]));

  // Step 1: Classify each repo
  const classifications: {
    repo: string;
    repoDir: string;
    classification: Awaited<ReturnType<typeof classifyContinueRepo>>;
  }[] = [];
  for (const [repoName, state] of Object.entries(record.repos)) {
    const repoDir = repoDirMap.get(repoName);
    if (!repoDir) {
      info(`${repoName}: skipped (no longer in workspace)`);
      classifications.push({ repo: repoName, repoDir: "", classification: { action: "skip" } });
      continue;
    }
    const classification = await classifyContinueRepo(repoDir, state);
    classifications.push({ repo: repoName, repoDir, classification });
  }

  const stillConflicting = classifications.filter((c) => c.classification.action === "still-conflicting");
  const willContinue = classifications.filter((c) => c.classification.action === "will-continue");
  const needsExecute = classifications.filter((c) => c.classification.action === "needs-execute");

  // Step 2: Update record for manually-resolved repos
  for (const c of classifications) {
    if (c.classification.action === "manually-continued") {
      const existing = record.repos[c.repo];
      if (existing) {
        record.repos[c.repo] = { ...existing, status: "completed", postHead: c.classification.postHead };
      }
    } else if (c.classification.action === "manually-aborted") {
      const existing = record.repos[c.repo];
      if (existing) {
        record.repos[c.repo] = { ...existing, status: "skipped" };
      }
    }
  }

  // Step 3: Warn about repos with unexpected git operations
  for (const c of classifications) {
    if (c.classification.action === "unexpected-operation") {
      info(`${c.repo}: has a ${c.classification.operation} in progress (not from this operation) — resolve it first`);
    }
  }

  // Step 3a: Warn about repos that were never started (crash recovery)
  if (needsExecute.length > 0) {
    for (const c of needsExecute) {
      info(`${c.repo}: was not started — use 'arb ${mode} --abort' then re-run 'arb ${mode}' to include it`);
    }
  }

  // Step 3b: Early exit if only still-conflicting (nothing actionable)
  if (stillConflicting.length > 0 && willContinue.length === 0) {
    writeOperationRecord(wsDir, record);
    for (const c of stillConflicting) {
      info(`${c.repo}: conflicts not yet resolved`);
    }
    info(`Resolve conflicts, then use 'arb ${mode} --continue' to resume or 'arb ${mode} --abort' to cancel`);
    throw new ArbError("Conflicts not yet resolved");
  }

  // Step 4: Build and render plan table
  const planNodes: OutputNode[] = [
    { kind: "gap" },
    { kind: "message", level: "default", text: `Continuing ${mode}` },
    { kind: "gap" },
  ];

  const rows = classifications
    .filter((c) => c.classification.action !== "skip")
    .map((c) => {
      let actionCell: Cell;
      switch (c.classification.action) {
        case "will-continue":
          actionCell = cell(`continue ${mode}`);
          break;
        case "still-conflicting":
          actionCell = cell("conflicts not resolved", "attention");
          break;
        case "manually-continued":
          actionCell = cell("already resolved", "muted");
          break;
        case "manually-aborted":
          actionCell = cell("manually aborted", "muted");
          break;
        case "already-done":
          actionCell = cell("already done", "muted");
          break;
        case "needs-execute":
          actionCell = cell("not started — undo and re-run to include", "attention");
          break;
        case "unexpected-operation":
          actionCell = cell(`${c.classification.operation} in progress (not from this operation)`, "danger");
          break;
        default:
          actionCell = cell("skip", "muted");
      }
      return { cells: { repo: cell(c.repo), action: actionCell } };
    });

  planNodes.push({
    kind: "table",
    columns: [
      { header: "REPO", key: "repo" },
      { header: "ACTION", key: "action" },
    ],
    rows,
  });
  planNodes.push({ kind: "gap" });

  const rCtx: RenderContext = { tty: shouldColor() };
  process.stderr.write(render(planNodes, rCtx));

  // Step 5: Handle dry-run
  if (options.dryRun) {
    dryRunNotice();
    return;
  }

  // Step 6: Early exit when all resolved (no actionable repos)
  const actionable = willContinue.length + stillConflicting.length;
  if (actionable === 0) {
    if (onComplete) await onComplete(record);
    record.status = "completed";
    record.completedAt = new Date().toISOString();
    writeOperationRecord(wsDir, record);
    process.stderr.write("\n");

    const abortedCount = classifications.filter((c) => c.classification.action === "manually-aborted").length;
    const alreadyDoneCount = classifications.filter((c) => c.classification.action === "already-done").length;
    const resolvedCount = classifications.filter((c) => c.classification.action === "manually-continued").length;

    const summaryParts: string[] = [];
    if (alreadyDoneCount > 0) summaryParts.push(`${alreadyDoneCount} already done`);
    if (resolvedCount > 0) summaryParts.push(`${resolvedCount} already resolved`);
    if (abortedCount > 0) summaryParts.push(`${abortedCount} aborted`);
    finishSummary(summaryParts.length > 0 ? summaryParts : [`${capitalize(mode)} completed`], false);
    return;
  }

  // Step 7: Confirm
  await confirmOrExit({
    yes: options.yes,
    message: `Continue ${mode} in ${plural(willContinue.length, "repo")}?`,
  });

  process.stderr.write("\n");

  // Step 8: Execute continues with -c core.editor=true (B1 fix)
  let succeeded = 0;
  const newConflicts: { repo: string; stdout: string; stderr: string }[] = [];
  const stashPopFailed: { repo: string }[] = [];

  await withReflogAction(`arb-${mode}-continue`, async () => {
    for (const c of willContinue) {
      inlineStart(c.repo, `continuing ${mode}`);
      const cmd = typeof gitContinueCmd === "string" ? gitContinueCmd : await gitContinueCmd(c.repoDir);
      const result = await gitLocal(c.repoDir, "-c", "core.editor=true", cmd, "--continue");
      if (result.exitCode === 0) {
        // Detect autostash pop conflict: git rebase --continue exits 0 even
        // when the autostash apply conflicts, leaving unmerged paths.
        const postStatus = await parseGitStatus(c.repoDir);
        const hasStashPopConflict = postStatus.conflicts > 0;
        if (hasStashPopConflict) {
          stashPopFailed.push({ repo: c.repo });
        }
        const postHeadResult = await gitLocal(c.repoDir, "rev-parse", "HEAD");
        const existing = record.repos[c.repo];
        if (existing) {
          record.repos[c.repo] = { ...existing, status: "completed", postHead: postHeadResult.stdout.trim() };
        }
        writeOperationRecord(wsDir, record);
        const doneMsg = hasStashPopConflict ? `${mode} continued ${yellow("(stash pop failed)")}` : `${mode} continued`;
        inlineResult(c.repo, doneMsg);
        succeeded++;
      } else {
        const existing = record.repos[c.repo];
        if (existing) {
          const errorOutput = result.stderr.trim().slice(0, 4000) || undefined;
          record.repos[c.repo] = { ...existing, errorOutput };
        }
        inlineResult(c.repo, yellow("conflict"));
        newConflicts.push({ repo: c.repo, stdout: result.stdout, stderr: result.stderr });
      }
    }
  });

  // Step 9: Show conflict details for failures (B2 fix)
  if (newConflicts.length > 0) {
    const conflictNodes = buildConflictReport(
      newConflicts.map((c) => ({ repo: c.repo, stdout: c.stdout, stderr: c.stderr, mode })),
    );
    if (conflictNodes.length > 0) {
      process.stderr.write(render(conflictNodes, rCtx));
    }
  } else if (stillConflicting.length > 0) {
    info(`Fix conflicts, then: arb ${mode} --continue`);
  }

  // Step 9a: Show stash pop failure report
  const stashNodes = buildStashPopFailureReport(stashPopFailed, capitalize(mode));
  if (stashNodes.length > 0) process.stderr.write(render(stashNodes, rCtx));

  // Step 10: Finalize
  const allCompleted = Object.values(record.repos).every((s) => s.status === "completed" || s.status === "skipped");

  if (allCompleted) {
    if (onComplete) await onComplete(record);
    record.status = "completed";
    record.completedAt = new Date().toISOString();
    writeOperationRecord(wsDir, record);
  } else {
    writeOperationRecord(wsDir, record);
  }

  // Step 11: Summary
  process.stderr.write("\n");
  const parts: string[] = [];
  if (succeeded > 0) parts.push(`Continued ${plural(succeeded, "repo")}`);
  if (stillConflicting.length > 0) parts.push(`${stillConflicting.length} still conflicting`);
  if (newConflicts.length > 0) parts.push(`${newConflicts.length} new conflict`);
  if (stashPopFailed.length > 0) parts.push(`${stashPopFailed.length} stash pop failed`);
  finishSummary(parts, stillConflicting.length > 0 || newConflicts.length > 0 || stashPopFailed.length > 0);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
