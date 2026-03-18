import { basename } from "node:path";
import { matchDivergedCommits } from "../analysis/commit-matching";
import {
  predictMergeConflict,
  predictRebaseConflictCommits,
  predictStashPopConflict,
} from "../analysis/conflict-prediction";
import type { CommandContext } from "../core/command-action";
import { readWorkspaceConfig, writeWorkspaceConfig } from "../core/config";
import { ArbError } from "../core/errors";
import { getCommitsBetweenFull, getDiffShortstat, getMergeBase, gitLocal } from "../git/git";
import type { GitCache } from "../git/git-cache";
import { buildConflictReport, buildStashPopFailureReport } from "../render/conflict-report";
import { type IntegrateActionDesc, integrateActionCell } from "../render/integrate-cells";
import { formatBranchGraph } from "../render/integrate-graph";
import type { Cell, OutputNode } from "../render/model";
import { cell, suffix } from "../render/model";
import { skipCell, upToDateCell } from "../render/plan-format";
import { type RenderContext, finishSummary, render } from "../render/render";
import { verboseCommitsToNodes } from "../render/status-verbose";
import { RETARGET_EXEMPT_SKIPS } from "../status/skip-flags";
import { resolveWhereFilter } from "../status/where";
import { dryRunNotice, error, info, inlineResult, inlineStart, plural, yellow } from "../terminal/output";
import { shouldColor } from "../terminal/tty";
import { rejectExplicitBaseRemotePrefix, resolveWorkspaceBaseResolution } from "../workspace/base";
import { workspaceBranch } from "../workspace/branch";
import { requireBranch, requireWorkspace } from "../workspace/context";
import { resolveRepoSelection, workspaceRepoDirs } from "../workspace/repos";
import { buildCachedStatusAssess } from "./assess-with-cache";
import { type IntegrateMode, assessIntegrateRepo } from "./classify-integrate";
import { VERBOSE_COMMIT_LIMIT } from "./constants";
import { confirmOrExit, runPlanFlow } from "./mutation-flow";
import { resolveDefaultFetch } from "./parallel-fetch";
export type { RepoAssessment } from "./types";
import type { RepoAssessment } from "./types";

