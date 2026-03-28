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
import type { OperationRecord, RepoOperationState } from "../core/operation";
import {
  assertNoInProgressOperation,
  readInProgressOperation,
  withReflogAction,
  writeOperationRecord,
} from "../core/operation";
import { getCommitsBetweenFull, getDiffShortstat, getMergeBase, gitLocal, parseGitStatus } from "../git/git";
import type { GitCache } from "../git/git-cache";
import { buildConflictReport, buildStashPopFailureReport } from "../render/conflict-report";
import { type IntegrateActionDesc, integrateActionCell } from "../render/integrate-cells";
import { formatBranchGraph } from "../render/integrate-graph";
import type { Cell, OutputNode } from "../render/model";
import { cell, suffix } from "../render/model";
import { skipCell, upToDateCell } from "../render/plan-format";
import { type RenderContext, finishSummary, render } from "../render/render";
import { verboseCommitsToNodes } from "../render/status-verbose";
import { resolveWhereFilter } from "../status/where";
import { dryRunNotice, error, info, inlineResult, inlineStart, plural, yellow } from "../terminal/output";
import { shouldColor } from "../terminal/tty";
import { workspaceBranch } from "../workspace/branch";
import { requireBranch, requireWorkspace } from "../workspace/context";
import { resolveRepoSelection, workspaceRepoDirs } from "../workspace/repos";
import { buildCachedStatusAssess } from "./assess-with-cache";
import { type IntegrateMode, assessIntegrateRepo } from "./classify-integrate";
import { VERBOSE_COMMIT_LIMIT } from "./constants";
import { runContinueFlow } from "./continue-flow";
import { confirmOrExit, runPlanFlow } from "./mutation-flow";
import { resolveDefaultFetch } from "./parallel-fetch";
import { runUndoFlow } from "./undo";
export type { RepoAssessment } from "./types";
import type { RepoAssessment } from "./types";

/** Build the git ref for the base branch, respecting local resolution. */
function resolvedBaseRef(a: RepoAssessment): string {
  return a.baseResolvedLocally ? (a.baseBranch ?? "") : `${a.baseRemote}/${a.baseBranch}`;
}

