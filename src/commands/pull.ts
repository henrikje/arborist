import { basename } from "node:path";
import { type Command, Option } from "commander";
import { predictMergeConflict, predictRebaseConflictCommits, predictStashPopConflict } from "../lib/analysis";
import {
  ArbError,
  type CommandContext,
  type OperationRecord,
  type RepoOperationState,
  arbAction,
  assertNoInProgressOperation,
  readInProgressOperation,
  readWorkspaceConfig,
  writeOperationRecord,
} from "../lib/core";
import {
  detectOperation,
  getCommitsBetweenFull,
  getDiffShortstat,
  gitLocal,
  gitNetwork,
  networkTimeout,
} from "../lib/git";
import type { RepoRemotes } from "../lib/git";
import { createRenderContext, finishSummary, render } from "../lib/render";
import type { Cell, OutputNode } from "../lib/render";
import { buildConflictReport, buildStashPopFailureReport, skipCell, upToDateCell } from "../lib/render";
import { cell, spans, suffix } from "../lib/render";
import { verboseCommitsToNodes } from "../lib/render";
import { type RepoStatus, computeFlags, resolveWhereFilter } from "../lib/status";
import { VERBOSE_COMMIT_LIMIT, buildCachedStatusAssess, confirmOrExit, runPlanFlow } from "../lib/sync";
import { runContinueFlow } from "../lib/sync/continue-flow";
export type { PullAssessment } from "../lib/sync";
import type { PullAssessment } from "../lib/sync";
import { dryRunNotice, error, info, inlineResult, inlineStart, plural, shouldColor, yellow } from "../lib/terminal";
import { requireBranch, requireWorkspace, resolveReposFromArgsOrStdin, workspaceRepoDirs } from "../lib/workspace";

type PullStrategy = "rebase-pull" | "merge-pull" | "safe-reset" | "forced-reset";

interface PullFailure {
  assessment: PullAssessment;
  exitCode: number;
  stdout: string;
  stderr: string;
  action: string;
}

function withoutSkipFields<T extends { skipReason?: string; skipFlag?: string }>(assessment: T) {
  const { skipReason: _skipReason, skipFlag: _skipFlag, ...next } = assessment;
  return next;
}

export function registerPullCommand(program: Command): void {
  program
    .command("pull [repos...]")
    .option("--reset", "Reset to remote tip instead of pulling (overrides rebased-locally skip)")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Show what would happen without executing")
    .option("--rebase", "Pull with rebase")
    .option("--merge", "Pull with merge")
    .option("--autostash", "Stash uncommitted changes before pull, re-apply after")
    .option("--include-wrong-branch", "Include repos on a different branch than the workspace")
    .option("-v, --verbose", "Show incoming commits in the plan")
    .option("-w, --where <filter>", "Only pull repos matching status filter (comma = OR, + = AND, ^ = negate)")
    .addOption(new Option("--continue", "Resume after resolving conflicts").conflicts("abort"))
    .addOption(new Option("--abort", "Cancel the in-progress pull and restore pre-pull state").conflicts("continue"))
    .summary("Pull feature branches from the remote")
    .description(
      "Examples:\n\n  arb pull                                 Pull all repos\n  arb pull api web                         Pull specific repos\n  arb pull --autostash --rebase            Stash changes, rebase on pull\n\nPull the feature branch for all repos, or only the named repos. Pulls from the share remote (origin by default, or as configured for fork workflows). Always fetches in parallel (ARB_NO_FETCH does not apply), then shows a plan and asks for confirmation before pulling.\n\nRepos with uncommitted changes are skipped unless --autostash is used. Repos on a different branch than the workspace are skipped unless --include-wrong-branch is used. Repos where the remote branch has been deleted are skipped.\n\nIf any repos conflict, arb continues with the remaining repos and reports all conflicts at the end. When a remote branch was rebased and local has no unique commits to preserve, arb may safely reset to the rewritten remote tip instead of attempting a three-way merge.\n\nUse --reset to override the rebased-locally skip and reset to the remote tip, discarding the local rebase. Use --verbose to show the incoming commits in the plan. Use --autostash to stash uncommitted changes before pulling and re-apply them after. Use --where to filter repos by status flags. See 'arb help filtering' for filter syntax.\n\nThe pull mode (rebase or merge) is determined per-repo from git config (branch.<name>.rebase, then pull.rebase), defaulting to merge if neither is set. Use --rebase or --merge to override for all repos.\n\nSee 'arb help remotes' for remote role resolution.",
    )
    .action(
      arbAction(async (ctx, repoArgs: string[], options) => {
        if ((options.continue || options.abort) && repoArgs.length > 0) {
          const flag = options.continue ? "--continue" : "--abort";
          error(`${flag} does not accept repo arguments`);
          throw new ArbError(`${flag} does not accept repo arguments`);
        }
        if (options.rebase && options.merge) {
          error("Cannot use both --rebase and --merge");
          throw new ArbError("Cannot use both --rebase and --merge");
        }
        const { wsDir } = requireWorkspace(ctx);
        const repoNames = await resolveReposFromArgsOrStdin(wsDir, repoArgs);
        await runPull(ctx, repoNames, options);
      }),
    );
}