export async function integrate(
  ctx: CommandContext,
  mode: IntegrateMode,
  options: {
    fetch?: boolean;
    yes?: boolean;
    dryRun?: boolean;
    retarget?: string | boolean;
    autostash?: boolean;
    includeWrongBranch?: boolean;
    verbose?: boolean;
    graph?: boolean;
    where?: string;
  },
  repoArgs: string[],
): Promise<void> {
  const verb = mode === "rebase" ? "Rebase" : "Merge";
  const verbed = mode === "rebase" ? "Rebased" : "Merged";
  const retargetExplicit = typeof options.retarget === "string" && mode === "rebase" ? options.retarget : null;
  const retarget = (options.retarget === true || retargetExplicit !== null) && mode === "rebase";

  // Phase 1: context & repo selection
  const { wsDir, workspace } = requireWorkspace(ctx);
  const branch = await requireBranch(wsDir, workspace);
  const cache = ctx.cache;
  const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;
  const workspaceBaseResolution = retargetExplicit
    ? await resolveWorkspaceBaseResolution(wsDir, ctx.reposDir, cache)
    : null;
  const normalizedRetargetExplicit =
    retargetExplicit && workspaceBaseResolution
      ? rejectExplicitBaseRemotePrefix(retargetExplicit, workspaceBaseResolution)
      : retargetExplicit;

  if (normalizedRetargetExplicit) {
    if (normalizedRetargetExplicit === branch) {
      error(`Cannot retarget to ${normalizedRetargetExplicit} — that is the current feature branch.`);
      throw new ArbError(`Cannot retarget to ${normalizedRetargetExplicit} — that is the current feature branch.`);
    }
    if (normalizedRetargetExplicit === configBase) {
      error(`Cannot retarget to ${normalizedRetargetExplicit} — that is already the configured base branch.`);
      throw new ArbError(
        `Cannot retarget to ${normalizedRetargetExplicit} — that is already the configured base branch.`,
      );
    }
  }

  const selectedRepos = resolveRepoSelection(wsDir, repoArgs);
  const where = resolveWhereFilter(options);

  // Resolve remotes for all repos
  const remotesMap = await cache.resolveRemotesMap(selectedRepos, ctx.reposDir);

  // Phase 2: fetch
  const shouldFetch = resolveDefaultFetch(options.fetch);
  const allFetchDirs = workspaceRepoDirs(wsDir);
  const selectedSet = new Set(selectedRepos);
  const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
  const repos = fetchDirs.map((d) => basename(d));

  const autostash = options.autostash === true;
  const includeWrongBranch = options.includeWrongBranch === true;
  const assess = buildCachedStatusAssess<RepoAssessment>({
    repos: selectedRepos,
    wsDir,
    reposDir: ctx.reposDir,
    branch,
    configBase,
    remotesMap,
    cache,
    analysisCache: ctx.analysisCache,
    where,
    classify: ({ repoDir, status, fetchFailed }) => {
      const repoPath = `${ctx.reposDir}/${basename(repoDir)}`;
      return assessIntegrateRepo(
        status,
        repoDir,
        branch,
        fetchFailed,
        {
          retarget,
          retargetExplicit: normalizedRetargetExplicit,
          autostash,
          includeWrongBranch,
          cache,
          mode,
        },
        {
          remoteBranchExists: (_dir, b, r) => cache.remoteBranchExists(repoPath, b, r),
          branchExistsLocally: (_dir, b) => cache.branchExistsLocally(repoPath, b),
        },
      );
    },
  });

  const postAssess = async (nextAssessments: RepoAssessment[]) => {
    await predictIntegrateConflicts(nextAssessments, mode);
    if (options.verbose) {
      await gatherIntegrateVerboseCommits(nextAssessments);
    }
    if (options.graph) {
      await gatherIntegrateGraphData(nextAssessments, !!options.verbose, cache, ctx.reposDir);
    }
    return nextAssessments;
  };

  const assessments = await runPlanFlow({
    shouldFetch,
    fetchDirs,
    reposForFetchReport: repos,
    remotesMap,
    assess,
    postAssess,
    formatPlan: (nextAssessments) =>
      formatIntegratePlan(nextAssessments, mode, options.verbose, options.graph, workspace),
    onPostFetch: () => cache.invalidateAfterFetch(),
  });

  // All-or-nothing check: when retarget is active, skipped repos block the entire retarget
  // (except repos with no base branch or where the retarget target simply doesn't exist on their remote)
  if (retarget) {
    const hasRetargetWork = assessments.some((a) => a.retarget?.to || a.retarget?.blocked);
    if (hasRetargetWork) {
      const blockedRepos = assessments.filter(
        (a) => a.outcome === "skip" && (a.skipFlag == null || !RETARGET_EXEMPT_SKIPS.has(a.skipFlag)),
      );
      if (blockedRepos.length > 0) {
        error("Cannot retarget: some repos are blocked. Fix these issues and retry:");
        for (const a of blockedRepos) {
          process.stderr.write(`  ${a.repo} — ${a.skipReason}\n`);
        }
        throw new ArbError("Cannot retarget: some repos are blocked.");
      }
      // Ensure at least one repo can actually retarget
      const hasActualRetargetWork = assessments.some((a) => a.retarget?.to);
      if (!hasActualRetargetWork) {
        const notFoundRepos = assessments.filter((a) => a.skipFlag === "retarget-target-not-found");
        error("Cannot retarget: target branch not found on any repo.");
        for (const a of notFoundRepos) {
          process.stderr.write(`  ${a.repo} — ${a.skipReason}\n`);
        }
        throw new ArbError("Cannot retarget: target branch not found on any repo.");
      }
    }
  }
  const retargetConfigTarget = retarget ? resolveRetargetConfigTarget(assessments) : null;
  const retargetConfigFrom = retargetConfigTarget
    ? (assessments.find((a) => a.retarget?.to === retargetConfigTarget && a.retarget?.reason !== "branch-merged")
        ?.retarget?.from ?? null)
    : null;

  // Phase 4: confirm
  const willOperate = assessments.filter((a) => a.outcome === "will-operate");
  const upToDate = assessments.filter((a) => a.outcome === "up-to-date" || isDirtyButUpToDate(a));
  const skipped = assessments.filter((a) => a.outcome === "skip" && !isDirtyButUpToDate(a));

  if (willOperate.length === 0) {
    // Retarget config (explicit --retarget)
    const wroteRetargetConfig = await maybeWriteRetargetConfig({
      dryRun: options.dryRun,
      wsDir,
      branch,
      assessments,
      retargetConfigTarget,
      cache,
    });
    if (wroteRetargetConfig && retargetConfigTarget && retargetConfigFrom) {
      inlineResult(workspace, `base branch changed from ${retargetConfigFrom} to ${retargetConfigTarget}`);
      process.stderr.write("\n");
      return;
    }

    // Stale base fallback (needs confirmation — plan already shows the change)
    if (!wroteRetargetConfig && hasBaseFallback(assessments)) {
      if (options.dryRun) {
        dryRunNotice();
        return;
      }
      await confirmOrExit({
        yes: options.yes,
        message: "Update base branch?",
      });
      process.stderr.write("\n");
      const fallbackResult = await maybeWriteBaseFallbackConfig({
        dryRun: false,
        wsDir,
        branch,
        assessments,
      });
      if (fallbackResult) {
        inlineResult(workspace, `base branch changed from ${fallbackResult.from} to ${fallbackResult.to}`);
      }
      process.stderr.write("\n");
      return;
    }

    info(upToDate.length > 0 ? "All repos up to date" : "Nothing to do");
    return;
  }

  if (options.dryRun) {
    dryRunNotice();
    return;
  }

  await confirmOrExit({
    yes: options.yes,
    message: `${verb} ${plural(willOperate.length, "repo")}?`,
  });

  process.stderr.write("\n");

  // Phase 5: execute sequentially
  let succeeded = 0;
  const conflicted: { assessment: RepoAssessment; stdout: string; stderr: string }[] = [];
  const stashPopFailed: RepoAssessment[] = [];
  for (const a of willOperate) {
    const ref = `${a.baseRemote}/${a.baseBranch}`;

    let result: { exitCode: number; stdout: string; stderr: string };
    if (a.retarget?.from) {
      const repoPath = `${ctx.reposDir}/${a.repo}`;
      const remoteRefExists = await cache.remoteBranchExists(repoPath, a.retarget.from, a.baseRemote);
      const oldBaseRef = remoteRefExists ? `${a.baseRemote}/${a.retarget.from}` : a.retarget.from;
      const n = a.retarget.replayCount ?? a.ahead;
      const progressMsg =
        a.retarget.reason === "branch-merged"
          ? `rebasing ${n} new ${n === 1 ? "commit" : "commits"} onto ${ref} (merged)`
          : `rebasing ${a.branch} onto ${ref} from ${a.retarget.from} (retarget)`;
      inlineStart(a.repo, progressMsg);
      const retargetArgs = ["rebase"];
      if (a.needsStash) retargetArgs.push("--autostash");
      retargetArgs.push("--onto", ref, oldBaseRef);
      result = await gitLocal(a.repoDir, ...retargetArgs);
    } else if (mode === "rebase") {
      const progressMsg = `rebasing ${a.branch} onto ${ref}`;
      inlineStart(a.repo, progressMsg);
      const rebaseArgs = ["rebase"];
      if (a.needsStash) rebaseArgs.push("--autostash");
      rebaseArgs.push(ref);
      result = await gitLocal(a.repoDir, ...rebaseArgs);
    } else {
      // Merge mode
      const progressMsg = `merging ${ref} into ${a.branch}`;
      inlineStart(a.repo, progressMsg);
      if (a.needsStash) {
        await gitLocal(a.repoDir, "stash", "push", "-m", "arb: autostash before merge");
      }
      result = await gitLocal(a.repoDir, "merge", ref);
    }

    if (result.exitCode === 0) {
      // For merge mode with stash, pop the stash
      let stashPopOk = true;
      if (a.needsStash && mode === "merge") {
        const popResult = await gitLocal(a.repoDir, "stash", "pop");
        if (popResult.exitCode !== 0) {
          stashPopOk = false;
          stashPopFailed.push(a);
        }
      }
      let doneMsg: string;
      if (a.retarget?.from && a.retarget.reason === "branch-merged") {
        const n = a.retarget.replayCount ?? a.ahead;
        doneMsg = `rebased ${n} new ${n === 1 ? "commit" : "commits"} onto ${ref} (merged)`;
      } else if (a.retarget?.from) {
        doneMsg = `rebased ${a.branch} onto ${ref} from ${a.retarget.from} (retarget)`;
      } else {
        doneMsg = mode === "rebase" ? `rebased ${a.branch} onto ${ref}` : `merged ${ref} into ${a.branch}`;
      }
      if (!stashPopOk) {
        doneMsg += ` ${yellow("(stash pop failed)")}`;
      }
      inlineResult(a.repo, doneMsg);
      succeeded++;
    } else {
      // For rebase mode, git rebase --autostash handles stash internally.
      // For merge mode with stash, do NOT pop if merge conflicted.
      inlineResult(a.repo, yellow("conflict"));
      conflicted.push({ assessment: a, stdout: result.stdout, stderr: result.stderr });
    }
  }

  // Consolidated conflict report
  const subcommand = mode === "rebase" ? ("rebase" as const) : ("merge" as const);
  const conflictNodes = buildConflictReport(
    conflicted.map((c) => ({
      repo: c.assessment.repo,
      stdout: c.stdout,
      stderr: c.stderr,
      subcommand,
    })),
  );

  // Stash pop failure report
  const stashNodes = buildStashPopFailureReport(stashPopFailed, mode === "rebase" ? "Rebase" : "Merge");

  const reportCtx = { tty: shouldColor() };
  if (conflictNodes.length > 0) process.stderr.write(render(conflictNodes, reportCtx));
  if (stashNodes.length > 0) process.stderr.write(render(stashNodes, reportCtx));

  // Update config after successful retarget (skip branch-merged replays — base doesn't change)
  const wroteRetargetConfig = await maybeWriteRetargetConfig({
    dryRun: options.dryRun,
    wsDir,
    branch,
    assessments,
    retargetConfigTarget,
    cache,
    hasConflicts: conflicted.length > 0,
  });
  if (wroteRetargetConfig && retargetConfigTarget && retargetConfigFrom) {
    inlineResult(workspace, `base branch changed from ${retargetConfigFrom} to ${retargetConfigTarget}`);
  }
  if (!wroteRetargetConfig) {
    const fallbackResult = await maybeWriteBaseFallbackConfig({
      dryRun: options.dryRun,
      wsDir,
      branch,
      assessments,
      hasConflicts: conflicted.length > 0,
    });
    if (fallbackResult) {
      inlineResult(workspace, `base branch changed from ${fallbackResult.from} to ${fallbackResult.to}`);
    }
  }

  // Phase 6: summary
  process.stderr.write("\n");
  const retargetedCount = willOperate.filter(
    (a) => a.retarget?.from && !conflicted.some((c) => c.assessment === a),
  ).length;
  const normalCount = succeeded - retargetedCount;
  const parts: string[] = [];
  if (retargetedCount > 0) parts.push(`Retargeted ${plural(retargetedCount, "repo")}`);
  if (normalCount > 0 || retargetedCount === 0) parts.push(`${verbed} ${plural(normalCount, "repo")}`);
  if (conflicted.length > 0) parts.push(`${conflicted.length} conflicted`);
  if (stashPopFailed.length > 0) parts.push(`${stashPopFailed.length} stash pop failed`);
  if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
  if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
  finishSummary(parts, conflicted.length > 0 || stashPopFailed.length > 0);
}

