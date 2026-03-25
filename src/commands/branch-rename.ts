import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import {
  ArbError,
  type OperationRecord,
  type RepoOperationState,
  arbAction,
  assertNoInProgressOperation,
  deleteOperationRecord,
  readInProgressOperation,
  readWorkspaceConfig,
  writeOperationRecord,
  writeWorkspaceConfig,
} from "../lib/core";
import type { ArbContext } from "../lib/core";
import {
  GitCache,
  branchExistsLocally,
  detectOperation,
  gitLocal,
  gitNetwork,
  networkTimeout,
  remoteBranchExists,
  renameBranch,
  validateBranchName,
} from "../lib/git";
import { type RenderContext, finishSummary, render } from "../lib/render";
import type { Cell, OutputNode } from "../lib/render";
import { EMPTY_CELL, cell, suffix } from "../lib/render";
import { confirmOrExit, resolveDefaultFetch, runPlanFlow } from "../lib/sync";
import {
  dryRunNotice,
  error,
  info,
  inlineResult,
  inlineStart,
  plural,
  red,
  shouldColor,
  success,
  warn,
  yellow,
} from "../lib/terminal";
import { requireWorkspace, validateWorkspaceName, workspaceRepoDirs } from "../lib/workspace";

export type RenameOutcome =
  | "will-rename"
  | "already-on-new"
  | "skip-missing"
  | "skip-wrong-branch"
  | "skip-in-progress";

export interface RepoAssessment {
  repo: string;
  repoDir: string;
  outcome: RenameOutcome;
  currentBranch: string | null;
  operationType: string | null;
  oldRemoteExists: boolean;
  newRemoteExists: boolean;
  shareRemote: string | null;
}

interface RenameOptions {
  deleteRemote?: boolean;
  fetch?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  includeInProgress?: boolean;
  continue?: boolean;
  abort?: boolean;
}

export async function assessRepo(
  repoDir: string,
  oldBranch: string,
  newBranch: string,
  shareRemote: string | null,
  options: { includeInProgress: boolean },
): Promise<RepoAssessment> {
  const repo = basename(repoDir);

  // Check in-progress git operation first
  const op = await detectOperation(repoDir);
  if (op !== null && !options.includeInProgress) {
    return {
      repo,
      repoDir,
      outcome: "skip-in-progress",
      currentBranch: null,
      operationType: op,
      oldRemoteExists: false,
      newRemoteExists: false,
      shareRemote,
    };
  }

  // Get current HEAD branch
  const headResult = await gitLocal(repoDir, "symbolic-ref", "--short", "HEAD");
  const currentBranch = headResult.exitCode === 0 ? headResult.stdout.trim() || null : null;

  // Check if already on new branch
  if (currentBranch === newBranch) {
    const [oldRemoteExists, newRemoteExists] = shareRemote
      ? await Promise.all([
          remoteBranchExists(repoDir, oldBranch, shareRemote),
          remoteBranchExists(repoDir, newBranch, shareRemote),
        ])
      : [false, false];
    return {
      repo,
      repoDir,
      outcome: "already-on-new",
      currentBranch,
      operationType: op,
      oldRemoteExists,
      newRemoteExists,
      shareRemote,
    };
  }

  // Check if old branch exists locally (covers both "on old branch" and "old branch exists but HEAD elsewhere")
  const oldExists = await branchExistsLocally(repoDir, oldBranch);
  const [oldRemoteExists, newRemoteExists] = shareRemote
    ? await Promise.all([
        remoteBranchExists(repoDir, oldBranch, shareRemote),
        remoteBranchExists(repoDir, newBranch, shareRemote),
      ])
    : [false, false];

  if (oldExists) {
    return {
      repo,
      repoDir,
      outcome: "will-rename",
      currentBranch,
      operationType: op,
      oldRemoteExists,
      newRemoteExists,
      shareRemote,
    };
  }

  // Old branch doesn't exist — HEAD is not on new branch either
  // If HEAD is on some other unexpected branch, it's on the wrong branch
  if (currentBranch && currentBranch !== oldBranch) {
    return {
      repo,
      repoDir,
      outcome: "skip-wrong-branch",
      currentBranch,
      operationType: op,
      oldRemoteExists,
      newRemoteExists,
      shareRemote,
    };
  }

  return {
    repo,
    repoDir,
    outcome: "skip-missing",
    currentBranch,
    operationType: op,
    oldRemoteExists,
    newRemoteExists,
    shareRemote,
  };
}