export async function runPull(
  ctx: CommandContext,
  repoNames: string[],
  options: {
    rebase?: boolean;
    merge?: boolean;
    reset?: boolean;
    yes?: boolean;
    dryRun?: boolean;
    autostash?: boolean;
    includeWrongBranch?: boolean;
    verbose?: boolean;
    where?: string;
    continue?: boolean;
    abort?: boolean;
  },
): Promise<void> {
  const where = resolveWhereFilter(options);
  const flagMode: "rebase" | "merge" | undefined = options.rebase ? "rebase" : options.merge ? "merge" : undefined;
  const { wsDir, workspace } = requireWorkspace(ctx);

  // Operation lifecycle: --continue, --abort, gate
  const inProgress = readInProgressOperation(wsDir, "pull");

  if (options.abort) {
    if (!inProgress) {
      error("No pull in progress. Nothing to abort.");
      throw new ArbError("No pull in progress. Nothing to abort.");
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
      error("No pull in progress. Nothing to continue.");
      throw new ArbError("No pull in progress. Nothing to continue.");
    }
    await runContinueFlow({
      record: inProgress,
      wsDir,
      mode: "pull",
      gitContinueCmd: async (repoDir) => ((await detectOperation(repoDir)) === "merge" ? "merge" : "rebase"),
      options,
    });
    return;
  }

  await assertNoInProgressOperation(wsDir);

  const branch = await requireBranch(wsDir, workspace);

  const selectedRepos = repoNames;
  const selectedSet = new Set(selectedRepos);
  const cache = ctx.cache;
  const remotesMap = await cache.resolveRemotesMap(selectedRepos, ctx.reposDir);
  const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;

  // Phase 1: fetch
  const allFetchDirs = workspaceRepoDirs(wsDir);
  const allRepos = allFetchDirs.map((d) => basename(d));
  const repos = allRepos.filter((r) => selectedSet.has(r));
  const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
  const autostash = options.autostash === true;

  // Phase 2: assess
  const assess = buildCachedStatusAssess<PullAssessment>({
    repos,
    wsDir,
    reposDir: ctx.reposDir,
    branch,
    configBase,
    remotesMap,
    cache,
    analysisCache: ctx.analysisCache,
    where,
    classify: async ({ repoDir, status, fetchFailed }) => {
      const headSha = status.headSha ?? "";
      const pullMode = flagMode ?? (await detectPullMode(repoDir, branch));
      return assessPullRepo(
        status,
        repoDir,
        branch,
        fetchFailed,
        pullMode,
        autostash,
        headSha,
        options.includeWrongBranch,
      );
    },
  });

  const postAssess = async (nextAssessments: PullAssessment[]) => {
    let assessments = await reviveRebasedSkipsForSafeReset(nextAssessments, remotesMap);
    assessments = await resolvePullStrategies(assessments, remotesMap);
    if (options.reset) {
      assessments = resetRebasedSkips(assessments, remotesMap);
    }
    assessments = await predictPullConflicts(assessments, remotesMap);
    if (options.verbose) {
      assessments = await gatherPullVerboseCommits(assessments, remotesMap);
    }
    return assessments;
  };

  const assessments = await runPlanFlow({
    shouldFetch: true, // pull always fetches — ARB_NO_FETCH does not apply (GUIDELINES.md)
    fetchDirs,
    reposForFetchReport: repos,
    remotesMap,
    assess,
    postAssess,
    formatPlan: (nextAssessments) => formatPullPlan(nextAssessments, remotesMap, options.verbose),
    onPostFetch: () => cache.invalidateAfterFetch(),
  });

  const willPull = assessments.filter((a) => a.outcome === "will-pull");
  const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
  const skipped = assessments.filter((a) => a.outcome === "skip");

  if (willPull.length === 0) {
    info(upToDate.length > 0 ? "All repos up to date" : "Nothing to do");
    return;
  }

  if (options.dryRun) {
    dryRunNotice();
    return;
  }

  // Phase 3: confirm
  await confirmOrExit({
    yes: options.yes,
    message: `Pull ${plural(willPull.length, "repo")}?`,
  });

  process.stderr.write("\n");

  // Phase 4: capture state and write operation record
  const repoStates: Record<string, RepoOperationState> = {};
  for (const a of willPull) {
    const headResult = await gitLocal(a.repoDir, "rev-parse", "HEAD");
    const preHead = headResult.stdout.trim();
    if (!preHead) throw new ArbError(`Cannot capture HEAD for ${a.repo}`);
    const stashResult = await gitLocal(a.repoDir, "stash", "create");
    repoStates[a.repo] = {
      preHead,
      stashSha: stashResult.stdout.trim() || null,
      status: "skipped",
    };
  }

  const record: OperationRecord = {
    command: "pull",
    startedAt: new Date().toISOString(),
    status: "in-progress",
    repos: repoStates,
  };
  writeOperationRecord(wsDir, record);

  // Phase 5: execute
  let pullOk = 0;
  const pullTimeout = networkTimeout("ARB_PULL_TIMEOUT", 120);
  const conflicted: { assessment: PullAssessment; stdout: string; stderr: string }[] = [];
  const failed: PullFailure[] = [];
  const stashPopFailed: PullAssessment[] = [];

  const markCompleted = async (repo: string) => {
    const postHead = await gitLocal(willPull.find((a) => a.repo === repo)?.repoDir ?? "", "rev-parse", "HEAD");
    const existing = record.repos[repo];
    if (existing) {
      record.repos[repo] = { ...existing, status: "completed", postHead: postHead.stdout.trim() };
    }
    writeOperationRecord(wsDir, record);
  };
  const markConflicting = (repo: string, stderr?: string) => {
    const existing = record.repos[repo];
    if (existing) {
      const errorOutput = stderr?.trim().slice(0, 4000) || undefined;
      record.repos[repo] = { ...existing, status: "conflicting", errorOutput };
    }
    writeOperationRecord(wsDir, record);
  };

  try {
    process.env.GIT_REFLOG_ACTION = "arb-pull";
    for (const a of willPull) {
      const strategy = a.pullStrategy ?? (a.pullMode === "rebase" ? "rebase-pull" : "merge-pull");
      inlineStart(a.repo, `pulling (${pullStrategyLabel(strategy)})`);
      const pullRemote = remotesMap.get(a.repo)?.share;
      if (!pullRemote) continue;

      if (strategy === "rebase-pull") {
        const pullArgs = a.needsStash
          ? ["pull", "--rebase", "--autostash", pullRemote, a.branch]
          : ["pull", "--rebase", pullRemote, a.branch];
        const pullResult = await gitNetwork(a.repoDir, pullTimeout, pullArgs);
        if (pullResult.exitCode === 0) {
          await markCompleted(a.repo);
          inlineResult(a.repo, `pulled ${plural(a.behind, "commit")} (${a.pullMode})`);
          pullOk++;
        } else {
          if (isConflictResult(pullResult.stdout, pullResult.stderr)) {
            markConflicting(a.repo, pullResult.stderr);
            inlineResult(a.repo, yellow("conflict"));
            conflicted.push({ assessment: a, stdout: pullResult.stdout, stderr: pullResult.stderr });
          } else {
            inlineResult(a.repo, yellow("failed"));
            failed.push({
              assessment: a,
              exitCode: pullResult.exitCode,
              stdout: pullResult.stdout,
              stderr: pullResult.stderr,
              action: "pull --rebase",
            });
          }
        }
      } else if (strategy === "safe-reset" || strategy === "forced-reset") {
        if (a.needsStash) {
          await gitLocal(a.repoDir, "stash", "push", "-m", "arb: autostash before pull");
        }
        const target = a.safeReset?.target ?? `${pullRemote}/${a.branch}`;
        const resetLabel = strategy === "forced-reset" ? "forced reset" : "safe reset";
        const resetResult = await gitLocal(a.repoDir, "reset", "--hard", target);
        if (resetResult.exitCode === 0) {
          let stashPopOk = true;
          if (a.needsStash) {
            const popResult = await gitLocal(a.repoDir, "stash", "pop");
            if (popResult.exitCode !== 0) {
              stashPopOk = false;
              stashPopFailed.push(a);
            }
          }
          await markCompleted(a.repo);
          let doneMsg = `${resetLabel} to ${target}`;
          if (!stashPopOk) {
            doneMsg += ` ${yellow("(stash pop failed)")}`;
          }
          inlineResult(a.repo, doneMsg);
          pullOk++;
        } else {
          markConflicting(a.repo, resetResult.stderr);
          inlineResult(a.repo, yellow("failed"));
          failed.push({
            assessment: a,
            exitCode: resetResult.exitCode,
            stdout: resetResult.stdout,
            stderr: resetResult.stderr,
            action: `reset --hard ${target}`,
          });
        }
      } else {
        if (a.needsStash) {
          await gitLocal(a.repoDir, "stash", "push", "-m", "arb: autostash before pull");
        }
        const pullResult = await gitNetwork(a.repoDir, pullTimeout, ["pull", "--no-rebase", pullRemote, a.branch]);
        if (pullResult.exitCode === 0) {
          let stashPopOk = true;
          if (a.needsStash) {
            const popResult = await gitLocal(a.repoDir, "stash", "pop");
            if (popResult.exitCode !== 0) {
              stashPopOk = false;
              stashPopFailed.push(a);
            }
          }
          await markCompleted(a.repo);
          let doneMsg = `pulled ${plural(a.behind, "commit")} (${a.pullMode})`;
          if (!stashPopOk) {
            doneMsg += ` ${yellow("(stash pop failed)")}`;
          }
          inlineResult(a.repo, doneMsg);
          pullOk++;
        } else {
          if (isConflictResult(pullResult.stdout, pullResult.stderr)) {
            markConflicting(a.repo, pullResult.stderr);
            inlineResult(a.repo, yellow("conflict"));
            conflicted.push({ assessment: a, stdout: pullResult.stdout, stderr: pullResult.stderr });
          } else {
            markConflicting(a.repo, pullResult.stderr);
            inlineResult(a.repo, yellow("failed"));
            failed.push({
              assessment: a,
              exitCode: pullResult.exitCode,
              stdout: pullResult.stdout,
              stderr: pullResult.stderr,
              action: "pull --no-rebase",
            });
          }
        }
      }
    }
  } finally {
    // biome-ignore lint/performance/noDelete: must truly unset env var, not coerce to string
    delete process.env.GIT_REFLOG_ACTION;
  }

  // Consolidated conflict report
  const conflictNodes = buildConflictReport(
    conflicted.map((c) => ({
      repo: c.assessment.repo,
      stdout: c.stdout,
      stderr: c.stderr,
      subcommand: c.assessment.pullMode === "rebase" ? ("rebase" as const) : ("merge" as const),
    })),
  );

  // Consolidated non-conflict failure report
  const failureNodes = buildPullFailureReport(failed);

  // Stash pop failure report
  const stashNodes = buildStashPopFailureReport(stashPopFailed, "Pull");

  const reportCtx = { tty: shouldColor() };
  if (conflictNodes.length > 0) process.stderr.write(render(conflictNodes, reportCtx));
  if (failureNodes.length > 0) process.stderr.write(render(failureNodes, reportCtx));
  if (stashNodes.length > 0) process.stderr.write(render(stashNodes, reportCtx));

  // Finalize operation record
  if (conflicted.length === 0 && failed.length === 0) {
    record.status = "completed";
    record.completedAt = new Date().toISOString();
    writeOperationRecord(wsDir, record);
  } else {
    info("Use 'arb pull --continue' to resume or 'arb pull --abort' to cancel");
  }

  // Phase 6: summary
  process.stderr.write("\n");
  const parts = [`Pulled ${plural(pullOk, "repo")}`];
  if (conflicted.length > 0) parts.push(`${conflicted.length} conflicted`);
  if (failed.length > 0) parts.push(`${failed.length} failed`);
  if (stashPopFailed.length > 0) parts.push(`${stashPopFailed.length} stash pop failed`);
  if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
  if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
  finishSummary(parts, conflicted.length > 0 || failed.length > 0 || stashPopFailed.length > 0);
}