export function resolveRetargetConfigTarget(assessments: RepoAssessment[]): string | null {
  const retargetTargets = [
    ...new Set(
      assessments
        .filter((a) => a.retarget?.to && a.retarget.reason !== "branch-merged")
        .map((a) => a.retarget?.to as string),
    ),
  ];
  if (retargetTargets.length === 0) return null;
  if (retargetTargets.length > 1) {
    const targets = retargetTargets.sort().join(", ");
    throw new ArbError(`Cannot retarget: repos disagree on target base (${targets}).`);
  }
  return retargetTargets[0] ?? null;
}

export async function maybeWriteRetargetConfig(options: {
  dryRun?: boolean;
  wsDir: string;
  branch: string;
  assessments: RepoAssessment[];
  retargetConfigTarget: string | null;
  cache: Pick<GitCache, "getDefaultBranch">;
  hasConflicts?: boolean;
}): Promise<boolean> {
  if (options.dryRun) return false;
  if (options.hasConflicts) return false;
  if (!options.retargetConfigTarget) return false;
  const { wsDir, branch, assessments, retargetConfigTarget, cache } = options;
  const firstRetarget = assessments.find(
    (a) => a.retarget?.to === retargetConfigTarget && a.retarget.reason !== "branch-merged",
  );
  if (!firstRetarget) return false;
  const configFile = `${wsDir}/.arbws/config.json`;
  const wb = await workspaceBranch(wsDir);
  const wsBranch = wb?.branch ?? branch;
  // Resolve the repo's default branch to check if retargetTo matches
  // If retargeting to the default branch, remove the base key
  // If retargeting to a non-default branch, set it as the new base
  const repoDefault = await cache.getDefaultBranch(firstRetarget.repoDir, firstRetarget.baseRemote);
  if (repoDefault && retargetConfigTarget !== repoDefault) {
    writeWorkspaceConfig(configFile, { branch: wsBranch, base: retargetConfigTarget });
  } else {
    writeWorkspaceConfig(configFile, { branch: wsBranch });
  }
  return true;
}