export function buildRenamePlanNodes(
  assessments: RepoAssessment[],
  oldBranch: string,
  newBranch: string,
  deleteRemote: boolean,
  newWorkspaceName: string | null,
  showRenameWorkspaceHint?: boolean,
): OutputNode[] {
  const nodes: OutputNode[] = [];

  // Leading text
  nodes.push({ kind: "gap" });
  nodes.push({ kind: "message", level: "default", text: `Renaming branch '${oldBranch}' to '${newBranch}'` });
  if (newWorkspaceName) {
    nodes.push({
      kind: "hint",
      cell: cell(`  Renaming workspace to '${newWorkspaceName}'`),
    });
  } else if (showRenameWorkspaceHint) {
    nodes.push({
      kind: "hint",
      cell: suffix(
        cell("  Workspace directory keeps its current name "),
        "(use arb rename to also rename the workspace directory)",
        "muted",
      ),
    });
  }
  nodes.push({ kind: "gap" });

  // Table
  const rows = assessments.map((a) => {
    let localCell: Cell;
    let remoteCell: Cell;

    switch (a.outcome) {
      case "will-rename": {
        localCell = cell(`rename ${oldBranch} to ${newBranch}`);
        if (a.shareRemote) {
          if (a.newRemoteExists) {
            remoteCell = cell(`${a.shareRemote}/${newBranch} already exists (may conflict)`, "attention");
          } else if (a.oldRemoteExists && deleteRemote) {
            remoteCell = cell(`delete ${a.shareRemote}/${oldBranch}`);
          } else if (a.oldRemoteExists) {
            remoteCell = suffix(
              cell(`leave ${a.shareRemote}/${oldBranch} in place `),
              "(add --delete-remote to delete)",
              "muted",
            );
          } else {
            remoteCell = cell("no remote branch");
          }
        } else {
          remoteCell = EMPTY_CELL;
        }
        break;
      }
      case "already-on-new":
        localCell = cell("already renamed", "attention");
        remoteCell = a.shareRemote ? cell("no remote branch") : EMPTY_CELL;
        break;
      case "skip-missing":
        localCell = cell("skip — branch not found", "attention");
        remoteCell = a.shareRemote ? cell("no remote branch") : EMPTY_CELL;
        break;
      case "skip-wrong-branch":
        localCell = cell(`skip — on branch ${a.currentBranch ?? "?"}, expected ${oldBranch}`, "attention");
        remoteCell = a.shareRemote ? cell("no remote branch") : EMPTY_CELL;
        break;
      case "skip-in-progress":
        localCell = cell(`skip — ${a.operationType} in progress (use --include-in-progress)`, "attention");
        remoteCell = a.shareRemote ? cell("no remote branch") : EMPTY_CELL;
        break;
      default:
        localCell = cell("unknown");
        remoteCell = a.shareRemote ? cell("no remote branch") : EMPTY_CELL;
    }

    return {
      cells: {
        repo: cell(a.repo),
        local: localCell,
        remote: remoteCell,
      },
    };
  });

  nodes.push({
    kind: "table",
    columns: [
      { header: "REPO", key: "repo" },
      { header: "LOCAL", key: "local" },
      { header: "REMOTE", key: "remote", show: "auto" },
    ],
    rows,
  });

  nodes.push({ kind: "gap" });
  return nodes;
}

function formatPlan(
  assessments: RepoAssessment[],
  oldBranch: string,
  newBranch: string,
  deleteRemote: boolean,
  newWorkspaceName: string | null,
  fetchingNotice?: string,
  showRenameWorkspaceHint?: boolean,
): string {
  const nodes = buildRenamePlanNodes(
    assessments,
    oldBranch,
    newBranch,
    deleteRemote,
    newWorkspaceName,
    showRenameWorkspaceHint,
  );
  const rCtx: RenderContext = { tty: shouldColor() };
  let out = render(nodes, rCtx);
  if (fetchingNotice) {
    out += fetchingNotice;
  }
  return out;
}

