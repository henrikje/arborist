import { existsSync, realpathSync, renameSync } from "node:fs";
import { basename } from "node:path";
import { type Command, Option } from "commander";
import {
  ArbError,
  type OperationRecord,
  type RepoOperationState,
  arbAction,
  assertNoInProgressOperation,
  captureRepoState,
  readInProgressOperation,
  readWorkspaceConfig,
  withReflogAction,
  writeOperationRecord,
  writeWorkspaceConfig,
} from "../lib/core";
import type { ArbContext } from "../lib/core";
import { GitCache, branchNameError, gitLocal, gitNetwork, networkTimeout, renameBranch } from "../lib/git";
import { type RenderContext, finishSummary, render } from "../lib/render";
import type { OutputNode } from "../lib/render";
import { cell } from "../lib/render";
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
  warn,
  yellow,
} from "../lib/terminal";
import { requireWorkspace, validateWorkspaceName, workspaceRepoDirs } from "../lib/workspace";
import { type RepoAssessment, assessRepo, buildRenamePlanNodes } from "./branch-rename";
import { deriveWorkspaceNameFromBranch } from "./create";

interface RenameCommandOptions {
  branch?: string;
  base?: string;
  continue?: boolean;
  abort?: boolean;
  deleteRemote?: boolean;
  fetch?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  includeInProgress?: boolean;
}

function formatRenamePlan(
  assessments: RepoAssessment[],
  oldBranch: string,
  newBranch: string,
  deleteRemote: boolean,
  newWorkspaceName: string,
  workspace: string,
  newBase?: string,
  fetchingNotice?: string,
): string {
  const nodes: OutputNode[] = [];
  nodes.push({ kind: "gap" });
  nodes.push({
    kind: "message",
    level: "default",
    text: `Renaming workspace '${workspace}' to '${newWorkspaceName}'`,
  });
  if (newBase) {
    nodes.push({
      kind: "hint",
      cell: cell(`  Base: ${newBase}`),
    });
  }
  nodes.push({ kind: "gap" });

  if (assessments.length > 0) {
    const planNodes = buildRenamePlanNodes(assessments, oldBranch, newBranch, deleteRemote, null);
    // Extract the table node (skip the leading gap + header message that buildRenamePlanNodes adds)
    const tableNode = planNodes.find((n) => n.kind === "table");
    if (tableNode) {
      nodes.push(tableNode);
    }
  }

  const rCtx: RenderContext = { tty: shouldColor() };
  let out = render(nodes, rCtx);
  if (fetchingNotice) {
    out += fetchingNotice;
  }
  out += "\n";
  return out;
}