export async function maybeWriteBaseFallbackConfig(options: {
  dryRun?: boolean;
  wsDir: string;
  branch: string;
  assessments: RepoAssessment[];
  hasConflicts?: boolean;
}): Promise<{ from: string; to: string } | null> {
  if (options.dryRun) return null;
  if (options.hasConflicts) return null;
  const { wsDir, branch, assessments } = options;

  // Only proceed if ALL non-skip assessments have baseFallback — in multi-repo workspaces,
  // if any repo still has the configured base on its remote, don't clear the workspace config.
  const nonSkip = assessments.filter((a) => a.outcome !== "skip" || isDirtyButUpToDate(a));
  if (nonSkip.length === 0) return null;
  const allHaveFallback = nonSkip.every((a) => a.baseFallback != null);
  if (!allHaveFallback) return null;

  // Don't auto-clear if any repo needs --retarget (base-merged-into-default detected)
  const hasBaseMergedSkip = assessments.some((a) => a.outcome === "skip" && a.skipFlag === "base-merged-into-default");
  if (hasBaseMergedSkip) return null;

  const firstFallback = nonSkip.find((a) => a.baseFallback != null);
  if (!firstFallback?.baseFallback) return null;

  const configFile = `${wsDir}/.arbws/config.json`;
  const wb = await workspaceBranch(wsDir);
  const wsBranch = wb?.branch ?? branch;
  writeWorkspaceConfig(configFile, { branch: wsBranch });
  return { from: firstFallback.baseFallback, to: firstFallback.baseBranch ?? "default" };
}