async function runRename(
  wsDir: string,
  ctx: ArbContext,
  configFile: string,
  oldBranch: string,
  newBranch: string,
  configBase: string | null,
  showRenameWorkspaceHint: boolean,
  options: RenameOptions,
  existingRecord: OperationRecord | null,
): Promise<void> {
  const repoDirs = workspaceRepoDirs(wsDir);
  const repos = repoDirs.map((d) => basename(d));

  if (repoDirs.length === 0) {
    // No attached repos — just update config (e.g. after workspace copy removed .git files)
    if (options.dryRun) {
      info(`No repos attached — would update workspace branch to '${newBranch}'`);
      dryRunNotice();
      return;
    }
    writeWorkspaceConfig(configFile, {
      branch: newBranch,
      ...(configBase && { base: configBase }),
    });
    if (existingRecord) deleteOperationRecord(wsDir);
    success(`Workspace branch set to '${newBranch}' (no repos to rename)`);
    info("Run 'arb attach' to attach repos on the new branch");
    return;
  }

  // Resolve remotes for all repos (canonical repos share remote config with worktrees)
  const cache = await GitCache.create();

  const fullRemotesMap = await cache.resolveRemotesMap(repos, ctx.reposDir);

  const fetchDirs = workspaceRepoDirs(wsDir);

  const shouldFetch = resolveDefaultFetch(options.fetch);

  const assess = async (_fetchFailed: string[], _unchangedRepos: Set<string>): Promise<RepoAssessment[]> => {
    return Promise.all(
      repoDirs.map((repoDir) => {
        const repo = basename(repoDir);
        const shareRemote = fullRemotesMap.get(repo)?.share ?? null;
        return assessRepo(repoDir, oldBranch, newBranch, shareRemote, {
          includeInProgress: options.includeInProgress ?? false,
        });
      }),
    );
  };

  const assessments = await runPlanFlow({
    shouldFetch,
    fetchDirs,
    reposForFetchReport: repos,
    remotesMap: fullRemotesMap,
    assess,
    formatPlan: (nextAssessments) =>
      formatPlan(
        nextAssessments,
        oldBranch,
        newBranch,
        options.deleteRemote ?? false,
        null,
        undefined,
        showRenameWorkspaceHint,
      ),
    onPostFetch: () => cache.invalidateAfterFetch(),
  });

  const willRename = assessments.filter((a) => a.outcome === "will-rename");

  if (willRename.length === 0) {
    // If continuing and all repos are already renamed, finalize the operation
    if (existingRecord) {
      writeWorkspaceConfig(configFile, { branch: newBranch, ...(configBase && { base: configBase }) });
      deleteOperationRecord(wsDir);
      info("All repos already renamed");
    } else {
      info("Nothing to rename");
    }
    return;
  }

  if (options.dryRun) {
    dryRunNotice();
    return;
  }

  // Confirm
  await confirmOrExit({
    yes: options.yes,
    message: `Rename branch in ${plural(willRename.length, "repo")}?`,
  });

  process.stderr.write("\n");

  // Capture state and write operation record
  const configBefore = readWorkspaceConfig(configFile) ?? { branch: oldBranch };
  const configAfter = { branch: newBranch, ...(configBase && { base: configBase }) };

  // Build repos map: preserve completed entries from existing record, add new will-rename repos
  const repoStates: Record<string, RepoOperationState> = {};
  if (existingRecord) {
    for (const [name, state] of Object.entries(existingRecord.repos)) {
      if (state.status === "completed") {
        repoStates[name] = state;
      }
    }
  }
  for (const a of willRename) {
    const headResult = await gitLocal(a.repoDir, "rev-parse", "HEAD");
    const preHead = headResult.stdout.trim();
    if (!preHead) throw new ArbError(`Cannot capture HEAD for ${a.repo}`);
    // Capture tracking config before rename so undo can restore it
    const remoteResult = await gitLocal(a.repoDir, "config", `branch.${oldBranch}.remote`);
    const mergeResult = await gitLocal(a.repoDir, "config", `branch.${oldBranch}.merge`);
    const tracking =
      remoteResult.exitCode === 0 || mergeResult.exitCode === 0
        ? {
            ...(remoteResult.exitCode === 0 && { remote: remoteResult.stdout.trim() }),
            ...(mergeResult.exitCode === 0 && { merge: mergeResult.stdout.trim() }),
          }
        : undefined;
    repoStates[a.repo] = { preHead, status: "pending", tracking };
  }

  const record: OperationRecord = {
    command: "branch-rename",
    startedAt: existingRecord?.startedAt ?? new Date().toISOString(),
    status: "in-progress",
    repos: repoStates,
    oldBranch,
    newBranch,
    configBefore,
    configAfter,
  };
  writeOperationRecord(wsDir, record);

  // Execute local renames sequentially
  let renameOk = 0;
  const failures: string[] = [];

  for (const a of willRename) {
    inlineStart(a.repo, "renaming");
    const result = await renameBranch(a.repoDir, oldBranch, newBranch);
    if (result.exitCode === 0) {
      // Clear stale tracking left by git branch -m.
      // Without this, @{upstream} resolves to origin/<oldBranch> and
      // arb push reports "up to date" instead of pushing the new name.
      await gitLocal(a.repoDir, "config", "--unset", `branch.${newBranch}.remote`);
      await gitLocal(a.repoDir, "config", "--unset", `branch.${newBranch}.merge`);

      const postHeadResult = await gitLocal(a.repoDir, "rev-parse", "HEAD");
      const existing = record.repos[a.repo];
      if (existing) {
        record.repos[a.repo] = { ...existing, status: "completed", postHead: postHeadResult.stdout.trim() };
      }
      writeOperationRecord(wsDir, record);

      inlineResult(a.repo, `local branch renamed to ${newBranch}`);
      renameOk++;
    } else {
      const existing = record.repos[a.repo];
      if (existing) {
        record.repos[a.repo] = { ...existing, status: "conflicting" };
      }
      writeOperationRecord(wsDir, record);

      inlineResult(a.repo, red("failed"));
      failures.push(a.repo);
    }
  }

  if (failures.length > 0) {
    process.stderr.write("\n");
    error(`Failed to rename in ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
    warn("Run 'arb branch rename' to retry or 'arb undo' to roll back");
    throw new ArbError(`Failed to rename in ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
  }

  // Clear stale tracking for repos already on the new branch (e.g. continue after partial)
  for (const a of assessments.filter((a) => a.outcome === "already-on-new")) {
    const mergeRef = await gitLocal(a.repoDir, "config", `branch.${newBranch}.merge`);
    if (mergeRef.exitCode === 0 && mergeRef.stdout.trim() === `refs/heads/${oldBranch}`) {
      await gitLocal(a.repoDir, "config", "--unset", `branch.${newBranch}.remote`);
      await gitLocal(a.repoDir, "config", "--unset", `branch.${newBranch}.merge`);
    }
  }

  // All local renames succeeded — apply deferred config and mark completed
  writeWorkspaceConfig(configFile, configAfter);
  record.status = "completed";
  writeOperationRecord(wsDir, record);

  // Remote cleanup — only runs after all local renames succeed
  if (options.deleteRemote) {
    const withOldRemote = willRename.filter((a) => a.oldRemoteExists && a.shareRemote !== null);
    if (withOldRemote.length > 0) {
      for (const a of withOldRemote) {
        inlineStart(a.repo, `deleting ${a.shareRemote}/${oldBranch}`);
        // Use canonical repo dir for remote operations
        const canonicalDir = `${ctx.reposDir}/${a.repo}`;
        const pushTimeout = networkTimeout("ARB_PUSH_TIMEOUT", 120);
        // biome-ignore lint/style/noNonNullAssertion: filtered above
        const result = await gitNetwork(canonicalDir, pushTimeout, ["push", a.shareRemote!, "--delete", oldBranch]);
        if (result.exitCode === 0) {
          inlineResult(a.repo, `deleted remote branch ${a.shareRemote}/${oldBranch}`);
        } else {
          inlineResult(a.repo, yellow(`failed to delete remote branch ${a.shareRemote}/${oldBranch}`));
        }
      }
    }
  }

  process.stderr.write("\n");

  // Summarize
  const parts = [`Renamed ${plural(renameOk, "repo")}`];
  const alreadyRenamed = assessments.filter((a) => a.outcome === "already-on-new").length;
  if (alreadyRenamed > 0) parts.push(`${alreadyRenamed} already renamed`);
  const skipped = assessments.filter((a) => a.outcome !== "will-rename" && a.outcome !== "already-on-new").length;
  if (skipped > 0) parts.push(`${skipped} skipped`);
  finishSummary(parts, false);

  // Guide user toward arb push when remote branches were involved
  const hasAnyRemote = assessments.some((a) => a.shareRemote !== null);
  if (hasAnyRemote) {
    info("Run 'arb push' to push the new branch name to the remote");
  }
}

// ── Command registration ──

export function registerBranchRenameSubcommand(parent: Command): void {
  parent
    .command("rename [new-name]")
    .option("-r, --delete-remote", "Delete old branch on remote after rename")
    .option("--fetch", "Fetch from all remotes before rename (default)")
    .option("-N, --no-fetch", "Skip fetching before rename")
    .option("--dry-run", "Show what would happen without executing")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--include-in-progress", "Rename repos even if they have an in-progress git operation")
    .option("--continue", "Resume a partial branch rename")
    .option("--abort", "Cancel the in-progress branch rename and restore pre-rename state")
    .summary("Rename the workspace branch across all repos")
    .description(
      "Examples:\n\n  arb branch rename feat/PROJ-209          Rename across all repos\n  arb branch rename feat/PROJ-209 --delete-remote\n  arb branch rename                        Resume after partial failure\n\nRenames the workspace branch locally across all repos and updates .arbws/config.json. The workspace directory is not renamed — use 'arb rename' to rename both the workspace and branch together.\n\nFetches before assessing to get fresh remote state (use -N/--no-fetch to skip). Shows a plan and asks for confirmation before proceeding. Repos with an in-progress git operation (rebase, merge, cherry-pick) are skipped by default — use --include-in-progress to override.\n\nBranch rename is tracked as an operation in .arbws/operation.json. If it fails partway, re-run 'arb branch rename' to retry remaining repos, or 'arb undo' to roll back. After rename, tracking is cleared so 'arb push' treats the branch as new and pushes under the new name. Use --delete-remote to also delete the old remote branch during rename.",
    )
    .action(
      arbAction(async (ctx, newNameArg: string | undefined, options: RenameOptions) => {
        const { wsDir, workspace } = requireWorkspace(ctx);

        // Operation lifecycle: --continue, --abort, gate
        const inProgress = readInProgressOperation(wsDir, "branch-rename") as
          | (OperationRecord & { command: "branch-rename" })
          | null;

        if (options.abort) {
          if (!inProgress) {
            error("No branch rename in progress. Nothing to abort.");
            throw new ArbError("No branch rename in progress. Nothing to abort.");
          }
          const { runUndoFlow } = await import("../lib/sync/undo-flow");
          await runUndoFlow({
            wsDir,
            arbRootDir: ctx.arbRootDir,
            reposDir: ctx.reposDir,
            options,
            verb: "abort",
          });
          return;
        }

        if (options.continue) {
          if (!inProgress) {
            error("No branch rename in progress. Nothing to continue.");
            throw new ArbError("No branch rename in progress. Nothing to continue.");
          }
          const configFile = `${wsDir}/.arbws/config.json`;
          const configBase = readWorkspaceConfig(configFile)?.base ?? null;
          return runRename(
            wsDir,
            ctx,
            configFile,
            inProgress.oldBranch,
            inProgress.newBranch,
            configBase,
            false,
            options,
            inProgress,
          );
        }

        assertNoInProgressOperation(wsDir);

        const configFile = `${wsDir}/.arbws/config.json`;
        const wsConfig = readWorkspaceConfig(configFile);
        const currentConfigBranch = wsConfig?.branch ?? null;
        const configBase = wsConfig?.base ?? null;

        if (!currentConfigBranch) {
          const msg = `No branch configured for workspace '${workspace}'. Cannot rename.`;
          error(msg);
          throw new ArbError(msg);
        }

        if (!newNameArg) {
          error("New branch name required. Usage: arb branch rename <new-name>");
          throw new ArbError("New branch name required. Usage: arb branch rename <new-name>");
        }

        if (!validateBranchName(newNameArg)) {
          error(`Invalid branch name: '${newNameArg}'`);
          throw new ArbError(`Invalid branch name: '${newNameArg}'`);
        }

        const oldBranch = currentConfigBranch;
        const newBranch = newNameArg;

        if (oldBranch === newBranch) {
          info(`Already on branch '${newBranch}' — nothing to do`);
          return;
        }

        // Show hint when workspace could be renamed via arb rename
        const showRenameWorkspaceHint =
          workspace === oldBranch &&
          validateWorkspaceName(newBranch) === null &&
          !existsSync(`${ctx.arbRootDir}/${newBranch}`);

        return runRename(
          wsDir,
          ctx,
          configFile,
          oldBranch,
          newBranch,
          configBase,
          showRenameWorkspaceHint,
          options,
          null,
        );
      }),
    );
}
