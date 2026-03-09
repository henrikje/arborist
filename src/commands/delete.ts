import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import {
  ArbError,
  type LastCommitWidths,
  type RelativeTimeParts,
  computeLastCommitWidths,
  formatLastCommitCell,
  formatRelativeTimeParts,
} from "../lib/core";
import type { ArbContext } from "../lib/core";
import {
  GitCache,
  assertMinimumGitVersion,
  branchExistsLocally,
  git,
  remoteBranchExists,
  validateWorkspaceName,
} from "../lib/git";
import { type RenderContext, render } from "../lib/render";
import { EMPTY_CELL, cell } from "../lib/render";
import type { Cell, OutputNode } from "../lib/render";
import { formatStatusCounts } from "../lib/render";
import {
  LOSE_WORK_FLAGS,
  type WorkspaceSummary,
  computeFlags,
  gatherWorkspaceSummary,
  isWorkspaceSafe,
  resolveWhereFilter,
  workspaceMatchesWhere,
  wouldLoseWork,
} from "../lib/status";
import { confirmOrExit, parallelFetch, reportFetchFailures } from "../lib/sync";
import {
  dryRunNotice,
  error,
  info,
  inlineResult,
  inlineStart,
  isTTY,
  plural,
  readNamesFromStdin,
  success,
  warn,
} from "../lib/terminal";
import {
  type TemplateDiff,
  diffTemplates,
  displayTemplateDiffs,
  listWorkspaces,
  selectInteractive,
  workspaceBranch,
  workspaceRepoDirs,
} from "../lib/workspace";

interface WorkspaceAssessment {
  name: string;
  wsDir: string;
  branch: string;
  repos: string[]; // Repo names from filesystem scan (independent of summary)
  summary: WorkspaceSummary;
  atRiskCount: number;
  hasAtRisk: boolean;
  templateDiffs: TemplateDiff[];
}

async function assessWorkspace(name: string, ctx: ArbContext): Promise<WorkspaceAssessment | null> {
  const validationError = validateWorkspaceName(name);
  if (validationError) {
    error(validationError);
    throw new ArbError(validationError);
  }

  const wsDir = `${ctx.arbRootDir}/${name}`;
  if (!existsSync(wsDir)) {
    error(`No workspace found for ${name}`);
    throw new ArbError(`No workspace found for ${name}`);
  }

  // Read branch from config
  let branch: string;
  const wb = await workspaceBranch(wsDir);
  if (wb) {
    branch = wb.branch;
  } else {
    branch = name.toLowerCase();
    warn(`Could not determine branch for ${name}, assuming '${branch}'`);
  }

  // Discover repos
  const repoPaths = workspaceRepoDirs(wsDir);
  const repos = repoPaths.map((d) => basename(d));

  let summary: WorkspaceSummary;
  const cache = new GitCache();

  if (repos.length === 0) {
    summary = {
      workspace: name,
      branch,
      base: null,
      repos: [],
      total: 0,
      atRiskCount: 0,
      rebasedOnlyCount: 0,
      statusLabels: [],
      statusCounts: [],
      lastCommit: null,
      detectedTicket: null,
    };
  } else {
    // Gather workspace summary using the canonical status model.
    // Delete must be resilient to repos with broken/missing/ambiguous remotes —
    // if we can't determine the state, treat the workspace as at-risk.
    await assertMinimumGitVersion(cache);
    try {
      summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache);
    } catch (e) {
      warn(`Could not gather status for ${name}: ${e instanceof Error ? e.message : e}`);
      summary = {
        workspace: name,
        branch,
        base: null,
        repos: [],
        total: repos.length,
        atRiskCount: repos.length,
        rebasedOnlyCount: 0,
        statusLabels: [],
        statusCounts: [],
        lastCommit: null,
        detectedTicket: null,
      };
    }
  }

  // Determine at-risk repos
  let hasAtRisk = summary.repos.length === 0 && repos.length > 0;
  let atRiskCount = summary.repos.length === 0 ? repos.length : 0;

  for (const status of summary.repos) {
    const flags = computeFlags(status, branch);
    if (wouldLoseWork(flags)) {
      hasAtRisk = true;
      atRiskCount++;
    }
  }

  // Template drift detection
  const templateDiffs = await diffTemplates(ctx.arbRootDir, wsDir, repos, cache);

  return {
    name,
    wsDir,
    branch,
    repos,
    summary,
    atRiskCount,
    hasAtRisk,
    templateDiffs,
  };
}