// ── Semantic intermediate for integrate plan ──

function classifyStash(a: RepoAssessment): IntegrateActionDesc["stash"] {
  if (!a.needsStash) return "none";
  if (a.stashPopConflictFiles && a.stashPopConflictFiles.length > 0) return "pop-conflict-likely";
  if (a.stashPopConflictFiles) return "pop-conflict-unlikely";
  return "autostash";
}

function classifyConflictRisk(
  prediction: RepoAssessment["conflictPrediction"],
  mode: IntegrateMode,
): IntegrateActionDesc["conflictRisk"] {
  if (prediction === "conflict") return mode === "merge" ? "will-conflict" : "likely";
  if (prediction === "clean") return mode === "merge" ? "no-conflict" : "unlikely";
  if (prediction === "no-conflict") return "no-conflict";
  return null;
}

export function describeIntegrateAction(a: RepoAssessment, mode: IntegrateMode): IntegrateActionDesc {
  const baseRef = `${a.baseRemote}/${a.baseBranch}`;
  const stash = classifyStash(a);

  if (a.retarget?.from) {
    if (a.retarget.reason === "branch-merged") {
      return {
        kind: "retarget-merged",
        baseRef,
        branch: a.branch,
        replayCount: a.retarget.replayCount ?? a.ahead,
        skipCount: a.retarget.alreadyOnTarget,
        conflictRisk: null,
        stash,
        baseFallback: a.baseFallback,
        warning: a.retarget.warning,
        headSha: a.headSha,
      };
    }
    return {
      kind: "retarget-config",
      baseRef,
      branch: a.branch,
      retargetFrom: a.retarget.from,
      replayCount: a.retarget.replayCount,
      skipCount: a.retarget.alreadyOnTarget,
      conflictRisk: null,
      stash,
      baseFallback: a.baseFallback,
      warning: a.retarget.warning,
      headSha: a.headSha,
    };
  }

  return {
    kind: mode,
    baseRef,
    branch: a.branch,
    diff: { behind: a.behind, ahead: a.ahead, matchedCount: a.verbose?.matchedCount },
    mergeType: mode === "merge" ? (a.ahead === 0 ? "fast-forward" : "three-way") : undefined,
    conflictRisk: classifyConflictRisk(a.conflictPrediction, mode),
    stash,
    baseFallback: a.baseFallback,
    headSha: a.headSha,
  };
}