export function assessPullRepo(
  status: RepoStatus,
  repoDir: string,
  branch: string,
  fetchFailed: string[],
  pullMode: "rebase" | "merge",
  autostash: boolean,
  headSha: string,
  includeWrongBranch?: boolean,
): PullAssessment {
  const defaultPullStrategy: PullStrategy = pullMode === "rebase" ? "rebase-pull" : "merge-pull";
  const base = {
    repo: status.name,
    repoDir,
    behind: 0,
    toPush: 0,
    rebased: 0,
    replaced: 0,
    squashed: 0,
    rebasedKnown: false,
    fromBaseCount: 0,
    pullMode,
    pullStrategy: defaultPullStrategy,
    branch,
    headSha,
    shallow: status.identity.shallow,
    wrongBranch: undefined as boolean | undefined,
    needsStash: undefined as boolean | undefined,
  };

  // Fetch failed for this repo
  if (fetchFailed.includes(status.name)) {
    return { ...base, outcome: "skip", skipReason: "fetch failed", skipFlag: "fetch-failed" };
  }

  // Operation in progress
  if (status.operation !== null) {
    return {
      ...base,
      outcome: "skip",
      skipReason: `${status.operation} in progress`,
      skipFlag: "operation-in-progress",
    };
  }

  // Branch check — detached or wrong branch
  if (status.identity.headMode.kind === "detached") {
    return { ...base, outcome: "skip", skipReason: "HEAD is detached", skipFlag: "detached-head" };
  }
  if (status.identity.headMode.branch !== branch) {
    if (!includeWrongBranch) {
      return {
        ...base,
        outcome: "skip",
        skipReason: `on branch ${status.identity.headMode.branch}, expected ${branch} (use --include-wrong-branch)`,
        skipFlag: "wrong-branch",
      };
    }
    base.branch = status.identity.headMode.branch;
    base.wrongBranch = true;
  }

  // No remote branch
  if (status.share.refMode === "noRef") {
    return { ...base, outcome: "skip", skipReason: "no remote branch", skipFlag: "no-share" };
  }

  // Remote branch gone
  if (status.share.refMode === "gone") {
    return { ...base, outcome: "skip", skipReason: "remote branch gone", skipFlag: "remote-gone" };
  }

  // Base branch merged into default — retarget before pulling
  if (status.base?.baseMergedIntoDefault != null) {
    const baseName = status.base.configuredRef ?? status.base.ref;
    return {
      ...base,
      outcome: "skip",
      skipReason: `base branch ${baseName} was merged into default (retarget first with 'arb retarget')`,
      skipFlag: "base-merged-into-default",
    };
  }

  // Already merged into base — but only skip if share has nothing to pull
  // (e.g. on main behind origin/main, merge is set but toPull > 0)
  if (status.base?.merge != null && (status.share.toPull ?? 0) === 0) {
    return {
      ...base,
      outcome: "skip",
      skipReason: `already merged into ${status.base.ref}`,
      skipFlag: "already-merged",
    };
  }

  // Check toPull count
  const toPull = status.share.toPull ?? 0;
  if (toPull === 0) {
    return { ...base, outcome: "up-to-date" };
  }

  // Dirty check — only reached for repos that need pulling
  const flags = computeFlags(status, branch);
  if (flags.isDirty) {
    if (!autostash) {
      return { ...base, outcome: "skip", skipReason: "uncommitted changes (use --autostash)", skipFlag: "dirty" };
    }
    // Only stash if there are staged or modified files (not untracked-only)
    if (status.local.staged > 0 || status.local.modified > 0) {
      base.needsStash = true;
    }
  }

  // Skip if all to-pull commits are outdated locally (rebased, replaced via reflog, or squashed)
  const rebased = status.share.outdated?.rebased ?? 0;
  const replaced = status.share.outdated?.replaced ?? 0;
  const squashed = status.share.outdated?.squashed ?? 0;
  const totalOutdated = rebased + replaced + squashed;
  if (totalOutdated > 0 && totalOutdated >= toPull) {
    const toPush = status.share.toPush ?? 0;
    const baseAhead = status.base?.ahead ?? toPush;
    const fromBaseCount = Math.max(0, toPush - baseAhead);
    return {
      ...base,
      outcome: "skip",
      behind: toPull,
      toPush,
      rebased,
      replaced,
      squashed,
      rebasedKnown: status.share.outdated != null,
      fromBaseCount,
      skipReason: "rebased locally (push --force, or pull --reset)",
      skipFlag: "rebased-locally",
    };
  }

  const toPush = status.share.toPush ?? 0;
  return {
    ...base,
    outcome: "will-pull",
    behind: toPull,
    toPush,
    rebased,
    replaced,
    squashed,
    rebasedKnown: status.share.outdated != null,
  };
}