function buildDeleteTableNodes(assessments: WorkspaceAssessment[]): OutputNode[] {
  // Last commit column — compute widths for right-alignment
  const allTimeParts: RelativeTimeParts[] = assessments.map((a) =>
    a.summary.lastCommit ? formatRelativeTimeParts(a.summary.lastCommit) : { num: "", unit: "" },
  );
  const lcWidths: LastCommitWidths = computeLastCommitWidths(allTimeParts);

  const rows = assessments.map((a, i) => {
    // Last commit cell
    const parts = allTimeParts[i];
    let lastCommitCell: Cell;
    if (!parts || (!parts.num && !parts.unit)) {
      lastCommitCell = EMPTY_CELL;
    } else {
      lastCommitCell = cell(formatLastCommitCell(parts, lcWidths, true));
    }

    // Status cell
    let statusCell: Cell;
    if (a.summary.total === 0) {
      statusCell = cell("empty");
    } else if (a.summary.repos.length === 0 && a.summary.total > 0) {
      statusCell = cell("(remotes not resolved)", "attention");
    } else if (a.summary.statusCounts.length === 0) {
      statusCell = cell("no issues");
    } else {
      statusCell = cell(formatStatusCounts(a.summary.statusCounts, a.summary.rebasedOnlyCount, LOSE_WORK_FLAGS));
    }

    return {
      cells: {
        workspace: cell(a.name),
        lastCommit: lastCommitCell,
        repos: cell(`${a.summary.total}`),
        status: statusCell,
      },
    };
  });

  return [
    {
      kind: "table",
      columns: [
        { header: "WORKSPACE", key: "workspace" },
        { header: "LAST COMMIT", key: "lastCommit" },
        { header: "REPOS", key: "repos" },
        { header: "STATUS", key: "status" },
      ],
      rows,
    },
  ];
}

function displayDeleteTable(assessments: WorkspaceAssessment[]): void {
  const rCtx: RenderContext = { tty: isTTY() };
  const nodes = buildDeleteTableNodes(assessments);
  process.stderr.write(`\n${render(nodes, rCtx)}\n`);

  // Template diffs below the table
  const multiWs = assessments.length > 1;
  for (const a of assessments) {
    const suffix = multiWs ? ` (${a.name})` : "";
    const diffNodes = displayTemplateDiffs(a.templateDiffs, suffix);
    if (diffNodes.length > 0) {
      process.stderr.write(render(diffNodes, rCtx));
    }
  }

  // At-risk warnings
  for (const a of assessments) {
    if (a.hasAtRisk) {
      const inWs = multiWs ? ` in ${a.name}` : "";
      warn(
        `  \u26A0 ${plural(a.atRiskCount, "repo")}${inWs} ${a.atRiskCount === 1 ? "has" : "have"} changes that will be lost.`,
      );
    }
  }

  const hasAnyAtRisk = assessments.some((a) => a.hasAtRisk);
  if (hasAnyAtRisk) {
    process.stderr.write("\n");
  }
}

async function executeDelete(
  assessment: WorkspaceAssessment,
  ctx: ArbContext,
  deleteRemote: boolean,
): Promise<string[]> {
  const { wsDir, branch, repos } = assessment;
  const failedRemoteDeletes: string[] = [];

  for (const repo of repos) {
    await git(`${ctx.reposDir}/${repo}`, "worktree", "remove", "--force", `${wsDir}/${repo}`);

    if (await branchExistsLocally(`${ctx.reposDir}/${repo}`, branch)) {
      await git(`${ctx.reposDir}/${repo}`, "branch", "-D", branch);
    }

    if (deleteRemote) {
      let shareRemote: string | undefined;
      try {
        const deleteCache = new GitCache();
        const remotes = await deleteCache.resolveRemotes(`${ctx.reposDir}/${repo}`);
        shareRemote = remotes.share;
      } catch {
        // Ambiguous remotes — can't determine which remote to delete from
      }
      if (shareRemote) {
        if (await remoteBranchExists(`${ctx.reposDir}/${repo}`, branch, shareRemote)) {
          const pushResult = await git(`${ctx.reposDir}/${repo}`, "push", shareRemote, "--delete", branch);
          if (pushResult.exitCode !== 0) {
            failedRemoteDeletes.push(repo);
          }
        }
      } else {
        warn(`  [${repo}] could not determine share remote — skipping remote branch deletion`);
      }
    }
  }

  rmSync(wsDir, { recursive: true, force: true });

  for (const repo of repos) {
    await git(`${ctx.reposDir}/${repo}`, "worktree", "prune");
  }

  return failedRemoteDeletes;
}