export async function integrate(
  ctx: CommandContext,
  mode: IntegrateMode,
  options: {
    fetch?: boolean;
    yes?: boolean;
    dryRun?: boolean;
    autostash?: boolean;
    includeWrongBranch?: boolean;
    verbose?: boolean;
    graph?: boolean;
    where?: string;
    continue?: boolean;
    abort?: boolean;
  },
  repoArgs: string[],
): Promise<void> {
  const verb = mode === "rebase" ? "Rebase" : "Merge";
  const verbed = mode === "rebase" ? "Rebased" : "Merged";

  // Phase 0: operation lifecycle (--continue, --abort, gate)
  const { wsDir, workspace } = requireWorkspace(ctx);

  const inProgress = readInProgressOperation(wsDir, mode);

  if (options.abort) {
    if (!inProgress) {
      error(`No ${mode} in progress. Nothing to abort.`);
      throw new ArbError(`No ${mode} in progress. Nothing to abort.`);
    }
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
      error(`No ${mode} in progress. Nothing to continue.`);
      throw new ArbError(`No ${mode} in progress. Nothing to continue.`);
    }
    await runContinueFlow({ record: inProgress, wsDir, mode, gitContinueCmd: mode, options });
    return;
  }

  // No --continue/--abort: block if in-progress, proceed if clean
  await assertNoInProgressOperation(wsDir);

  // Phase 1: context & repo selection
  const branch = await requireBranch(wsDir, workspace);
  const cache = ctx.cache;
  const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;

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
      return assessIntegrateRepo(status, repoDir, branch, fetchFailed, {
        autostash,
        includeWrongBranch,
        mode,
      });
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

  // Phase 4: confirm
  const willOperate = assessments.filter((a) => a.outcome === "will-operate");
  const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
  const skipped = assessments.filter((a) => a.outcome === "skip");

  if (willOperate.length === 0) {
    // Stale base fallback (needs confirmation — plan already shows the change)
    if (hasBaseFallback(assessments)) {
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

  // Phase 5: capture state and write operation record
  const repoStates: Record<string, RepoOperationState> = {};
  for (const a of willOperate) {
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
    command: mode,
    startedAt: new Date().toISOString(),
    status: "in-progress",
    repos: repoStates,
  };
  writeOperationRecord(wsDir, record);

  // Phase 6: execute sequentially
  let succeeded = 0;
  const conflicted: { assessment: RepoAssessment; stdout: string; stderr: string }[] = [];
  const stashPopFailed: RepoAssessment[] = [];
  await withReflogAction(`arb-${mode}`, async () => {
    for (const a of willOperate) {
      const ref = resolvedBaseRef(a);

      let result: { exitCode: number; stdout: string; stderr: string };
      if (a.retarget?.from) {
        // Branch-merged replay: use --onto to skip already-merged commits
        const n = a.retarget.replayCount ?? a.ahead;
        if (n === 0) {
          inlineStart(a.repo, `resetting to ${ref} (merged)`);
        } else {
          const progressMsg = `rebasing ${n} new ${n === 1 ? "commit" : "commits"} onto ${ref} (merged)`;
          inlineStart(a.repo, progressMsg);
        }
        const rebaseArgs = ["rebase"];
        if (a.needsStash) rebaseArgs.push("--autostash");
        rebaseArgs.push("--onto", ref, a.retarget.from);
        result = await gitLocal(a.repoDir, ...rebaseArgs);
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
        // Detect autostash pop conflict in rebase mode.
        // git rebase --autostash exits 0 even when the stash apply conflicts,
        // leaving unmerged paths in the working tree.
        if (a.needsStash && mode === "rebase") {
          const postStatus = await parseGitStatus(a.repoDir);
          if (postStatus.conflicts > 0) {
            stashPopOk = false;
            stashPopFailed.push(a);
          }
        }
        let doneMsg: string;
        if (a.retarget?.from) {
          const n = a.retarget.replayCount ?? a.ahead;
          doneMsg =
            n === 0
              ? `reset to ${ref} (merged)`
              : `rebased ${n} new ${n === 1 ? "commit" : "commits"} onto ${ref} (merged)`;
        } else {
          doneMsg = mode === "rebase" ? `rebased ${a.branch} onto ${ref}` : `merged ${ref} into ${a.branch}`;
        }
        if (!stashPopOk) {
          doneMsg += ` ${yellow("(stash pop failed)")}`;
        }
        const postHeadResult = await gitLocal(a.repoDir, "rev-parse", "HEAD");
        const existing = record.repos[a.repo];
        if (existing) {
          record.repos[a.repo] = { ...existing, status: "completed", postHead: postHeadResult.stdout.trim() };
        }
        writeOperationRecord(wsDir, record);

        inlineResult(a.repo, doneMsg);
        succeeded++;
      } else {
        // For rebase mode, git rebase --autostash handles stash internally.
        // For merge mode with stash, do NOT pop if merge conflicted.
        const existing = record.repos[a.repo];
        if (existing) {
          const errorOutput = result.stderr.trim().slice(0, 4000) || undefined;
          record.repos[a.repo] = { ...existing, status: "conflicting", errorOutput };
        }
        writeOperationRecord(wsDir, record);

        inlineResult(a.repo, yellow("conflict"));
        conflicted.push({ assessment: a, stdout: result.stdout, stderr: result.stderr });
      }
    }
  });

  // Consolidated conflict report
  const conflictNodes = buildConflictReport(
    conflicted.map((c) => ({
      repo: c.assessment.repo,
      stdout: c.stdout,
      stderr: c.stderr,
      mode,
    })),
  );

  // Stash pop failure report
  const stashNodes = buildStashPopFailureReport(stashPopFailed, mode === "rebase" ? "Rebase" : "Merge");

  const reportCtx = { tty: shouldColor() };
  if (conflictNodes.length > 0) process.stderr.write(render(conflictNodes, reportCtx));
  if (stashNodes.length > 0) process.stderr.write(render(stashNodes, reportCtx));

  // Finalize operation record
  if (conflicted.length === 0) {
    record.status = "completed";
    record.completedAt = new Date().toISOString();
    writeOperationRecord(wsDir, record);
  }

  // Update config after stale base fallback
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

  // Phase 6: summary
  process.stderr.write("\n");
  const parts: string[] = [];
  parts.push(`${verbed} ${plural(succeeded, "repo")}`);
  if (conflicted.length > 0) parts.push(`${conflicted.length} conflicted`);
  if (stashPopFailed.length > 0) parts.push(`${stashPopFailed.length} stash pop failed`);
  if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
  if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
  finishSummary(parts, conflicted.length > 0 || stashPopFailed.length > 0);
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
  const nonSkip = assessments.filter((a) => a.outcome !== "skip");
  if (nonSkip.length === 0) return null;
  const allHaveFallback = nonSkip.every((a) => a.baseFallback != null);
  if (!allHaveFallback) return null;

  // Don't auto-clear if any repo needs retarget (base-merged-into-default detected)
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
  const baseRef = resolvedBaseRef(a);
  const stash = classifyStash(a);

  if (a.retarget?.from && a.retarget.reason === "branch-merged") {
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
  const nonSkip = assessments.filter((a) => a.outcome !== "skip");
  return nonSkip.length > 0 && nonSkip.every((a) => a.baseFallback != null);
}

export interface PlannedConfigAction {
  workspace: string;
  description: string;
}

/** Derive planned workspace config changes from assessments (for plan display). */
export function computePlannedConfigActions(assessments: RepoAssessment[], workspace: string): PlannedConfigAction[] {
  // Stale base fallback
  if (hasBaseFallback(assessments)) {
    const hasBaseMergedSkip = assessments.some(
      (a) => a.outcome === "skip" && a.skipFlag === "base-merged-into-default",
    );
    if (!hasBaseMergedSkip) {
      const nonSkip = assessments.filter((a) => a.outcome !== "skip");
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
    } else if (a.outcome === "up-to-date") {
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
        const label = `Incoming from ${resolvedBaseRef(a)}:`;
        afterRow = verboseCommitsToNodes(a.verbose.commits, a.verbose.totalCommits ?? a.verbose.commits.length, label, {
          diffStats: a.verbose.diffStats,
          conflictCommits: a.verbose.conflictCommits,
          conflictFiles: a.conflictFiles,
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
        const ref = resolvedBaseRef(a);
        // Skip conflict prediction for branch-merged replay (--onto semantics don't match merge-tree)
        if (!a.retarget?.from && a.ahead > 0 && a.behind > 0) {
          const prediction = await predictMergeConflict(a.repoDir, ref);
          a.conflictPrediction = prediction === null ? null : prediction.hasConflict ? "conflict" : "clean";
          if (prediction?.hasConflict) a.conflictFiles = prediction.files;
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
        const ref = resolvedBaseRef(a);
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
          mergeBaseRef = resolvedBaseRef(a);
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