export function formatPullPlan(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
  verbose?: boolean,
): string {
  const nodes = buildPullPlanNodes(assessments, remotesMap, verbose);
  const ctx = createRenderContext();
  return render(nodes, ctx);
}

export function buildPullPlanNodes(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
  verbose?: boolean,
): OutputNode[] {
  const nodes: OutputNode[] = [{ kind: "gap" }];

  const rows = assessments.map((a) => {
    let actionCell: Cell;
    if (a.outcome === "will-pull") {
      actionCell = pullActionCell(a, remotesMap);
    } else if (a.outcome === "up-to-date") {
      actionCell = upToDateCell();
    } else {
      actionCell = skipCell(a.skipReason ?? "", a.skipFlag);
    }

    let afterRow: OutputNode[] | undefined;
    if (verbose && a.outcome === "will-pull" && a.verbose?.commits && a.verbose.commits.length > 0) {
      const remotes = remotesMap.get(a.repo);
      const shareRemote = remotes?.share ?? "origin";
      const label = `Incoming from ${shareRemote}:`;
      afterRow = verboseCommitsToNodes(a.verbose.commits, a.verbose.totalCommits ?? a.verbose.commits.length, label, {
        diffStats: a.verbose.diffStats,
        conflictCommits: a.verbose.conflictCommits,
      });
    }

    return {
      cells: { repo: cell(a.repo), action: actionCell },
      afterRow,
    };
  });

  nodes.push({
    kind: "table",
    columns: [
      { header: "REPO", key: "repo" },
      { header: "ACTION", key: "action" },
    ],
    rows,
  });

  const wrongBranchCount = assessments.filter((a) => a.wrongBranch && a.outcome === "will-pull").length;
  if (wrongBranchCount > 0) {
    nodes.push({
      kind: "hint",
      cell: cell(`  hint: ${plural(wrongBranchCount, "repo")} on a different branch than the workspace`, "muted"),
    });
  }

  const shallowRepos = assessments.filter((a) => a.shallow);
  for (const a of shallowRepos) {
    nodes.push({
      kind: "message",
      level: "attention",
      text: `${a.repo} is a shallow clone; ahead/behind counts may be inaccurate`,
    });
  }

  nodes.push({ kind: "gap" });
  return nodes;
}