function buildConfirmMessage(count: number, deleteRemote: boolean): string {
  const remoteSuffix = deleteRemote ? " and delete remote branches" : "";
  return `Delete ${plural(count, "workspace")}${remoteSuffix}?`;
}

export function registerDeleteCommand(program: Command, getCtx: () => ArbContext): void {
  program
    .command("delete [names...]")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-f, --force", "Force deletion of at-risk workspaces")
    .option("-r, --delete-remote", "Delete remote branches")
    .option(
      "-a, --all-safe",
      "Delete all safe workspaces (no uncommitted changes, unpushed commits, or branch drift; behind base is fine)",
    )
    .option("-w, --where <filter>", "Filter workspaces by repo status flags (comma = OR, + = AND, ^ = negate)")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("--fetch", "Fetch before assessing workspace status (default)")
    .option("-N, --no-fetch", "Skip fetching")
    .summary("Delete one or more workspaces")
    .description(
      "Delete one or more workspaces and their repos. Fetches workspace repos before assessing for fresh remote state (skip with -N/--no-fetch). Shows the status of each repo (uncommitted changes, unpushed commits) and any modified template files before proceeding. Prompts with a workspace picker when run without arguments.\n\nUse --all-safe to batch-delete all workspaces with safe status (no uncommitted changes, unpushed commits, or branch drift). Use --where <filter> to filter by status flags. When used without workspace names, --where selects all matching workspaces (e.g. arb delete --where gone deletes all gone workspaces). When combined with names, --where narrows the selection further (AND logic). Combine with --all-safe to narrow further (e.g. --all-safe --where gone for merged-and-safe workspaces). See 'arb help where' for filter syntax.\n\nUse --yes to skip confirmation, --force to override at-risk safety checks, --delete-remote to also delete the remote branches.\n\nSee 'arb help stacked' for stacked workspace deletion.",
    )
    .action(
      async (
        nameArgs: string[],
        options: {
          yes?: boolean;
          force?: boolean;
          deleteRemote?: boolean;
          allSafe?: boolean;
          where?: string;
          dryRun?: boolean;
          fetch?: boolean;
        },
      ) => {
        const ctx = getCtx();
        const skipPrompts = options.yes ?? false;
        const forceAtRisk = options.force ?? false;
        const deleteRemote = options.deleteRemote ?? false;

        const whereFilter = resolveWhereFilter(options);

        // Pre-fetch repos across all candidate workspaces for fresh remote data
        const fetchWorkspaceRepos = async (workspaceNames: string[]) => {
          if (options.fetch === false) return;
          const allRepoDirs = new Set<string>();
          const allRepoNames = new Set<string>();
          for (const ws of workspaceNames) {
            const wsDir = `${ctx.arbRootDir}/${ws}`;
            for (const repoDir of workspaceRepoDirs(wsDir)) {
              allRepoDirs.add(repoDir);
              allRepoNames.add(basename(repoDir));
            }
          }
          if (allRepoDirs.size === 0) return;
          const cache = new GitCache();
          await assertMinimumGitVersion(cache);
          const remotesMap = await cache.resolveRemotesMap([...allRepoNames], ctx.reposDir);
          const fetchResults = await parallelFetch([...allRepoDirs], undefined, remotesMap);
          reportFetchFailures([...allRepoNames], fetchResults);
        };

        if (options.allSafe) {
          if (nameArgs.length > 0) {
            error("Cannot combine --all-safe with workspace names.");
            throw new ArbError("Cannot combine --all-safe with workspace names.");
          }

          const allWorkspaces = listWorkspaces(ctx.arbRootDir);
          const candidates = allWorkspaces.filter((ws) => ws !== ctx.currentWorkspace);

          if (candidates.length === 0) {
            info("No workspaces to check.");
            return;
          }

          await fetchWorkspaceRepos(candidates);

          const safeEntries: WorkspaceAssessment[] = [];
          for (const ws of candidates) {
            const wsDir = `${ctx.arbRootDir}/${ws}`;
            if (!existsSync(`${wsDir}/.arbws/config.json`) && !existsSync(`${wsDir}/.arbws/config`)) continue;

            const assessment = await assessWorkspace(ws, ctx);
            if (assessment && !assessment.hasAtRisk && isWorkspaceSafe(assessment.summary.repos, assessment.branch)) {
              // Apply --where narrowing (AND with --all-safe)
              if (whereFilter) {
                if (!workspaceMatchesWhere(assessment.summary.repos, assessment.branch, whereFilter)) {
                  continue;
                }
              }
              safeEntries.push(assessment);
            }
          }

          if (safeEntries.length === 0) {
            info("No workspaces with safe status.");
            return;
          }

          displayDeleteTable(safeEntries);

          if (deleteRemote) {
            process.stderr.write("  Remote branches will also be deleted.\n\n");
          }

          if (options.dryRun) {
            dryRunNotice();
            return;
          }

          await confirmOrExit({
            yes: skipPrompts,
            message: buildConfirmMessage(safeEntries.length, deleteRemote),
          });

          process.stderr.write("\n");
          for (const entry of safeEntries) {
            inlineStart(entry.name, "deleting");
            const failedRemoteDeletes = await executeDelete(entry, ctx, deleteRemote);
            const remoteSuffix = failedRemoteDeletes.length > 0 ? " (failed to delete remote branch)" : "";
            inlineResult(entry.name, `deleted${remoteSuffix}`);
          }

          process.stderr.write("\n");
          success(`Deleted ${plural(safeEntries.length, "workspace")}`);
          return;
        }

        let names = nameArgs;
        if (names.length === 0 && whereFilter) {
          // --where replaces positional args: select from all workspaces
          const allWorkspaces = listWorkspaces(ctx.arbRootDir);
          names = allWorkspaces.filter((ws) => ws !== ctx.currentWorkspace);
        } else if (names.length === 0) {
          const stdinNames = await readNamesFromStdin();
          if (stdinNames.length > 0) {
            names = stdinNames;
          } else if (!isTTY() || !process.stdin.isTTY) {
            error("No workspace specified.");
            throw new ArbError("No workspace specified.");
          } else {
            const workspaces = listWorkspaces(ctx.arbRootDir);
            if (workspaces.length === 0) {
              error("No workspaces found.");
              throw new ArbError("No workspaces found.");
            }
            names = await selectInteractive(workspaces, "Select workspaces to delete");
            if (names.length === 0) {
              error("No workspaces selected.");
              throw new ArbError("No workspaces selected.");
            }
          }
        }

        // Fetch repos for fresh remote state
        await fetchWorkspaceRepos(names);

        // Assess all workspaces
        let assessments: WorkspaceAssessment[] = [];
        for (const name of names) {
          const assessment = await assessWorkspace(name, ctx);
          if (assessment) assessments.push(assessment);
        }

        // Filter by --where
        if (whereFilter) {
          assessments = assessments.filter((a) => workspaceMatchesWhere(a.summary.repos, a.branch, whereFilter));
        }

        if (assessments.length === 0) {
          if (whereFilter) {
            info("No workspaces match the filter.");
          }
          return;
        }

        // Display columnar status table
        displayDeleteTable(assessments);

        // Check for at-risk across all workspaces
        const atRiskWorkspaces = assessments.filter((a) => a.hasAtRisk);

        if (atRiskWorkspaces.length > 0 && !forceAtRisk) {
          const atRiskNames = atRiskWorkspaces.map((a) => a.name).join(", ");
          const msg = `Refusing to delete: ${atRiskNames} ${atRiskWorkspaces.length === 1 ? "has" : "have"} work that would be lost. Use --force to override.`;
          error(msg);
          throw new ArbError(msg);
        }

        if (deleteRemote) {
          process.stderr.write("  Remote branches will also be deleted.\n\n");
        }

        if (options.dryRun) {
          dryRunNotice();
          return;
        }

        // Confirm
        await confirmOrExit({
          yes: skipPrompts,
          message: buildConfirmMessage(assessments.length, deleteRemote),
        });

        // Execute
        process.stderr.write("\n");
        for (const assessment of assessments) {
          inlineStart(assessment.name, "deleting");
          const failedRemoteDeletes = await executeDelete(assessment, ctx, deleteRemote);
          const remoteSuffix = failedRemoteDeletes.length > 0 ? " (failed to delete remote branch)" : "";
          inlineResult(assessment.name, `deleted${remoteSuffix}`);
        }

        // Summarize
        process.stderr.write("\n");
        success(`Deleted ${plural(assessments.length, "workspace")}`);

        // If any deleted workspace was the current one, emit project root
        // so the shell wrapper can cd there (same pattern as create/branch rename).
        const deletedCurrentWorkspace = assessments.some((a) => a.name === ctx.currentWorkspace);
        if (deletedCurrentWorkspace) {
          process.stdout.write(`${ctx.arbRootDir}\n`);
        }
      },
    );
}