/** Whether ALL non-skip assessments have a baseFallback (stale base config). */
function hasBaseFallback(assessments: RepoAssessment[]): boolean {
  const nonSkip = assessments.filter((a) => a.outcome !== "skip" || isDirtyButUpToDate(a));
  return nonSkip.length > 0 && nonSkip.every((a) => a.baseFallback != null);
}

/** Dirty-skip that is actually up to date (behind === 0 with a resolved base). */
function isDirtyButUpToDate(a: RepoAssessment): boolean {
  return a.outcome === "skip" && a.skipFlag === "dirty" && a.baseBranch != null && a.behind === 0;
}

export interface PlannedConfigAction {
  workspace: string;
  description: string;
}

/** Derive planned workspace config changes from assessments (for plan display). */
export function computePlannedConfigActions(assessments: RepoAssessment[], workspace: string): PlannedConfigAction[] {
  // Retarget config change (takes priority — mutually exclusive with fallback)
  const retargetTargets = [
    ...new Set(
      assessments
        .filter((a) => a.retarget?.to && a.retarget.reason !== "branch-merged")
        .map((a) => a.retarget?.to as string),
    ),
  ];
  if (retargetTargets.length === 1) {
    const target = retargetTargets[0];
    const from = assessments.find((a) => a.retarget?.to === target && a.retarget?.reason !== "branch-merged")?.retarget
      ?.from;
    if (from && target) {
      return [{ workspace, description: `change base branch from ${from} to ${target}` }];
    }
  }

  // Stale base fallback
  if (hasBaseFallback(assessments)) {
    const hasBaseMergedSkip = assessments.some(
      (a) => a.outcome === "skip" && a.skipFlag === "base-merged-into-default",
    );
    if (!hasBaseMergedSkip) {
      const nonSkip = assessments.filter((a) => a.outcome !== "skip" || isDirtyButUpToDate(a));
      const first = nonSkip.find((a) => a.baseFallback != null);
      if (first?.baseFallback) {
        return [
          {
            workspace,
            description: `change base branch from ${first.baseFallback} to ${first.baseBranch ?? "default"}`,
          },
        ];
      }
    }
  }

  return [];
}