export function pullActionCell(a: PullAssessment, remotesMap: Map<string, RepoRemotes>): Cell {
  const remotes = remotesMap.get(a.repo);
  const forkText = remotes && remotes.base !== remotes.share ? ` \u2190 ${remotes.share}` : "";
  const strategy = a.pullStrategy ?? (a.pullMode === "rebase" ? "rebase-pull" : "merge-pull");

  if (strategy === "safe-reset" || strategy === "forced-reset") {
    const resetLabel = strategy === "forced-reset" ? "forced reset" : "safe reset";
    const target = a.safeReset?.target ?? `${remotes?.share ?? "origin"}/?`;
    let safeText = `${plural(a.behind, "commit")} to pull (${resetLabel} to ${target}`;
    if (a.safeReset?.reason) {
      safeText += `: ${a.safeReset.reason}`;
    }
    safeText += ")";
    let result = cell(safeText);
    const netNew = a.toPush - a.rebased - a.replaced - a.fromBaseCount;
    if (netNew > 0) {
      result = suffix(result, ` (${plural(netNew, "unpushed commit")} will be lost)`, "attention");
    }
    if (a.needsStash) {
      if (a.stashPopConflictFiles && a.stashPopConflictFiles.length > 0) {
        result = suffix(result, " (autostash, stash pop conflict likely)", "attention");
      } else if (a.stashPopConflictFiles) {
        result = suffix(result, " (autostash, stash pop conflict unlikely)");
      } else {
        result = suffix(result, " (autostash)");
      }
    }
    if (forkText) result = suffix(result, forkText);
    if (a.headSha) result = suffix(result, `  (HEAD ${a.headSha})`, "muted");
    return result;
  }

  const outdatedCount = a.rebased + a.replaced + a.squashed;
  const outdatedHint = outdatedCount > 0 ? `, ${outdatedCount} outdated` : "";
  const mergeType = a.pullMode === "merge" ? (a.toPush === 0 ? "fast-forward merge" : "three-way merge") : "";

  let conflictText = "";
  let conflictIsAttention = false;
  if (a.conflictPrediction === "conflict") {
    conflictText = ", conflict likely";
    conflictIsAttention = true;
  } else if (a.conflictPrediction === "no-conflict") {
    conflictText = ", no conflict";
  } else if (a.conflictPrediction === "clean") {
    conflictText = ", conflict unlikely";
  }

  let result: Cell;
  if (conflictIsAttention) {
    result = spans(
      {
        text: `${plural(a.behind, "commit")} to pull (${mergeType || a.pullMode}${outdatedHint}`,
        attention: "default",
      },
      { text: conflictText, attention: "attention" },
      { text: ")", attention: "default" },
    );
  } else {
    result = cell(`${plural(a.behind, "commit")} to pull (${mergeType || a.pullMode}${outdatedHint}${conflictText})`);
  }

  // Stash hint
  if (a.needsStash) {
    if (a.stashPopConflictFiles && a.stashPopConflictFiles.length > 0) {
      result = suffix(result, " (autostash, stash pop conflict likely)", "attention");
    } else if (a.stashPopConflictFiles) {
      result = suffix(result, " (autostash, stash pop conflict unlikely)");
    } else {
      result = suffix(result, " (autostash)");
    }
  }

  // Fork suffix
  if (forkText) result = suffix(result, forkText);

  // Wrong branch annotation
  if (a.wrongBranch) {
    result = suffix(result, ` (branch: ${a.branch})`, "attention");
  }

  // HEAD sha
  if (a.headSha) result = suffix(result, `  (HEAD ${a.headSha})`, "muted");

  return result;
}

