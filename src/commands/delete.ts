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
import { GitCache, branchExistsLocally, git, remoteBranchExists } from "../lib/git";
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
  matchesAge,
  resolveAgeFilter,
  resolveWhereFilter,
  workspaceMatchesWhere,
  wouldLoseWork,
} from "../lib/status";
import { confirmOrExit, parallelFetch, reportFetchFailures } from "../lib/sync";
import {
  type TemplateDiff,
  diffTemplates,
  displayAggregatedTemplateDiffs,
  displayTemplateDiffs,
} from "../lib/templates";
import {
  analyzeDone,
  analyzeProgress,
  checkboxWithPreview,
  dim,
  dryRunNotice,
  error,
  info,
  inlineResult,
  inlineStart,
  isTTY,
  plural,
  readNamesFromStdin,
  red,
  success,
  warn,
} from "../lib/terminal";
import { listWorkspaces, validateWorkspaceName, workspaceBranch, workspaceRepoDirs } from "../lib/workspace";

interface WorkspaceAssessment {
  name: string;
  wsDir: string;
  branch: string;
  repos: string[]; // Repo names from filesystem scan (independent of summary)
  summary: WorkspaceSummary;
  atRiskCount: number;
  atRiskRepos: string[];
  hasAtRisk: boolean;
  templateDiffs: TemplateDiff[];
}

/** Use lastActivity when available (age-filtered), otherwise lastCommit. */
function assessmentTimeDate(a: WorkspaceAssessment): string | null {
  return a.summary.lastActivity ?? a.summary.lastCommit;
}

function buildCheckboxName(
  a: WorkspaceAssessment,
  maxNameWidth: number,
  lcWidths: LastCommitWidths,
  maxReposWidth: number,
): string {
  const name = a.name.padEnd(maxNameWidth);

  const timeDate = assessmentTimeDate(a);
  const parts = timeDate ? formatRelativeTimeParts(timeDate) : { num: "", unit: "" };
  const lastCommit = formatLastCommitCell(parts, lcWidths, true);

  // Repo count (left-aligned, matching the table renderer)
  const repoCount = `${a.summary.total}`.padEnd(maxReposWidth);

  // Status — uses formatStatusCounts for ANSI attention coloring on at-risk flags
  let status: string;
  if (a.summary.total === 0) {
    status = "empty";
  } else if (a.summary.repos.length === 0 && a.summary.total > 0) {
    status = "(remotes not resolved)";
  } else if (a.summary.statusCounts.length === 0) {
    status = "no issues";
  } else {
    status = formatStatusCounts(a.summary.statusCounts, a.summary.outdatedOnlyCount, LOSE_WORK_FLAGS);
  }

  return `${name}  ${lastCommit}  ${repoCount}  ${status}`;
}

function buildCheckboxHeader(
  maxNameWidth: number,
  lcWidths: LastCommitWidths,
  maxReposWidth: number,
  hasActivity: boolean,
): string {
  // 3 leading spaces to align with inquirer's "cursor + icon + space" prefix
  const prefix = "   ";
  const wsHeader = "WORKSPACE".padEnd(maxNameWidth);
  const timeLabel = hasActivity ? "LAST ACTIVITY" : "LAST COMMIT";
  const lcHeader = timeLabel.padStart(Math.max(lcWidths.total, timeLabel.length));
  const reposHeader = "REPOS".padEnd(maxReposWidth);
  return `\n${prefix}${wsHeader}  ${lcHeader}  ${reposHeader}  STATUS`;
}

function buildAtRiskNodes(assessments: WorkspaceAssessment[]): OutputNode[] {
  const atRisk = assessments.filter((a) => a.hasAtRisk);
  if (atRisk.length === 0) return [];
  const multiWs = assessments.length > 1;
  return [
    {
      kind: "section",
      header: cell("Workspaces with changes that will be lost", "attention"),
      items: atRisk.map((a) => {
        const repos = a.atRiskRepos.join(", ");
        return cell(multiWs ? `[${a.name}] ${repos}` : repos);
      }),
    },
    { kind: "gap" },
  ];
}

function buildDeleteInfoNodes(assessments: WorkspaceAssessment[]): OutputNode[] {
  const nodes: OutputNode[] = [];
  const multiWs = assessments.length > 1;
  if (multiWs) {
    const diffNodes = displayAggregatedTemplateDiffs(assessments);
    if (diffNodes.length > 0) nodes.push(...diffNodes);
  } else {
    for (const a of assessments) {
      const diffNodes = displayTemplateDiffs(a.templateDiffs);
      if (diffNodes.length > 0) nodes.push(...diffNodes);
    }
  }
  nodes.push(...buildAtRiskNodes(assessments));
  return nodes;
}