export function buildIntegratePlanNodes(
  assessments: RepoAssessment[],
  mode: IntegrateMode,
  verbose?: boolean,
  graph?: boolean,
  configActions?: PlannedConfigAction[],
): OutputNode[] {
  const nodes: OutputNode[] = [{ kind: "gap" }];

  const rows = assessments.map((a) => {
    let actionCell: Cell;
    if (a.outcome === "will-operate") {
      actionCell = integrateActionCell(describeIntegrateAction(a, mode));
    } else if (a.outcome === "up-to-date" || isDirtyButUpToDate(a)) {
      actionCell = upToDateCell();
      if (a.baseFallback) {
        actionCell = suffix(actionCell, ` (base ${a.baseFallback} not found)`, "attention");
      }
    } else {
      actionCell = skipCell(a.skipReason ?? "", a.skipFlag);
    }

    let afterRow: OutputNode[] | undefined;
    if (a.outcome === "will-operate") {
      if (graph) {
        const graphText = formatBranchGraph(a, a.branch, !!verbose);
        if (graphText) afterRow = [{ kind: "rawText", text: graphText }];
      } else if (verbose && a.verbose?.commits && a.verbose.commits.length > 0) {
        const label = `Incoming from ${a.baseRemote}/${a.baseBranch}:`;
        afterRow = verboseCommitsToNodes(a.verbose.commits, a.verbose.totalCommits ?? a.verbose.commits.length, label, {
          diffStats: a.verbose.diffStats,
          conflictCommits: a.verbose.conflictCommits,
        });
      }
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

  // Planned config changes (non-repo actions)
  if (configActions && configActions.length > 0) {
    nodes.push({ kind: "gap" });
    for (const action of configActions) {
      nodes.push({
        kind: "hint",
        cell: cell(`  [${action.workspace}] ${action.description}`),
      });
    }
  }

  // Wrong branch repos hint
  const wrongBranchCount = assessments.filter((a) => a.wrongBranch && a.outcome === "will-operate").length;
  if (wrongBranchCount > 0) {
    nodes.push({
      kind: "hint",
      cell: cell(`  hint: ${plural(wrongBranchCount, "repo")} on a different branch than the workspace`, "muted"),
    });
  }

  // Shallow clone warnings
  const shallowRepos = assessments.filter((a) => a.shallow);
  for (const a of shallowRepos) {
    nodes.push({
      kind: "message",
      level: "attention",
      text: `${a.repo} is a shallow clone; ahead/behind counts may be inaccurate and ${mode} may fail if the merge base is beyond the shallow boundary`,
    });
  }

  nodes.push({ kind: "gap" });
  return nodes;
}

export function formatIntegratePlan(
  assessments: RepoAssessment[],
  mode: IntegrateMode,
  verbose?: boolean,
  graph?: boolean,
  workspace?: string,
): string {
  const configActions = workspace ? computePlannedConfigActions(assessments, workspace) : [];
  const nodes = buildIntegratePlanNodes(assessments, mode, verbose, graph, configActions);
  const envCols = Number(process.env.COLUMNS);
  const termCols = process.stdout.columns ?? (Number.isFinite(envCols) ? envCols : 0);
  const ctx: RenderContext = { tty: shouldColor(), terminalWidth: termCols > 0 ? termCols : undefined };
  return render(nodes, ctx);
}

async function predictIntegrateConflicts(assessments: RepoAssessment[], mode: IntegrateMode): Promise<void> {
  await Promise.all(
    assessments
      .filter((a) => a.outcome === "will-operate")
      .map(async (a) => {
        const ref = `${a.baseRemote}/${a.baseBranch}`;
        if (!a.retarget?.from && a.ahead > 0 && a.behind > 0) {
          const prediction = await predictMergeConflict(a.repoDir, ref);
          a.conflictPrediction = prediction === null ? null : prediction.hasConflict ? "conflict" : "clean";
          // Per-commit conflict detail for rebase mode
          if (prediction?.hasConflict && mode === "rebase") {
            const conflictCommits = await predictRebaseConflictCommits(a.repoDir, ref);
            if (conflictCommits.length > 0) a.verbose = { ...a.verbose, conflictCommits };
          }
        } else if (!a.retarget?.from) {
          a.conflictPrediction = "no-conflict";
        }
        if (a.needsStash) {
          const stashPrediction = await predictStashPopConflict(a.repoDir, ref);
          a.stashPopConflictFiles = stashPrediction.overlapping;
        }
      }),
  );
}

async function gatherIntegrateVerboseCommits(assessments: RepoAssessment[]): Promise<void> {
  await Promise.all(
    assessments
      .filter((a) => a.outcome === "will-operate")
      .map(async (a) => {
        const ref = `${a.baseRemote}/${a.baseBranch}`;
        const incomingCommits = await getCommitsBetweenFull(a.repoDir, "HEAD", ref);
        const total = incomingCommits.length;

        // When diverged, match incoming commits against local commits
        let rebaseMap: Map<string, string> | undefined;
        let squashMatch: { incomingHash: string; localHashes: string[] } | undefined;
        let localHashToShort: Map<string, string> | undefined;

        if (a.ahead > 0 && a.behind > 0) {
          const matchResult = await matchDivergedCommits(a.repoDir, ref);
          if (matchResult.rebaseMatches.size > 0) rebaseMap = matchResult.rebaseMatches;
          if (matchResult.squashMatch) squashMatch = matchResult.squashMatch;

          if (rebaseMap || squashMatch) {
            const localCommits = await getCommitsBetweenFull(a.repoDir, ref, "HEAD");
            localHashToShort = new Map(localCommits.map((c) => [c.fullHash, c.shortHash]));
          }
        }

        let matchedCount = 0;
        const commits = incomingCommits.slice(0, VERBOSE_COMMIT_LIMIT).map((c) => {
          const entry: NonNullable<NonNullable<RepoAssessment["verbose"]>["commits"]>[number] = {
            shortHash: c.shortHash,
            subject: c.subject,
          };
          if (rebaseMap?.has(c.fullHash)) {
            const localHash = rebaseMap.get(c.fullHash) ?? c.fullHash;
            entry.rebaseOf = localHashToShort?.get(localHash) ?? localHash.slice(0, 7);
            matchedCount++;
          } else if (squashMatch && c.fullHash === squashMatch.incomingHash) {
            entry.squashOf = squashMatch.localHashes.map((h) => localHashToShort?.get(h) ?? h.slice(0, 7));
            matchedCount++;
          }
          return entry;
        });
        // Count matches in commits beyond the display limit too
        for (const c of incomingCommits.slice(VERBOSE_COMMIT_LIMIT)) {
          if (rebaseMap?.has(c.fullHash)) matchedCount++;
          else if (squashMatch && c.fullHash === squashMatch.incomingHash) matchedCount++;
        }
        a.verbose = {
          ...a.verbose,
          commits,
          totalCommits: total,
          matchedCount: matchedCount > 0 ? matchedCount : undefined,
          diffStats: (await getDiffShortstat(a.repoDir, "HEAD", ref)) ?? undefined,
        };
      }),
  );
}

async function gatherIntegrateGraphData(
  assessments: RepoAssessment[],
  verbose: boolean,
  cache: GitCache,
  reposDir: string,
): Promise<void> {
  await Promise.all(
    assessments
      .filter((a) => a.outcome === "will-operate")
      .map(async (a) => {
        // Resolve the ref used for merge-base and outgoing commits
        let mergeBaseRef: string;
        if (a.retarget?.from) {
          const repoPath = `${reposDir}/${a.repo}`;
          const oldBaseRemoteExists = await cache.remoteBranchExists(repoPath, a.retarget.from, a.baseRemote);
          mergeBaseRef = oldBaseRemoteExists ? `${a.baseRemote}/${a.retarget.from}` : a.retarget.from;
        } else {
          mergeBaseRef = `${a.baseRemote}/${a.baseBranch}`;
        }

        a.verbose = { ...a.verbose, mergeBaseSha: (await getMergeBase(a.repoDir, "HEAD", mergeBaseRef)) ?? undefined };

        // Gather outgoing commits (feature branch side) when verbose + graph
        if (verbose && a.ahead > 0) {
          const commits = await getCommitsBetweenFull(a.repoDir, mergeBaseRef, "HEAD");
          const total = commits.length;
          a.verbose = {
            ...a.verbose,
            outgoingCommits: commits.slice(0, VERBOSE_COMMIT_LIMIT).map((c) => ({
              shortHash: c.shortHash,
              subject: c.subject,
            })),
            totalOutgoingCommits: total,
          };
        }
      }),
  );
}