export function resetRebasedSkips(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
): PullAssessment[] {
  return assessments.map((a) => {
    if (a.outcome !== "skip" || a.skipFlag !== "rebased-locally") return a;
    const shareRemote = remotesMap.get(a.repo)?.share;
    if (!shareRemote) return a;
    const netNew = a.toPush - a.rebased - a.replaced - a.fromBaseCount;
    return {
      ...withoutSkipFields(a),
      outcome: "will-pull",
      pullStrategy: netNew > 0 ? "forced-reset" : "safe-reset",
      safeReset: {
        ...a.safeReset,
        target: `${shareRemote}/${a.branch}`,
        reason: "discards local rebase",
      },
    };
  });
}

async function reviveRebasedSkipsForSafeReset(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
): Promise<PullAssessment[]> {
  return Promise.all(
    assessments.map(async (a) => {
      if (!(a.outcome === "skip" && a.skipFlag === "rebased-locally" && a.pullMode === "merge")) return a;
      const shareRemote = remotesMap.get(a.repo)?.share;
      if (!shareRemote) return a;
      const result = await evaluateSafeResetEligibility({
        repoDir: a.repoDir,
        shareRemote,
        branch: a.branch,
        toPush: a.toPush,
        rebased: a.rebased,
        replaced: a.replaced,
        squashed: a.squashed,
        rebasedKnown: a.rebasedKnown,
      });
      if (!result.eligible) return a;
      return {
        ...withoutSkipFields(a),
        outcome: "will-pull",
      };
    }),
  );
}

