import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { ArbError, arbAction, readWorkspaceConfig, writeWorkspaceConfig } from "../lib/core";
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

type AbortOutcome = "roll-back" | "already-reverted" | "skip-unknown";

interface AbortAssessment {
  repo: string;
  repoDir: string;
  outcome: AbortOutcome;
  currentBranch: string | null;
}

interface RenameOptions {
  continue?: boolean;
  abort?: boolean;
  deleteRemote?: boolean;
  fetch?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  includeInProgress?: boolean;
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
  out += "\n";
  return out;
}

export function formatAbortPlan(assessments: AbortAssessment[], oldBranch: string, newBranch: string): string {
  const nodes: OutputNode[] = [
    { kind: "gap" },
    { kind: "message", level: "default", text: `Rolling back rename: '${newBranch}' to '${oldBranch}'` },
    { kind: "gap" },
    {
      kind: "table",
      columns: [
        { header: "REPO", key: "repo" },
        { header: "LOCAL", key: "local" },
      ],
      rows: assessments.map((a) => {
        let localCell: Cell;
        switch (a.outcome) {
          case "roll-back":
            localCell = cell(`rename ${newBranch} to ${oldBranch}`);
            break;
          case "already-reverted":
            localCell = cell(`already on ${oldBranch}`, "muted");
            break;
          case "skip-unknown":
            localCell = cell(`skip — on branch ${a.currentBranch ?? "?"}, expected ${newBranch}`, "attention");
            break;
          default:
            localCell = cell("unknown");
        }
        return { cells: { repo: cell(a.repo), local: localCell } };
      }),
    },
  ];

  const rCtx: RenderContext = { tty: shouldColor() };
  return `${render(nodes, rCtx)}\n`;
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
    info("Nothing to rename");
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

  // Pre-update config: write new branch + migration state BEFORE git ops
  // This means arb status immediately reflects intent; branch_rename_from preserves recovery info
  writeWorkspaceConfig(configFile, {
    branch: newBranch,
    ...(configBase && { base: configBase }),
    branch_rename_from: oldBranch,
  });

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
      inlineResult(a.repo, `local branch renamed to ${newBranch}`);
      renameOk++;
    } else {
      inlineResult(a.repo, red("failed"));
      failures.push(a.repo);
    }
  }

  if (failures.length > 0) {
    process.stderr.write("\n");
    error(`Failed to rename in ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
    warn("Use 'arb branch rename --continue' or 'arb rename --continue' to retry, or '--abort' to roll back");
    throw new ArbError(`Failed to rename in ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
  }

  // Clear stale tracking for repos already on the new branch (e.g. --continue after partial)
  for (const a of assessments.filter((a) => a.outcome === "already-on-new")) {
    const mergeRef = await gitLocal(a.repoDir, "config", `branch.${newBranch}.merge`);
    if (mergeRef.exitCode === 0 && mergeRef.stdout.trim() === `refs/heads/${oldBranch}`) {
      await gitLocal(a.repoDir, "config", "--unset", `branch.${newBranch}.remote`);
      await gitLocal(a.repoDir, "config", "--unset", `branch.${newBranch}.merge`);
    }
  }

  // All local renames succeeded — clear migration state
  writeWorkspaceConfig(configFile, { branch: newBranch, ...(configBase && { base: configBase }) });

  // Remote cleanup — only runs after all local renames succeed so --abort never needs to touch remotes
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

export async function runAbort(
  wsDir: string,
  configFile: string,
  currentConfigBranch: string,
  branchRenameFrom: string | null,
  configBase: string | null,
  options: RenameOptions,
): Promise<void> {
  if (!branchRenameFrom) {
    error("No rename in progress. Nothing to abort.");
    throw new ArbError("No rename in progress. Nothing to abort.");
  }

  const oldBranch = branchRenameFrom;
  const newBranch = currentConfigBranch;

  const repoDirs = workspaceRepoDirs(wsDir);

  // Assess: classify each repo for rollback
  const assessments: AbortAssessment[] = await Promise.all(
    repoDirs.map(async (repoDir): Promise<AbortAssessment> => {
      const repo = basename(repoDir);
      const headResult = await gitLocal(repoDir, "symbolic-ref", "--short", "HEAD");
      const currentBranch = headResult.exitCode === 0 ? headResult.stdout.trim() || null : null;

      if (currentBranch === newBranch) {
        return { repo, repoDir, outcome: "roll-back", currentBranch };
      }
      if (currentBranch === oldBranch) {
        return { repo, repoDir, outcome: "already-reverted", currentBranch };
      }
      return { repo, repoDir, outcome: "skip-unknown", currentBranch };
    }),
  );

  process.stderr.write(formatAbortPlan(assessments, oldBranch, newBranch));

  const toRollBack = assessments.filter((a) => a.outcome === "roll-back");
  const skipUnknown = assessments.filter((a) => a.outcome === "skip-unknown");

  if (toRollBack.length === 0) {
    // Already fully reverted — just clean up config
    writeWorkspaceConfig(configFile, { branch: oldBranch, ...(configBase && { base: configBase }) });
    info("Rename aborted — all repos already reverted");
    if (skipUnknown.length > 0) {
      warn(`${plural(skipUnknown.length, "repo")} on unexpected branch left unchanged`);
    }
    return;
  }

  if (options.dryRun) {
    dryRunNotice();
    return;
  }

  await confirmOrExit({
    yes: options.yes,
    message: `Roll back branch rename in ${plural(toRollBack.length, "repo")}?`,
  });

  process.stderr.write("\n");

  // Execute rollback
  let rollbackOk = 0;
  const failures: string[] = [];
  for (const a of toRollBack) {
    inlineStart(a.repo, "reverting");
    const result = await gitLocal(a.repoDir, "branch", "-m", newBranch, oldBranch);
    if (result.exitCode === 0) {
      inlineResult(a.repo, `reverted to ${oldBranch}`);
      rollbackOk++;
    } else {
      inlineResult(a.repo, red("failed"));
      failures.push(a.repo);
    }
  }

  process.stderr.write("\n");

  if (failures.length > 0) {
    // Leave migration state intact so --abort can be retried
    error(`Failed to revert ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
    warn("Migration state preserved — retry with 'arb branch rename --abort'");
    throw new ArbError(`Failed to revert ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
  }

  // All rollbacks succeeded — restore config
  writeWorkspaceConfig(configFile, { branch: oldBranch, ...(configBase && { base: configBase }) });

  info(`Rename aborted — reverted ${plural(rollbackOk, "repo")}`);
  info("Remote branches were not modified — no remote cleanup needed");

  if (skipUnknown.length > 0) {
    warn(`${plural(skipUnknown.length, "repo")} on unexpected branch left unchanged`);
  }
}

export function registerBranchRenameSubcommand(parent: Command): void {
  parent
    .command("rename [new-name]")
    .option("--continue", "Resume an in-progress rename")
    .option("--abort", "Roll back an in-progress rename")
    .option("-r, --delete-remote", "Delete old branch on remote after rename")
    .option("--fetch", "Fetch from all remotes before rename (default)")
    .option("-N, --no-fetch", "Skip fetching before rename")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--include-in-progress", "Rename repos even if they have an in-progress git operation")
    .summary("Rename the workspace branch across all repos")
    .description(
      "Examples:\n\n  arb branch rename feat/PROJ-209          Rename across all repos\n  arb branch rename feat/PROJ-209 --delete-remote\n  arb branch rename --continue             Resume after partial failure\n\nRenames the workspace branch locally across all repos and updates .arbws/config.json. The workspace directory is not renamed — use 'arb rename' to rename both the workspace and branch together.\n\nFetches before assessing to get fresh remote state (use -N/--no-fetch to skip). Shows a plan and asks for confirmation before proceeding. Repos with an in-progress git operation (rebase, merge, cherry-pick) are skipped by default — use --include-in-progress to override.\n\nBranch rename is non-atomic across repos: if it fails partway, migration state is preserved in .arbws/config.json so the operation can be resumed. Use --continue to retry remaining repos or --abort to roll back. After rename, tracking is cleared so 'arb push' treats the branch as new and pushes under the new name. Use --delete-remote to also delete the old remote branch during rename.",
    )
    .action(
      arbAction(async (ctx, newNameArg: string | undefined, options: RenameOptions) => {
        const { wsDir, workspace } = requireWorkspace(ctx);

        const configFile = `${wsDir}/.arbws/config.json`;
        const wsConfig = readWorkspaceConfig(configFile);
        const currentConfigBranch = wsConfig?.branch ?? null;
        const branchRenameFrom = wsConfig?.branch_rename_from ?? null;
        const configBase = wsConfig?.base ?? null;

        if (!currentConfigBranch) {
          const msg = `No branch configured for workspace '${workspace}'. Cannot rename.`;
          error(msg);
          throw new ArbError(msg);
        }

        if (options.abort) {
          return runAbort(wsDir, configFile, currentConfigBranch, branchRenameFrom, configBase, options);
        }

        let oldBranch: string;
        let newBranch: string;

        if (options.continue) {
          if (!branchRenameFrom) {
            error("No rename in progress. Nothing to continue.");
            throw new ArbError("No rename in progress. Nothing to continue.");
          }
          oldBranch = branchRenameFrom;
          newBranch = currentConfigBranch;
        } else {
          if (!newNameArg) {
            error("New branch name required. Usage: arb branch rename <new-name>");
            throw new ArbError("New branch name required. Usage: arb branch rename <new-name>");
          }

          if (!validateBranchName(newNameArg)) {
            error(`Invalid branch name: '${newNameArg}'`);
            throw new ArbError(`Invalid branch name: '${newNameArg}'`);
          }

          if (branchRenameFrom !== null) {
            // Migration already in progress
            if (currentConfigBranch === newNameArg) {
              // Same target — treat as resume
              oldBranch = branchRenameFrom;
              newBranch = currentConfigBranch;
            } else {
              const msg = `A rename to '${currentConfigBranch}' is already in progress — use 'arb branch rename --continue' or 'arb branch rename --abort'`;
              error(msg);
              throw new ArbError(msg);
            }
          } else {
            // Fresh run
            oldBranch = currentConfigBranch;
            newBranch = newNameArg;

            if (oldBranch === newBranch) {
              info(`Already on branch '${newBranch}' — nothing to do`);
              return;
            }
          }
        }

        // Show hint when workspace could be renamed via arb rename
        const showRenameWorkspaceHint =
          !options.continue &&
          !options.abort &&
          workspace === oldBranch &&
          validateWorkspaceName(newBranch) === null &&
          !existsSync(`${ctx.arbRootDir}/${newBranch}`);

        return runRename(wsDir, ctx, configFile, oldBranch, newBranch, configBase, showRenameWorkspaceHint, options);
      }),
    );
}