function renameWorkspaceDir(
  ctx: ArbContext,
  wsDir: string,
  workspace: string,
  newWorkspaceName: string,
  repos: string[],
): boolean {
  const newWsDir = `${ctx.arbRootDir}/${newWorkspaceName}`;
  try {
    renameSync(wsDir, newWsDir);
  } catch (err) {
    warn(`Failed to rename workspace directory: ${err instanceof Error ? err.message : err}`);
    info(`  Manually rename: mv '${workspace}' '${newWorkspaceName}'`);
    info("  Then repair worktrees: arb exec -- git worktree repair");
    return false;
  }

  // Fix worktree path references in canonical repos
  let repairFailed = false;
  for (const repo of repos) {
    const result = Bun.spawnSync(["git", "worktree", "repair", `${newWsDir}/${repo}`], {
      cwd: `${ctx.reposDir}/${repo}`,
      stdout: "ignore",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      repairFailed = true;
    }
  }

  if (repairFailed) {
    warn("Some worktree repairs failed — run 'arb exec -- git worktree repair' in the new workspace");
  }

  return true;
}

async function runWorkspaceRename(
  wsDir: string,
  ctx: ArbContext,
  workspace: string,
  configFile: string,
  oldBranch: string,
  newBranch: string,
  newWorkspaceName: string,
  configBase: string | null,
  newBase: string | undefined,
  options: RenameCommandOptions,
  _existingRecord: OperationRecord | null,
): Promise<void> {
  const repoDirs = workspaceRepoDirs(wsDir);
  const repos = repoDirs.map((d) => basename(d));
  const effectiveBase = newBase ?? configBase;

  // Zero-repos case: just rename workspace + update config
  if (repoDirs.length === 0) {
    if (oldBranch !== newBranch) {
      writeWorkspaceConfig(configFile, { branch: newBranch, ...(effectiveBase && { base: effectiveBase }) });
    }
    if (workspace !== newWorkspaceName) {
      if (!options.dryRun) {
        renameWorkspaceDir(ctx, wsDir, workspace, newWorkspaceName, repos);
        const newConfigFile = `${ctx.arbRootDir}/${newWorkspaceName}/.arbws/config.json`;
        if (oldBranch === newBranch && effectiveBase !== configBase) {
          writeWorkspaceConfig(newConfigFile, { branch: newBranch, ...(effectiveBase && { base: effectiveBase }) });
        }
      }
    } else if (effectiveBase !== configBase) {
      writeWorkspaceConfig(configFile, { branch: newBranch, ...(effectiveBase && { base: effectiveBase }) });
    }
    if (options.dryRun) {
      info("No repos in this workspace");
      dryRunNotice();
      return;
    }
    const parts: string[] = [];
    if (workspace !== newWorkspaceName) parts.push("workspace renamed");
    if (oldBranch !== newBranch) parts.push("branch updated in config");
    if (effectiveBase !== configBase) parts.push(`base set to ${effectiveBase}`);
    finishSummary(parts.length > 0 ? parts : ["no changes"], false);
    if (workspace !== newWorkspaceName) {
      process.stdout.write(`${ctx.arbRootDir}/${newWorkspaceName}\n`);
    }
    return;
  }

  // Repos case: assess → plan → confirm → rename branches → rename workspace
  const cache = await GitCache.create();

  // Workspace directory rename requires worktree repair (git 2.30+)
  if (workspace !== newWorkspaceName) {
    const version = await cache.getGitVersion();
    if (version.major < 2 || (version.major === 2 && version.minor < 30)) {
      const msg = `Renaming the workspace directory requires Git 2.30+ (you have ${version.major}.${version.minor}.${version.patch}).`;
      error(msg);
      throw new ArbError(msg);
    }
  }

  const fullRemotesMap = await cache.resolveRemotesMap(repos, ctx.reposDir);
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

  const branchesNeedRename = oldBranch !== newBranch;

  const assessments = await runPlanFlow({
    shouldFetch,
    fetchDirs: repoDirs,
    reposForFetchReport: repos,
    remotesMap: fullRemotesMap,
    assess,
    formatPlan: (nextAssessments) =>
      formatRenamePlan(
        nextAssessments,
        oldBranch,
        newBranch,
        options.deleteRemote ?? false,
        newWorkspaceName,
        workspace,
        newBase,
      ),
    onPostFetch: () => cache.invalidateAfterFetch(),
  });

  const willRename = branchesNeedRename ? assessments.filter((a) => a.outcome === "will-rename") : [];

  if (willRename.length === 0 && workspace === newWorkspaceName && effectiveBase === configBase) {
    info("Nothing to rename");
    return;
  }

  if (options.dryRun) {
    dryRunNotice();
    return;
  }

  // Confirm
  const actions: string[] = [];
  if (willRename.length > 0) actions.push(`rename branch in ${plural(willRename.length, "repo")}`);
  if (workspace !== newWorkspaceName) actions.push("rename workspace directory");
  if (effectiveBase !== configBase) actions.push(`change base to ${effectiveBase}`);
  await confirmOrExit({
    yes: options.yes,
    message: `${actions.join(", ").replace(/^./, (c) => c.toUpperCase())}?`,
  });

  process.stderr.write("\n");

  // Capture state and write operation record
  const repoStates: Record<string, RepoOperationState> = {};
  if (branchesNeedRename && willRename.length > 0) {
    for (const a of willRename) {
      repoStates[a.repo] = await captureRepoState(a.repoDir, a.repo);
    }
  }

  const configBefore = readWorkspaceConfig(configFile) ?? { branch: oldBranch };
  const configAfter = { branch: newBranch, ...(configBase && { base: configBase }) };
  const record: OperationRecord = {
    command: "rename",
    startedAt: new Date().toISOString(),
    status: "in-progress",
    repos: repoStates,
    oldName: workspace,
    newName: newWorkspaceName,
    configBefore,
    configAfter,
  };
  writeOperationRecord(wsDir, record);

  // Rename branches if needed
  let renameOk = 0;
  if (branchesNeedRename && willRename.length > 0) {
    // Operation record tracks in-progress state (no config mutation until completion)

    const failures: string[] = [];
    await withReflogAction("arb-rename", async () => {
      for (const a of willRename) {
        inlineStart(a.repo, "renaming");
        const result = await renameBranch(a.repoDir, oldBranch, newBranch);
        if (result.exitCode === 0) {
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
            const errorOutput = result.stderr.trim().slice(0, 4000) || undefined;
            record.repos[a.repo] = { ...existing, status: "conflicting", errorOutput };
          }
          writeOperationRecord(wsDir, record);
          inlineResult(a.repo, red("failed"));
          failures.push(a.repo);
        }
      }
    });

    if (failures.length > 0) {
      process.stderr.write("\n");
      error(`Failed to rename in ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
      warn("Use 'arb rename --continue' to retry or 'arb rename --abort' to cancel");
      throw new ArbError(`Failed to rename in ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
    }

    // Clear stale tracking for repos already on the new branch
    for (const a of assessments.filter((a) => a.outcome === "already-on-new")) {
      const mergeRef = await gitLocal(a.repoDir, "config", `branch.${newBranch}.merge`);
      if (mergeRef.exitCode === 0 && mergeRef.stdout.trim() === `refs/heads/${oldBranch}`) {
        await gitLocal(a.repoDir, "config", "--unset", `branch.${newBranch}.remote`);
        await gitLocal(a.repoDir, "config", "--unset", `branch.${newBranch}.merge`);
      }
    }
  }

  // All local renames succeeded — clear migration state + update base
  writeWorkspaceConfig(configFile, { branch: newBranch, ...(effectiveBase && { base: effectiveBase }) });

  // Remote cleanup
  if (options.deleteRemote && branchesNeedRename) {
    const withOldRemote = willRename.filter((a) => a.oldRemoteExists && a.shareRemote !== null);
    if (withOldRemote.length > 0) {
      for (const a of withOldRemote) {
        inlineStart(a.repo, `deleting ${a.shareRemote}/${oldBranch}`);
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

  // Workspace rename — after all per-repo operations complete
  let renamedWorkspace = false;
  if (workspace !== newWorkspaceName) {
    renamedWorkspace = renameWorkspaceDir(ctx, wsDir, workspace, newWorkspaceName, repos);
    if (renamedWorkspace) {
      inlineResult(workspace, `workspace renamed to ${newWorkspaceName}`);
      // Update config file path for any further writes
      const newConfigFile = `${ctx.arbRootDir}/${newWorkspaceName}/.arbws/config.json`;
      if (effectiveBase !== configBase) {
        writeWorkspaceConfig(newConfigFile, { branch: newBranch, ...(effectiveBase && { base: effectiveBase }) });
      }
    }
  }

  process.stderr.write("\n");

  // Summarize
  const parts: string[] = [];
  if (renamedWorkspace) parts.push("workspace renamed");
  if (renameOk > 0) parts.push(`${plural(renameOk, "repo")} renamed`);
  const alreadyRenamed = assessments.filter((a) => a.outcome === "already-on-new").length;
  if (alreadyRenamed > 0) parts.push(`${alreadyRenamed} already renamed`);
  const skipped = assessments.filter((a) => a.outcome !== "will-rename" && a.outcome !== "already-on-new").length;
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (effectiveBase !== configBase) parts.push(`base set to ${effectiveBase}`);
  // Finalize operation record (use new wsDir if workspace was renamed)
  const finalWsDir = renamedWorkspace ? `${ctx.arbRootDir}/${newWorkspaceName}` : wsDir;
  record.status = "completed";
  record.completedAt = new Date().toISOString();
  writeOperationRecord(finalWsDir, record);

  finishSummary(parts.length > 0 ? parts : ["no changes"], false);

  // Guide user toward arb push when remote branches were involved
  const hasAnyRemote = assessments.some((a) => a.shareRemote !== null);
  if (hasAnyRemote && branchesNeedRename) {
    info("Run 'arb push' to push the new branch name to the remote");
  }

  // Print new workspace path to stdout for shell wrapper cd
  if (renamedWorkspace) {
    process.stdout.write(`${ctx.arbRootDir}/${newWorkspaceName}\n`);
  }
}

export function registerRenameCommand(program: Command): void {
  program
    .command("rename [new-name]")
    .option("--branch <name>", "Set the branch name independently from the workspace name")
    .option("--base <branch>", "Change the base branch")
    .option("-r, --delete-remote", "Delete old branch on remote after rename")
    .option("--fetch", "Fetch from all remotes before rename (default)")
    .option("-N, --no-fetch", "Skip fetching before rename")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Show what would happen without executing")
    .option("--include-in-progress", "Rename repos even if they have an in-progress git operation")
    .addOption(new Option("--continue", "Resume a partial workspace rename").conflicts("abort"))
    .addOption(
      new Option("--abort", "Cancel the in-progress rename and restore pre-rename state").conflicts("continue"),
    )
    .summary("Rename the workspace (directory + branch)")
    .description(
      "Examples:\n\n  arb rename PROJ-209                      Rename workspace and branch\n  arb rename PROJ-209 --branch feat/PROJ-209   Set branch independently\n  arb rename --branch feat/PROJ-209        Derive workspace name from branch\n\nRenames the workspace directory and branch across all repos. Completes the create/delete/rename lifecycle triad.\n\nThe positional <new-name> sets the workspace directory name and, by default, the branch name. Use --branch to set the branch name independently (e.g. 'arb rename PROJ-208 --branch feat/PROJ-208'). If only --branch is provided, the workspace name is derived from the last path segment.\n\nUse --base to change the base branch as part of the rename, completing the 'repurpose workspace' workflow.\n\nFetches before assessing to get fresh remote state (use -N/--no-fetch to skip). Shows a plan and asks for confirmation before proceeding. Repos with an in-progress git operation (rebase, merge, cherry-pick) are skipped.\n\nRename is tracked as an operation in .arbws/operation.json. If it fails partway, use 'arb rename --continue' to retry, or 'arb rename --abort' to roll back.",
    )
    .action(
      arbAction(async (ctx, newNameArg: string | undefined, options: RenameCommandOptions) => {
        const { wsDir, workspace } = requireWorkspace(ctx);

        // Operation lifecycle: --continue, --abort, gate
        if ((options.continue || options.abort) && (newNameArg || options.branch)) {
          const flag = options.continue ? "--continue" : "--abort";
          error(`${flag} does not accept name or --branch arguments`);
          throw new ArbError(`${flag} does not accept name or --branch arguments`);
        }

        const inProgress = readInProgressOperation(wsDir, "rename") as (OperationRecord & { command: "rename" }) | null;

        if (options.abort) {
          if (!inProgress) {
            error("No rename in progress. Nothing to abort.");
            throw new ArbError("No rename in progress. Nothing to abort.");
          }
          const { runUndoFlow } = await import("../lib/sync/undo");
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
            error("No rename in progress. Nothing to continue.");
            throw new ArbError("No rename in progress. Nothing to continue.");
          }
          const configFile = `${wsDir}/.arbws/config.json`;
          const currentConfigBranch = readWorkspaceConfig(configFile)?.branch ?? "";
          const configBase = readWorkspaceConfig(configFile)?.base ?? null;
          const oldBranch = currentConfigBranch;
          const newBranch = inProgress.configAfter?.branch ?? currentConfigBranch;
          const newWorkspaceName = inProgress.newName;
          return runWorkspaceRename(
            wsDir,
            ctx,
            workspace,
            configFile,
            oldBranch,
            newBranch,
            newWorkspaceName,
            configBase,
            options.base,
            options,
            inProgress,
          );
        }

        await assertNoInProgressOperation(wsDir);

        const configFile = `${wsDir}/.arbws/config.json`;
        const wsConfig = readWorkspaceConfig(configFile);
        const currentConfigBranch = wsConfig?.branch ?? null;
        const configBase = wsConfig?.base ?? null;

        if (!currentConfigBranch) {
          const msg = `No branch configured for workspace '${workspace}'. Cannot rename.`;
          error(msg);
          throw new ArbError(msg);
        }

        const oldBranch = currentConfigBranch;
        let newBranch: string;
        let newWorkspaceName: string;

        // At least one of <new-name> or --branch is required
        if (!newNameArg && !options.branch) {
          const msg =
            "At least one of <new-name> or --branch is required. Usage: arb rename <new-name> [--branch <name>]";
          error(msg);
          throw new ArbError(msg);
        }

        // Resolve workspace name and branch name
        if (newNameArg && options.branch) {
          // Both provided
          newWorkspaceName = newNameArg;
          newBranch = options.branch;
        } else if (newNameArg) {
          // Only positional: workspace name = branch name
          newWorkspaceName = newNameArg;
          newBranch = newNameArg;
        } else {
          // Only --branch: derive workspace name from branch
          // biome-ignore lint/style/noNonNullAssertion: checked above
          const derived = deriveWorkspaceNameFromBranch(options.branch!);
          if (!derived) {
            // biome-ignore lint/style/noNonNullAssertion: checked above
            const msg = `Could not derive workspace name from branch '${options.branch!}'. Pass an explicit workspace name: arb rename <workspace-name> --branch ${options.branch}`;
            error(msg);
            throw new ArbError(msg);
          }
          newWorkspaceName = derived;
          // biome-ignore lint/style/noNonNullAssertion: checked above
          newBranch = options.branch!;
        }

        // Validate workspace name
        const wsNameErr = validateWorkspaceName(newWorkspaceName);
        if (wsNameErr) {
          error(wsNameErr);
          throw new ArbError(wsNameErr);
        }

        // Validate branch name
        const branchErr = branchNameError(newBranch);
        if (branchErr) {
          error(`Invalid branch name: ${branchErr}`);
          throw new ArbError(`Invalid branch name: '${newBranch}'`);
        }

        // Check for name collision
        if (newWorkspaceName !== workspace && existsSync(`${ctx.arbRootDir}/${newWorkspaceName}`)) {
          // On case-insensitive FS, the "collision" may be with ourselves (case-only rename)
          const existingPath = realpathSync(`${ctx.arbRootDir}/${newWorkspaceName}`);
          const currentPath = realpathSync(wsDir);
          if (existingPath !== currentPath) {
            const msg = `Directory '${newWorkspaceName}' already exists`;
            error(msg);
            throw new ArbError(msg);
          }
        }

        // Check for no-op
        if (oldBranch === newBranch && workspace === newWorkspaceName && !options.base) {
          info("Already at target name — nothing to do");
          return;
        }

        return runWorkspaceRename(
          wsDir,
          ctx,
          workspace,
          configFile,
          oldBranch,
          newBranch,
          newWorkspaceName,
          configBase,
          options.base,
          options,
          null,
        );
      }),
    );
}