async function resolvePullStrategies(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
): Promise<PullAssessment[]> {
  return Promise.all(
    assessments.map(async (a) => {
      if (a.outcome !== "will-pull") return a;
      if (a.pullMode === "rebase") {
        return { ...a, pullStrategy: "rebase-pull" };
      }
      if (a.behind <= 0 || a.toPush <= 0) {
        return { ...a, pullStrategy: "merge-pull" };
      }
      const shareRemote = remotesMap.get(a.repo)?.share;
      if (!shareRemote) {
        return { ...a, pullStrategy: "merge-pull" };
      }
      const result = await evaluateSafeResetEligibility({
        repoDir: a.repoDir,
        shareRemote,
        branch: a.branch,
        toPush: a.toPush,
        rebased: a.rebased,
        replaced: a.replaced,
        squashed: a.squashed,
        rebasedKnown: a.rebasedKnown,
      });
      if (result.eligible) {
        return {
          ...a,
          pullStrategy: "safe-reset",
          safeReset: {
            ...a.safeReset,
            reason: result.reason,
            target: `${shareRemote}/${a.branch}`,
            oldRemoteTip: result.oldTipShort,
          },
        };
      }
      if (result.blockedBy) {
        return {
          ...a,
          pullStrategy: "merge-pull",
          safeReset: { ...a.safeReset, blockedBy: result.blockedBy },
        };
      }
      return { ...a, pullStrategy: "merge-pull" };
    }),
  );
}

async function predictPullConflicts(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
): Promise<PullAssessment[]> {
  return Promise.all(
    assessments.map(async (a) => {
      if (a.outcome !== "will-pull") return a;
      const strategy = a.pullStrategy ?? (a.pullMode === "rebase" ? "rebase-pull" : "merge-pull");
      if (strategy === "safe-reset" || strategy === "forced-reset") {
        return { ...a, conflictPrediction: "no-conflict" };
      }
      const shareRemote = remotesMap.get(a.repo)?.share;
      if (!shareRemote) return a;
      const ref = `${shareRemote}/${a.branch}`;
      let conflictPrediction: PullAssessment["conflictPrediction"];
      let verbose = a.verbose;
      if (a.behind > 0 && a.toPush > 0) {
        const prediction = await predictMergeConflict(a.repoDir, ref);
        conflictPrediction = prediction === null ? null : prediction.hasConflict ? "conflict" : "clean";
        if (prediction?.hasConflict && a.pullMode === "rebase") {
          const conflictCommits = await predictRebaseConflictCommits(a.repoDir, ref);
          if (conflictCommits.length > 0) {
            verbose = { ...verbose, conflictCommits };
          }
        }
      } else {
        conflictPrediction = "no-conflict";
      }
      let stashPopConflictFiles = a.stashPopConflictFiles;
      if (a.needsStash) {
        const stashPrediction = await predictStashPopConflict(a.repoDir, ref);
        stashPopConflictFiles = stashPrediction.overlapping;
      }
      return { ...a, conflictPrediction, stashPopConflictFiles, verbose };
    }),
  );
}

interface SafeResetEligibilityInput {
  repoDir: string;
  shareRemote: string;
  branch: string;
  toPush: number;
  rebased: number;
  replaced: number;
  squashed: number;
  rebasedKnown: boolean;
}

interface SafeResetEligibilityResult {
  eligible: boolean;
  reason?: string;
  blockedBy?: string;
  oldTipShort?: string;
}