function buildDeletePreview(
  assessments: WorkspaceAssessment[],
  selectedIndices: number[],
  forceAtRisk: boolean,
): string {
  const selected = selectedIndices.map((i) => assessments[i] as WorkspaceAssessment);
  if (selected.length === 0) return "";

  const rCtx: RenderContext = { tty: true };
  const nodes = buildDeleteInfoNodes(selected);
  let out = nodes.length > 0 ? `\n${render(nodes, rCtx)}` : "";

  // At-risk refusal warning
  const atRiskWorkspaces = selected.filter((a) => a.hasAtRisk);
  if (atRiskWorkspaces.length > 0 && !forceAtRisk) {
    out += red(
      `Refusing to delete: ${plural(atRiskWorkspaces.length, "workspace")} ${atRiskWorkspaces.length === 1 ? "has" : "have"} work that would be lost. Use --force to override.`,
    );
    out += "\n";
  }

  return out;
}

async function selectFromAssessments(
  assessments: WorkspaceAssessment[],
  forceAtRisk: boolean,
  preSelected = true,
): Promise<WorkspaceAssessment[]> {
  if (assessments.length === 0) return [];

  // Compute column widths for checkbox names
  const maxNameWidth = Math.max("WORKSPACE".length, ...assessments.map((a) => a.name.length));
  const allTimeParts: RelativeTimeParts[] = assessments.map((a) => {
    const date = assessmentTimeDate(a);
    return date ? formatRelativeTimeParts(date) : { num: "", unit: "" };
  });
  const lcWidths = computeLastCommitWidths(allTimeParts);
  const hasActivity = assessments.some((a) => a.summary.lastActivity != null);
  // Widen column if "LAST ACTIVITY" header (13 chars) is wider than data
  if (hasActivity && lcWidths.total < 13) {
    lcWidths.maxUnit += 13 - lcWidths.total;
    lcWidths.total = 13;
  }
  const maxReposWidth = Math.max("REPOS".length, ...assessments.map((a) => `${a.summary.total}`.length));

  const header = buildCheckboxHeader(maxNameWidth, lcWidths, maxReposWidth, hasActivity);

  const choices = assessments.map((a, i) => ({
    name: buildCheckboxName(a, maxNameWidth, lcWidths, maxReposWidth),
    value: i,
    short: a.name,
    checked: preSelected,
  }));

  const selected = await checkboxWithPreview(
    {
      message: header,
      choices,
      pageSize: choices.length,
      loop: false,
      preview: (selectedIndices: number[]) => buildDeletePreview(assessments, selectedIndices, forceAtRisk),
      theme: {
        prefix: { idle: "", done: "" },
        style: {
          message: (text: string, status: string) => (status === "done" ? "" : dim(text)),
          renderSelectedChoices: (sel: { short: string }[]) => `${sel.length} selected`,
        },
      },
    },
    { output: process.stderr, clearPromptOnDone: true },
  );

  return selected.map((i) => assessments[i] as WorkspaceAssessment);
}

async function assessWorkspace(
  name: string,
  ctx: ArbContext,
  gatherOpts?: { gatherActivity?: boolean },
): Promise<WorkspaceAssessment | null> {
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
  const cache = await GitCache.create();

  if (repos.length === 0) {
    summary = {
      workspace: name,
      branch,
      base: null,
      repos: [],
      total: 0,
      atRiskCount: 0,
      outdatedOnlyCount: 0,
      statusCounts: [],
      lastCommit: null,
      lastActivity: null,
      lastActivityFile: null,
    };
  } else {
    // Gather workspace summary using the canonical status model.
    // Delete must be resilient to repos with broken/missing/ambiguous remotes —
    // if we can't determine the state, treat the workspace as at-risk.
    try {
      summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache, gatherOpts);
    } catch (e) {
      warn(`Could not gather status for ${name}: ${e instanceof Error ? e.message : e}`);
      summary = {
        workspace: name,
        branch,
        base: null,
        repos: [],
        total: repos.length,
        atRiskCount: repos.length,
        outdatedOnlyCount: 0,
        statusCounts: [],
        lastCommit: null,
        lastActivity: null,
        lastActivityFile: null,
      };
    }
  }

  // Determine at-risk repos
  const atRiskRepos: string[] = [];
  if (summary.repos.length === 0 && repos.length > 0) {
    // Remotes not resolved — all repos are at risk
    atRiskRepos.push(...repos);
  } else {
    for (const status of summary.repos) {
      const flags = computeFlags(status, branch);
      if (wouldLoseWork(flags)) {
        atRiskRepos.push(status.name);
      }
    }
  }
  const atRiskCount = atRiskRepos.length;
  const hasAtRisk = atRiskCount > 0;

  // Template drift detection (exclude stale — user hasn't touched those files)
  const templateDiffs = (await diffTemplates(ctx.arbRootDir, wsDir, repos, cache)).filter((d) => d.kind !== "stale");

  return {
    name,
    wsDir,
    branch,
    repos,
    summary,
    atRiskCount,
    atRiskRepos,
    hasAtRisk,
    templateDiffs,
  };
}

