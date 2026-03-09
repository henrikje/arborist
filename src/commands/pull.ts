import { basename } from "node:path";
import type { Command } from "commander";
import { ArbError, readWorkspaceConfig } from "../lib/core";
import type { ArbContext } from "../lib/core";
import {
  GitCache,
  assertMinimumGitVersion,
  getCommitsBetweenFull,
  getDiffShortstat,
  getShortHead,
  git,
  gitWithTimeout,
  networkTimeout,
  predictMergeConflict,
  predictRebaseConflictCommits,
  predictStashPopConflict,
} from "../lib/git";
import type { RepoRemotes } from "../lib/git";
import { type RenderContext, finishSummary, render } from "../lib/render";
import type { Cell, OutputNode } from "../lib/render";
import { buildConflictReport, buildStashPopFailureReport, skipCell, upToDateCell } from "../lib/render";
import { VERBOSE_COMMIT_LIMIT, verboseCommitsToNodes } from "../lib/render";
import { cell, spans, suffix } from "../lib/render";
import type { SkipFlag } from "../lib/status";
import { type RepoStatus, computeFlags, gatherRepoStatus, repoMatchesWhere, resolveWhereFilter } from "../lib/status";
import { confirmOrExit, runPlanFlow } from "../lib/sync";
import {
  dryRunNotice,
  error,
  info,
  inlineResult,
  inlineStart,
  isTTY,
  plural,
  readNamesFromStdin,
  yellow,
} from "../lib/terminal";
import { requireBranch, requireWorkspace, resolveRepoSelection, workspaceRepoDirs } from "../lib/workspace";

type PullStrategy = "rebase-pull" | "merge-pull" | "safe-reset" | "forced-reset";

interface PullFailure {
  assessment: PullAssessment;
  exitCode: number;
  stdout: string;
  stderr: string;
  action: string;
}

export interface PullAssessment {
  repo: string;
  repoDir: string;
  outcome: "will-pull" | "up-to-date" | "skip";
  skipReason?: string;
  skipFlag?: SkipFlag;
  behind: number;
  toPush: number;
  rebased: number;
  rebasedKnown: boolean;
  fromBaseCount: number;
  pullMode: "rebase" | "merge";
  pullStrategy?: PullStrategy;
  headSha: string;
  safeResetReason?: string;
  safeResetBlockedBy?: string;
  safeResetTarget?: string;
  oldRemoteTip?: string;
  conflictPrediction?: "no-conflict" | "clean" | "conflict" | null;
  needsStash?: boolean;
  stashPopConflictFiles?: string[];
  commits?: { shortHash: string; subject: string }[];
  totalCommits?: number;
  diffStats?: { files: number; insertions: number; deletions: number };
  conflictCommits?: { shortHash: string; files: string[] }[];
}