export async function evaluateSafeResetEligibility(
  input: SafeResetEligibilityInput,
  gitRunner: typeof gitLocal = gitLocal,
): Promise<SafeResetEligibilityResult> {
  const remoteRef = `${input.shareRemote}/${input.branch}`;
  const oldTipResult = await gitRunner(input.repoDir, "rev-parse", `${remoteRef}@{1}`);
  if (oldTipResult.exitCode !== 0) {
    return { eligible: false, blockedBy: "previous remote tip unavailable" };
  }
  const oldTip = oldTipResult.stdout.trim();
  if (!oldTip) {
    return { eligible: false, blockedBy: "previous remote tip unavailable" };
  }

  const currentTipResult = await gitRunner(input.repoDir, "rev-parse", remoteRef);
  if (currentTipResult.exitCode !== 0) {
    return { eligible: false, blockedBy: "current remote tip unavailable" };
  }
  const currentTip = currentTipResult.stdout.trim();
  if (!currentTip) {
    return { eligible: false, blockedBy: "current remote tip unavailable" };
  }
  if (oldTip === currentTip) {
    return { eligible: false, blockedBy: "no remote rewrite detected" };
  }

  const ancestorResult = await gitRunner(input.repoDir, "merge-base", "--is-ancestor", oldTip, "HEAD");
  if (ancestorResult.exitCode !== 0) {
    return { eligible: false, blockedBy: "HEAD not based on previous remote tip" };
  }

  const uniqueResult = await gitRunner(input.repoDir, "rev-list", "--count", `${oldTip}..HEAD`);
  if (uniqueResult.exitCode !== 0) {
    return { eligible: false, blockedBy: "unable to verify local commit ancestry" };
  }
  const uniqueCount = Number.parseInt(uniqueResult.stdout.trim(), 10);
  if (!Number.isFinite(uniqueCount)) {
    return { eligible: false, blockedBy: "unable to verify local commit ancestry" };
  }
  if (uniqueCount > 0) {
    return { eligible: false, blockedBy: "local commits exist beyond previous remote tip" };
  }

  if (!input.rebasedKnown) {
    return { eligible: false, blockedBy: "rebased-commit evidence unavailable" };
  }
  // When squashed > 0, cumulative patch-ids match — all local content is accounted for.
  const accountedFor = input.squashed > 0 ? input.toPush : input.rebased + input.replaced;
  if (input.toPush - accountedFor > 0) {
    return { eligible: false, blockedBy: "local net-new commits detected" };
  }

  return {
    eligible: true,
    reason: "remote rewritten, no local commits to preserve",
    oldTipShort: oldTip.slice(0, 7),
  };
}

function isConflictResult(stdout: string, stderr: string): boolean {
  const combined = `${stdout}\n${stderr}`;
  return combined.split("\n").some((line) => line.startsWith("CONFLICT"));
}

function pullStrategyLabel(strategy: PullStrategy): string {
  switch (strategy) {
    case "rebase-pull":
      return "rebase";
    case "safe-reset":
      return "safe-reset";
    case "forced-reset":
      return "forced-reset";
    default:
      return "merge";
  }
}

function buildPullFailureReport(entries: PullFailure[]): OutputNode[] {
  if (entries.length === 0) return [];
  const nodes: OutputNode[] = [
    { kind: "gap" },
    { kind: "message", level: "default", text: `${entries.length} repo(s) failed:` },
  ];
  for (const entry of entries) {
    const combined = `${entry.stdout}\n${entry.stderr}`
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const hint =
      entry.exitCode === 124
        ? "# check your network, then re-run: arb pull (adjust timeout with ARB_PULL_TIMEOUT)"
        : "# fix the issue, then re-run: arb pull";
    nodes.push(
      { kind: "gap" },
      {
        kind: "section",
        header: cell(entry.assessment.repo),
        items: [
          cell(`pull failed during ${entry.action}`),
          ...combined.slice(0, 3).map((line) => cell(line, "muted")),
          cell(`cd ${entry.assessment.repo}`),
          cell(hint),
        ],
      },
    );
  }
  return nodes;
}

async function gatherPullVerboseCommits(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
): Promise<PullAssessment[]> {
  return Promise.all(
    assessments.map(async (a) => {
      if (a.outcome !== "will-pull") return a;
      const shareRemote = remotesMap.get(a.repo)?.share;
      if (!shareRemote) return a;
      const ref = `${shareRemote}/${a.branch}`;
      const commits = await getCommitsBetweenFull(a.repoDir, "HEAD", ref);
      const total = commits.length;
      return {
        ...a,
        verbose: {
          ...a.verbose,
          commits: commits.slice(0, VERBOSE_COMMIT_LIMIT).map((c) => ({
            shortHash: c.shortHash,
            subject: c.subject,
          })),
          totalCommits: total,
          diffStats: (await getDiffShortstat(a.repoDir, "HEAD", ref)) ?? undefined,
        },
      };
    }),
  );
}

async function detectPullMode(repoDir: string, branch: string): Promise<"rebase" | "merge"> {
  const branchRebase = await gitLocal(repoDir, "config", "--get", `branch.${branch}.rebase`);
  if (branchRebase.exitCode === 0) {
    return branchRebase.stdout.trim() !== "false" ? "rebase" : "merge";
  }
  const pullRebase = await gitLocal(repoDir, "config", "--get", "pull.rebase");
  if (pullRebase.exitCode === 0) {
    return pullRebase.stdout.trim() !== "false" ? "rebase" : "merge";
  }
  return "merge";
}