function buildDeleteTableNodes(assessments: WorkspaceAssessment[]): OutputNode[] {
  // Time column — compute widths for right-alignment
  const allTimeParts: RelativeTimeParts[] = assessments.map((a) => {
    const date = assessmentTimeDate(a);
    return date ? formatRelativeTimeParts(date) : { num: "", unit: "" };
  });
  const lcWidths: LastCommitWidths = computeLastCommitWidths(allTimeParts);
  const hasActivity = assessments.some((a) => a.summary.lastActivity != null);

  const rows = assessments.map((a, i) => {
    // Time cell
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
      statusCell = cell(formatStatusCounts(a.summary.statusCounts, a.summary.outdatedOnlyCount, LOSE_WORK_FLAGS));
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
        { header: hasActivity ? "LAST ACTIVITY" : "LAST COMMIT", key: "lastCommit" },
        { header: "REPOS", key: "repos" },
        { header: "STATUS", key: "status" },
      ],
      rows,
    },
  ];
}

function displayDeleteTable(assessments: WorkspaceAssessment[]): void {
  const rCtx: RenderContext = { tty: isTTY() };
  const tableNodes = buildDeleteTableNodes(assessments);
  const infoNodes = buildDeleteInfoNodes(assessments);
  process.stderr.write(`\n${render(tableNodes, rCtx)}\n`);
  if (infoNodes.length > 0) {
    process.stderr.write(render(infoNodes, rCtx));
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
    .option(
      "--older-than <duration>",
      "Only delete workspaces not touched in the given duration (e.g. 30d, 2w, 3m, 1y)",
    )
    .option("--newer-than <duration>", "Only delete workspaces touched within the given duration (e.g. 7d, 2w)")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("--fetch", "Fetch before assessing workspace status (default)")
    .option("-N, --no-fetch", "Skip fetching")
    .summary("Delete one or more workspaces")
    .description(
      "Delete one or more workspaces and their repos. Fetches workspace repos before assessing for fresh remote state (skip with -N/--no-fetch). Shows the status of each repo (uncommitted changes, unpushed commits) and any modified template files before proceeding. Prompts with a workspace picker when run without arguments.\n\nUse --all-safe to batch-delete all workspaces with safe status (no uncommitted changes, unpushed commits, or branch drift). Use --where <filter> to filter by status flags. Use --older-than/--newer-than to filter by workspace activity age. When used without workspace names, these filters select from all matching workspaces (e.g. arb delete --where gone deletes all gone workspaces). In a TTY, --where, --older-than/--newer-than, and --all-safe show an interactive picker with all matches pre-selected, letting you deselect workspaces to keep. When combined with names, filters narrow the selection further (AND logic). Combine with --all-safe to narrow further (e.g. --all-safe --where gone for merged-and-safe workspaces). See 'arb help where' for filter syntax.\n\nUse --yes to skip confirmation (and interactive selection), --force to override at-risk safety checks, --delete-remote to also delete the remote branches.\n\nSee 'arb help stacked' for stacked workspace deletion.",
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
          olderThan?: string;
          newerThan?: string;
          dryRun?: boolean;
          fetch?: boolean;
        },
      ) => {
        const ctx = getCtx();
        const skipPrompts = options.yes ?? false;
        const forceAtRisk = options.force ?? false;
        const deleteRemote = options.deleteRemote ?? false;

        const whereFilter = resolveWhereFilter(options);
        const ageFilter = resolveAgeFilter(options);

        // Pre-fetch repos across all candidate workspaces for fresh remote data
        const fetchWorkspaceRepos = async (workspaceNames: string[]) => {
          if (options.fetch === false) return;
          const allRepoNames = new Set<string>();
          for (const ws of workspaceNames) {
            const wsDir = `${ctx.arbRootDir}/${ws}`;
            for (const repoDir of workspaceRepoDirs(wsDir)) {
              allRepoNames.add(basename(repoDir));
            }
          }
          if (allRepoNames.size === 0) return;
          // Fetch from canonical repo dirs so each repo is only fetched once,
          // regardless of how many workspaces reference it.
          const allRepoDirs = [...allRepoNames].map((name) => `${ctx.reposDir}/${name}`);
          const cache = await GitCache.create();
          const remotesMap = await cache.resolveRemotesMap([...allRepoNames], ctx.reposDir);
          const fetchResults = await parallelFetch(allRepoDirs, undefined, remotesMap);
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

          const gatherOptsAllSafe = ageFilter ? { gatherActivity: true } : undefined;
          const totalCandidates = candidates.length;
          let analyzedCandidates = 0;
          const analyzeStart = performance.now();
          let safeResults: (WorkspaceAssessment | null)[];
          try {
            safeResults = await Promise.all(
              candidates.map(async (ws) => {
                const wsDir = `${ctx.arbRootDir}/${ws}`;
                if (!existsSync(`${wsDir}/.arbws/config.json`) && !existsSync(`${wsDir}/.arbws/config`)) {
                  analyzeProgress(++analyzedCandidates, totalCandidates);
                  return null;
                }

                const assessment = await assessWorkspace(ws, ctx, gatherOptsAllSafe);
                analyzeProgress(++analyzedCandidates, totalCandidates);
                if (
                  assessment &&
                  !assessment.hasAtRisk &&
                  isWorkspaceSafe(assessment.summary.repos, assessment.branch)
                ) {
                  // Apply --where narrowing (AND with --all-safe)
                  if (whereFilter && !workspaceMatchesWhere(assessment.summary.repos, assessment.branch, whereFilter))
                    return null;
                  if (ageFilter && !matchesAge(assessment.summary.lastActivity, ageFilter)) return null;
                  return assessment;
                }
                return null;
              }),
            );
          } finally {
            const elapsed = ((performance.now() - analyzeStart) / 1000).toFixed(1);
            analyzeDone(totalCandidates, elapsed);
          }
          let safeEntries = safeResults.filter((a): a is WorkspaceAssessment => a !== null);

          if (safeEntries.length === 0) {
            info("No workspaces with safe status.");
            return;
          }

          // Interactive selection when in TTY — let the user deselect workspaces to keep
          if (isTTY() && process.stdin.isTTY && !skipPrompts) {
            safeEntries = await selectFromAssessments(safeEntries, forceAtRisk);
            if (safeEntries.length === 0) {
              info("No workspaces selected.");
              return;
            }
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
        const interactivePicker = names.length === 0 && !whereFilter && !ageFilter;
        if (names.length === 0 && (whereFilter || ageFilter)) {
          // --where / --older-than / --newer-than replace positional args: select from all workspaces
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
            // Interactive: assess all workspaces for the table selector
            const allWorkspaces = listWorkspaces(ctx.arbRootDir);
            const candidates = allWorkspaces.filter((ws) => ws !== ctx.currentWorkspace);
            if (candidates.length === 0) {
              error("No workspaces found.");
              throw new ArbError("No workspaces found.");
            }
            names = candidates;
          }
        }

        // Fetch repos for fresh remote state
        await fetchWorkspaceRepos(names);

        // Assess all workspaces
        const gatherOpts = ageFilter ? { gatherActivity: true } : undefined;
        const total = names.length;
        let analyzed = 0;
        const analyzeStart = performance.now();
        let results: (WorkspaceAssessment | null)[];
        try {
          results = await Promise.all(
            names.map(async (name) => {
              const assessment = await assessWorkspace(name, ctx, gatherOpts);
              analyzeProgress(++analyzed, total);
              return assessment;
            }),
          );
        } finally {
          const elapsed = ((performance.now() - analyzeStart) / 1000).toFixed(1);
          analyzeDone(total, elapsed);
        }
        let assessments = results.filter((a): a is WorkspaceAssessment => a !== null);

        // Filter by --where and/or age
        if (whereFilter) {
          assessments = assessments.filter((a) => workspaceMatchesWhere(a.summary.repos, a.branch, whereFilter));
        }
        if (ageFilter) {
          assessments = assessments.filter((a) => matchesAge(a.summary.lastActivity, ageFilter));
        }

        if (assessments.length === 0) {
          if (whereFilter || ageFilter) {
            info("No workspaces match the filter.");
          } else {
            error("No workspaces found.");
            throw new ArbError("No workspaces found.");
          }
          return;
        }

        // Interactive selection in TTY — table selector for bare delete or filtered delete
        if ((interactivePicker || whereFilter || ageFilter) && isTTY() && process.stdin.isTTY && !skipPrompts) {
          assessments = await selectFromAssessments(assessments, forceAtRisk, !interactivePicker);
          if (assessments.length === 0) {
            info("No workspaces selected.");
            return;
          }
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