export function registerPullCommand(program: Command, getCtx: () => ArbContext): void {
  program
    .command("pull [repos...]")
    .option("-f, --force", "Reset to remote tip, overriding rebased-locally skip")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("--rebase", "Pull with rebase")
    .option("--merge", "Pull with merge")
    .option("--autostash", "Stash uncommitted changes before pull, re-apply after")
    .option("-v, --verbose", "Show incoming commits in the plan")
    .option("-w, --where <filter>", "Only pull repos matching status filter (comma = OR, + = AND, ^ = negate)")
    .summary("Pull the feature branch from the share remote")
    .description(
      "Pull the feature branch for all repos, or only the named repos. Pulls from the share remote (origin by default, or as configured for fork workflows). Fetches in parallel, then shows a plan and asks for confirmation before pulling. Repos with uncommitted changes are skipped unless --autostash is used. Repos where the remote branch has been deleted are skipped. If any repos conflict, arb continues with the remaining repos and reports all conflicts at the end. When a remote branch was rebased and local has no unique commits to preserve, arb may safely reset to the rewritten remote tip instead of attempting a three-way merge. Use --force to override the rebased-locally skip and reset to the remote tip, discarding the local rebase. Use --verbose to show the incoming commits in the plan. Use --autostash to stash uncommitted changes before pulling and re-apply them after. Use --where to filter repos by status flags. See 'arb help where' for filter syntax.\n\nThe pull mode (rebase or merge) is determined per-repo from git config (branch.<name>.rebase, then pull.rebase), defaulting to merge if neither is set. Use --rebase or --merge to override for all repos.\n\nSee 'arb help remotes' for remote role resolution.",
    )
    .action(
      async (
        repoArgs: string[],
        options: {
          force?: boolean;
          rebase?: boolean;
          merge?: boolean;
          yes?: boolean;
          dryRun?: boolean;
          verbose?: boolean;
          autostash?: boolean;
          where?: string;
        },
      ) => {
        if (options.rebase && options.merge) {
          error("Cannot use both --rebase and --merge");
          throw new ArbError("Cannot use both --rebase and --merge");
        }

        const where = resolveWhereFilter(options);
        const flagMode: "rebase" | "merge" | undefined = options.rebase
          ? "rebase"
          : options.merge
            ? "merge"
            : undefined;
        const ctx = getCtx();
        const { wsDir, workspace } = requireWorkspace(ctx);
        const branch = await requireBranch(wsDir, workspace);

        let repoNames = repoArgs;
        if (repoNames.length === 0) {
          const stdinNames = await readNamesFromStdin();
          if (stdinNames.length > 0) repoNames = stdinNames;
        }
        const selectedRepos = resolveRepoSelection(wsDir, repoNames);
        const selectedSet = new Set(selectedRepos);
        const cache = new GitCache();
        await assertMinimumGitVersion(cache);
        const remotesMap = await cache.resolveRemotesMap(selectedRepos, ctx.reposDir);
        const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;

        // Phase 1: fetch
        const allFetchDirs = workspaceRepoDirs(wsDir);
        const allRepos = allFetchDirs.map((d) => basename(d));
        const repos = allRepos.filter((r) => selectedSet.has(r));
        const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
        const autostash = options.autostash === true;

        // Phase 2: assess
        const assess = async (fetchFailed: string[]) => {
          const assessments = await Promise.all(
            repos.map(async (repo) => {
              const repoDir = `${wsDir}/${repo}`;
              const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, remotesMap.get(repo), cache);
              if (where) {
                const flags = computeFlags(status, branch);
                if (!repoMatchesWhere(flags, where)) return null;
              }
              const headSha = await getShortHead(repoDir);
              const pullMode = flagMode ?? (await detectPullMode(repoDir, branch));
              return assessPullRepo(status, repoDir, branch, fetchFailed, pullMode, autostash, headSha);
            }),
          );
          return assessments.filter((a): a is PullAssessment => a !== null);
        };

        const postAssess = async (nextAssessments: PullAssessment[]) => {
          await reviveRebasedSkipsForSafeReset(nextAssessments, remotesMap, branch);
          await resolvePullStrategies(nextAssessments, remotesMap, branch);
          if (options.force) {
            forceRebasedSkips(nextAssessments, remotesMap, branch);
          }
          await predictPullConflicts(nextAssessments, remotesMap, branch);
          if (options.verbose) {
            await gatherPullVerboseCommits(nextAssessments, remotesMap, branch);
          }
        };

        const assessments = await runPlanFlow({
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

        // Phase 4: execute
        let pullOk = 0;
        const pullTimeout = networkTimeout("ARB_PULL_TIMEOUT", 120);
        const conflicted: { assessment: PullAssessment; stdout: string; stderr: string }[] = [];
        const failed: PullFailure[] = [];
        const stashPopFailed: PullAssessment[] = [];

        for (const a of willPull) {
          const strategy = a.pullStrategy ?? (a.pullMode === "rebase" ? "rebase-pull" : "merge-pull");
          inlineStart(a.repo, `pulling (${pullStrategyLabel(strategy)})`);
          const pullRemote = remotesMap.get(a.repo)?.share;
          if (!pullRemote) continue;

          if (strategy === "rebase-pull") {
            // Rebase mode: pass --autostash to git pull --rebase when needed
            const pullArgs = a.needsStash
              ? ["pull", "--rebase", "--autostash", pullRemote, branch]
              : ["pull", "--rebase", pullRemote, branch];
            const pullResult = await gitWithTimeout(a.repoDir, pullTimeout, pullArgs);
            if (pullResult.exitCode === 0) {
              inlineResult(a.repo, `pulled ${plural(a.behind, "commit")} (${a.pullMode})`);
              pullOk++;
            } else {
              if (isConflictResult(pullResult.stdout, pullResult.stderr)) {
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
            // Reset to remote tip. Safe-reset: auto-detected, no data loss. Forced-reset: user override via --force.
            if (a.needsStash) {
              await git(a.repoDir, "stash", "push", "-m", "arb: autostash before pull");
            }
            const target = a.safeResetTarget ?? `${pullRemote}/${branch}`;
            const resetLabel = strategy === "forced-reset" ? "forced reset" : "safe reset";
            const resetResult = await git(a.repoDir, "reset", "--hard", target);
            if (resetResult.exitCode === 0) {
              let stashPopOk = true;
              if (a.needsStash) {
                const popResult = await git(a.repoDir, "stash", "pop");
                if (popResult.exitCode !== 0) {
                  stashPopOk = false;
                  stashPopFailed.push(a);
                }
              }
              let doneMsg = `${resetLabel} to ${target}`;
              if (!stashPopOk) {
                doneMsg += ` ${yellow("(stash pop failed)")}`;
              }
              inlineResult(a.repo, doneMsg);
              pullOk++;
            } else {
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
            // Merge mode: manual stash cycle when needed
            if (a.needsStash) {
              await git(a.repoDir, "stash", "push", "-m", "arb: autostash before pull");
            }
            const pullResult = await gitWithTimeout(a.repoDir, pullTimeout, [
              "pull",
              "--no-rebase",
              pullRemote,
              branch,
            ]);
            if (pullResult.exitCode === 0) {
              let stashPopOk = true;
              if (a.needsStash) {
                const popResult = await git(a.repoDir, "stash", "pop");
                if (popResult.exitCode !== 0) {
                  stashPopOk = false;
                  stashPopFailed.push(a);
                }
              }
              let doneMsg = `pulled ${plural(a.behind, "commit")} (${a.pullMode})`;
              if (!stashPopOk) {
                doneMsg += ` ${yellow("(stash pop failed)")}`;
              }
              inlineResult(a.repo, doneMsg);
              pullOk++;
            } else {
              // Do NOT pop stash if pull conflicted
              if (isConflictResult(pullResult.stdout, pullResult.stderr)) {
                inlineResult(a.repo, yellow("conflict"));
                conflicted.push({ assessment: a, stdout: pullResult.stdout, stderr: pullResult.stderr });
              } else {
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

        const reportCtx = { tty: isTTY() };
        if (conflictNodes.length > 0) process.stderr.write(render(conflictNodes, reportCtx));
        if (failureNodes.length > 0) process.stderr.write(render(failureNodes, reportCtx));
        if (stashNodes.length > 0) process.stderr.write(render(stashNodes, reportCtx));

        // Phase 5: summary
        process.stderr.write("\n");
        const parts = [`Pulled ${plural(pullOk, "repo")}`];
        if (conflicted.length > 0) parts.push(`${conflicted.length} conflicted`);
        if (failed.length > 0) parts.push(`${failed.length} failed`);
        if (stashPopFailed.length > 0) parts.push(`${stashPopFailed.length} stash pop failed`);
        if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
        if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
        finishSummary(parts, conflicted.length > 0 || failed.length > 0 || stashPopFailed.length > 0);
      },
    );
}

export function assessPullRepo(
  status: RepoStatus,
  repoDir: string,
  branch: string,
  fetchFailed: string[],
  pullMode: "rebase" | "merge",
  autostash: boolean,
  headSha: string,
): PullAssessment {
  const base: PullAssessment = {
    repo: status.name,
    repoDir,
    outcome: "skip",
    behind: 0,
    toPush: 0,
    rebased: 0,
    rebasedKnown: false,
    fromBaseCount: 0,
    pullMode,
    pullStrategy: pullMode === "rebase" ? "rebase-pull" : "merge-pull",
    headSha,
  };

  // Fetch failed for this repo
  if (fetchFailed.includes(status.name)) {
    return { ...base, skipReason: "fetch failed", skipFlag: "fetch-failed" };
  }

  // Branch check — detached or drifted
  if (status.identity.headMode.kind === "detached") {
    return { ...base, skipReason: "HEAD is detached", skipFlag: "detached-head" };
  }
  if (status.identity.headMode.branch !== branch) {
    return {
      ...base,
      skipReason: `on branch ${status.identity.headMode.branch}, expected ${branch}`,
      skipFlag: "drifted",
    };
  }

  // Dirty check
  const flags = computeFlags(status, branch);
  if (flags.isDirty) {
    if (!autostash) {
      return { ...base, skipReason: "uncommitted changes (use --autostash)", skipFlag: "dirty" };
    }
    // Only stash if there are staged or modified files (not untracked-only)
    if (status.local.staged > 0 || status.local.modified > 0) {
      base.needsStash = true;
    }
  }

  // No remote branch
  if (status.share.refMode === "noRef") {
    return { ...base, skipReason: "no remote branch", skipFlag: "not-pushed" };
  }

  // Remote branch gone
  if (status.share.refMode === "gone") {
    return { ...base, skipReason: "remote branch gone", skipFlag: "remote-gone" };
  }

  // Base branch merged into default — retarget before pulling
  if (status.base?.baseMergedIntoDefault != null) {
    const baseName = status.base.configuredRef ?? status.base.ref;
    return {
      ...base,
      skipReason: `base branch ${baseName} was merged into default (retarget first with 'arb rebase --retarget')`,
      skipFlag: "base-merged-into-default",
    };
  }

  // Already merged into base — but only skip if share has nothing to pull
  // (e.g. on main behind origin/main, mergedIntoBase is set but toPull > 0)
  if (status.base?.mergedIntoBase != null && (status.share.toPull ?? 0) === 0) {
    return { ...base, skipReason: `already merged into ${status.base.ref}`, skipFlag: "already-merged" };
  }

  // Check toPull count
  const toPull = status.share.toPull ?? 0;
  if (toPull === 0) {
    return { ...base, outcome: "up-to-date" };
  }

  // Skip if all to-pull commits are rebased locally
  const rebased = status.share.rebased ?? 0;
  if (rebased > 0 && rebased >= toPull) {
    const toPush = status.share.toPush ?? 0;
    const baseAhead = status.base?.ahead ?? toPush;
    const fromBaseCount = Math.max(0, toPush - baseAhead);
    return {
      ...base,
      behind: toPull,
      toPush,
      rebased,
      rebasedKnown: status.share.rebased != null,
      fromBaseCount,
      skipReason: "rebased locally (push --force, or pull --force to reset)",
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
    rebasedKnown: status.share.rebased != null,
  };
}

export function formatPullPlan(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
  verbose?: boolean,
): string {
  const nodes = buildPullPlanNodes(assessments, remotesMap, verbose);
  const envCols = Number(process.env.COLUMNS);
  const termCols = process.stdout.columns ?? (Number.isFinite(envCols) ? envCols : 0);
  const ctx: RenderContext = { tty: isTTY(), terminalWidth: termCols > 0 ? termCols : undefined };
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
    if (verbose && a.outcome === "will-pull" && a.commits && a.commits.length > 0) {
      const remotes = remotesMap.get(a.repo);
      const shareRemote = remotes?.share ?? "origin";
      const label = `Incoming from ${shareRemote}:`;
      afterRow = verboseCommitsToNodes(a.commits, a.totalCommits ?? a.commits.length, label, {
        diffStats: a.diffStats,
        conflictCommits: a.conflictCommits,
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

  nodes.push({ kind: "gap" });
  return nodes;
}

export function pullActionCell(a: PullAssessment, remotesMap: Map<string, RepoRemotes>): Cell {
  const remotes = remotesMap.get(a.repo);
  const forkText = remotes && remotes.base !== remotes.share ? ` \u2190 ${remotes.share}` : "";
  const strategy = a.pullStrategy ?? (a.pullMode === "rebase" ? "rebase-pull" : "merge-pull");

  if (strategy === "safe-reset" || strategy === "forced-reset") {
    const resetLabel = strategy === "forced-reset" ? "forced reset" : "safe reset";
    const target = a.safeResetTarget ?? `${remotes?.share ?? "origin"}/?`;
    let safeText = `${plural(a.behind, "commit")} to pull (${resetLabel} to ${target}`;
    if (a.safeResetReason) {
      safeText += `: ${a.safeResetReason}`;
    }
    safeText += ")";
    let result = cell(safeText);
    const netNew = a.toPush - a.rebased - a.fromBaseCount;
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

  const rebasedHint = a.rebased > 0 ? `, ${a.rebased} rebased` : "";
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
      { text: `${plural(a.behind, "commit")} to pull (${mergeType || a.pullMode}${rebasedHint}`, attention: "default" },
      { text: conflictText, attention: "attention" },
      { text: ")", attention: "default" },
    );
  } else {
    result = cell(`${plural(a.behind, "commit")} to pull (${mergeType || a.pullMode}${rebasedHint}${conflictText})`);
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

  // HEAD sha
  if (a.headSha) result = suffix(result, `  (HEAD ${a.headSha})`, "muted");

  return result;
}

export function forceRebasedSkips(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
  branch: string,
): void {
  for (const a of assessments) {
    if (a.outcome !== "skip" || a.skipFlag !== "rebased-locally") continue;
    const shareRemote = remotesMap.get(a.repo)?.share;
    if (!shareRemote) continue;
    a.outcome = "will-pull";
    a.skipReason = undefined;
    a.skipFlag = undefined;
    const netNew = a.toPush - a.rebased - a.fromBaseCount;
    a.pullStrategy = netNew > 0 ? "forced-reset" : "safe-reset";
    a.safeResetTarget = `${shareRemote}/${branch}`;
    a.safeResetReason = "discards local rebase";
  }
}

async function reviveRebasedSkipsForSafeReset(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
  branch: string,
): Promise<void> {
  await Promise.all(
    assessments
      .filter((a) => a.outcome === "skip" && a.skipFlag === "rebased-locally" && a.pullMode === "merge")
      .map(async (a) => {
        const shareRemote = remotesMap.get(a.repo)?.share;
        if (!shareRemote) return;
        const result = await evaluateSafeResetEligibility({
          repoDir: a.repoDir,
          shareRemote,
          branch,
          toPush: a.toPush,
          rebased: a.rebased,
          rebasedKnown: a.rebasedKnown,
        });
        if (!result.eligible) return;
        a.outcome = "will-pull";
        a.skipReason = undefined;
        a.skipFlag = undefined;
      }),
  );
}

async function resolvePullStrategies(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
  branch: string,
): Promise<void> {
  await Promise.all(
    assessments
      .filter((a) => a.outcome === "will-pull")
      .map(async (a) => {
        if (a.pullMode === "rebase") {
          a.pullStrategy = "rebase-pull";
          return;
        }
        a.pullStrategy = "merge-pull";
        if (a.behind <= 0 || a.toPush <= 0) return;
        const shareRemote = remotesMap.get(a.repo)?.share;
        if (!shareRemote) return;
        const result = await evaluateSafeResetEligibility({
          repoDir: a.repoDir,
          shareRemote,
          branch,
          toPush: a.toPush,
          rebased: a.rebased,
          rebasedKnown: a.rebasedKnown,
        });
        if (result.eligible) {
          a.pullStrategy = "safe-reset";
          a.safeResetReason = result.reason;
          a.safeResetTarget = `${shareRemote}/${branch}`;
          a.oldRemoteTip = result.oldTipShort;
        } else if (result.blockedBy) {
          a.safeResetBlockedBy = result.blockedBy;
        }
      }),
  );
}

async function predictPullConflicts(
  assessments: PullAssessment[],
  remotesMap: Map<string, RepoRemotes>,
  branch: string,
): Promise<void> {
  await Promise.all(
    assessments
      .filter((a) => a.outcome === "will-pull")
      .map(async (a) => {
        const strategy = a.pullStrategy ?? (a.pullMode === "rebase" ? "rebase-pull" : "merge-pull");
        if (strategy === "safe-reset" || strategy === "forced-reset") {
          a.conflictPrediction = "no-conflict";
          return;
        }
        const shareRemote = remotesMap.get(a.repo)?.share;
        if (!shareRemote) return;
        const ref = `${shareRemote}/${branch}`;
        if (a.behind > 0 && a.toPush > 0) {
          const prediction = await predictMergeConflict(a.repoDir, ref);
          a.conflictPrediction = prediction === null ? null : prediction.hasConflict ? "conflict" : "clean";
          // Per-commit conflict detail for rebase-mode pulls
          if (prediction?.hasConflict && a.pullMode === "rebase") {
            const conflictCommits = await predictRebaseConflictCommits(a.repoDir, ref);
            if (conflictCommits.length > 0) a.conflictCommits = conflictCommits;
          }
        } else {
          a.conflictPrediction = "no-conflict";
        }
        if (a.needsStash) {
          const stashPrediction = await predictStashPopConflict(a.repoDir, ref);
          a.stashPopConflictFiles = stashPrediction.overlapping;
        }
      }),
  );
}

interface SafeResetEligibilityInput {
  repoDir: string;
  shareRemote: string;
  branch: string;
  toPush: number;
  rebased: number;
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
  gitRunner: typeof git = git,
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
  if (input.toPush - input.rebased > 0) {
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
  branch: string,
): Promise<void> {
  await Promise.all(
    assessments
      .filter((a) => a.outcome === "will-pull")
      .map(async (a) => {
        const shareRemote = remotesMap.get(a.repo)?.share;
        if (!shareRemote) return;
        const ref = `${shareRemote}/${branch}`;
        const commits = await getCommitsBetweenFull(a.repoDir, "HEAD", ref);
        const total = commits.length;
        a.commits = commits.slice(0, VERBOSE_COMMIT_LIMIT).map((c) => ({
          shortHash: c.shortHash,
          subject: c.subject,
        }));
        a.totalCommits = total;

        // Diff stats
        a.diffStats = (await getDiffShortstat(a.repoDir, "HEAD", ref)) ?? undefined;
      }),
  );
}

async function detectPullMode(repoDir: string, branch: string): Promise<"rebase" | "merge"> {
  const branchRebase = await git(repoDir, "config", "--get", `branch.${branch}.rebase`);
  if (branchRebase.exitCode === 0) {
    return branchRebase.stdout.trim() !== "false" ? "rebase" : "merge";
  }
  const pullRebase = await git(repoDir, "config", "--get", "pull.rebase");
  if (pullRebase.exitCode === 0) {
    return pullRebase.stdout.trim() !== "false" ? "rebase" : "merge";
  }
  return "merge";
}
