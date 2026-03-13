import { basename } from "node:path";
import { matchDivergedCommits } from "../analysis/commit-matching";
import {
  predictMergeConflict,
  predictRebaseConflictCommits,
  predictStashPopConflict,
} from "../analysis/conflict-prediction";
import { readWorkspaceConfig, writeWorkspaceConfig } from "../core/config";
import { ArbError } from "../core/errors";
import type { ArbContext } from "../core/types";
import { getCommitsBetweenFull, getDiffShortstat, getMergeBase, git, remoteBranchExists } from "../git/git";
import { GitCache } from "../git/git-cache";
import { buildConflictReport, buildStashPopFailureReport } from "../render/conflict-report";
import { type IntegrateActionDesc, integrateActionCell } from "../render/integrate-cells";
import { formatBranchGraph } from "../render/integrate-graph";
import type { Cell, OutputNode } from "../render/model";
import { cell } from "../render/model";
import { skipCell, upToDateCell } from "../render/plan-format";
import { type RenderContext, finishSummary, render } from "../render/render";
import { verboseCommitsToNodes } from "../render/status-verbose";
import { computeFlags } from "../status/flags";
import { RETARGET_EXEMPT_SKIPS } from "../status/skip-flags";
import { gatherRepoStatus } from "../status/status";
import type { RepoStatus } from "../status/types";
import { repoMatchesWhere, resolveWhereFilter } from "../status/where";
import { dryRunNotice, error, info, inlineResult, inlineStart, plural, yellow } from "../terminal/output";
import { isTTY } from "../terminal/tty";
import { workspaceBranch } from "../workspace/branch";
import { requireBranch, requireWorkspace } from "../workspace/context";
import { resolveRepoSelection, workspaceRepoDirs } from "../workspace/repos";
import { type IntegrateMode, assessIntegrateRepo } from "./classify-integrate";
import { VERBOSE_COMMIT_LIMIT } from "./constants";
import { confirmOrExit, runPlanFlow } from "./mutation-flow";
export type { RepoAssessment } from "./types";
import type { RepoAssessment } from "./types";

export async function integrate(
  ctx: ArbContext,
  mode: IntegrateMode,
  options: {
    fetch?: boolean;
    yes?: boolean;
    dryRun?: boolean;
    retarget?: string | boolean;
    autostash?: boolean;
    includeDrifted?: boolean;
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
  const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;

  if (retargetExplicit) {
    if (retargetExplicit === branch) {
      error(`Cannot retarget to ${retargetExplicit} — that is the current feature branch.`);
      throw new ArbError(`Cannot retarget to ${retargetExplicit} — that is the current feature branch.`);
    }
    if (retargetExplicit === configBase) {
      error(`Cannot retarget to ${retargetExplicit} — that is already the configured base branch.`);
      throw new ArbError(`Cannot retarget to ${retargetExplicit} — that is already the configured base branch.`);
    }
  }

  const selectedRepos = resolveRepoSelection(wsDir, repoArgs);
  const where = resolveWhereFilter(options);

  // Resolve remotes for all repos
  const cache = await GitCache.create();
  const remotesMap = await cache.resolveRemotesMap(selectedRepos, ctx.reposDir);

  // Phase 2: fetch
  const shouldFetch = options.fetch !== false;
  const allFetchDirs = workspaceRepoDirs(wsDir);
  const selectedSet = new Set(selectedRepos);
  const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
  const repos = fetchDirs.map((d) => basename(d));

  const autostash = options.autostash === true;
  const includeDrifted = options.includeDrifted === true;
  const prevStatuses = new Map<string, RepoStatus>();
  const assess = async (fetchFailed: string[], unchangedRepos: Set<string>) => {
    const assessments = await Promise.all(
      selectedRepos.map(async (repo) => {
        const repoDir = `${wsDir}/${repo}`;
        let status: RepoStatus;
        if (unchangedRepos.has(repo) && prevStatuses.has(repo)) {
          status = prevStatuses.get(repo) as RepoStatus;
        } else {
          status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, remotesMap.get(repo), cache);
        }
        prevStatuses.set(repo, status);
        if (where) {
          const flags = computeFlags(status, branch);
          if (!repoMatchesWhere(flags, where)) return null;
        }
        return assessIntegrateRepo(status, repoDir, branch, fetchFailed, {
          retarget,
          retargetExplicit,
          autostash,
          includeDrifted,
          cache,
          mode,
        });
      }),
    );
    return assessments.filter((a): a is RepoAssessment => a !== null);
  };

  const postAssess = async (nextAssessments: RepoAssessment[]) => {
    await predictIntegrateConflicts(nextAssessments, mode);
    if (options.verbose) {
      await gatherIntegrateVerboseCommits(nextAssessments);
    }
    if (options.graph) {
      await gatherIntegrateGraphData(nextAssessments, !!options.verbose);
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
    formatPlan: (nextAssessments) => formatIntegratePlan(nextAssessments, mode, options.verbose, options.graph),
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

  // Phase 4: confirm
  const willOperate = assessments.filter((a) => a.outcome === "will-operate");
  const upToDate = assessments.filter((a) => a.outcome === "up-to-date" || isDirtyButUpToDate(a));
  const skipped = assessments.filter((a) => a.outcome === "skip" && !isDirtyButUpToDate(a));

  if (willOperate.length === 0) {
    await maybeWriteRetargetConfig({
      dryRun: options.dryRun,
      wsDir,
      branch,
      assessments,
      retargetConfigTarget,
      cache,
    });
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
      const remoteRefExists = await remoteBranchExists(a.repoDir, a.retarget.from, a.baseRemote);
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
      result = await git(a.repoDir, ...retargetArgs);
    } else if (mode === "rebase") {
      const progressMsg = `rebasing ${a.branch} onto ${ref}`;
      inlineStart(a.repo, progressMsg);
      const rebaseArgs = ["rebase"];
      if (a.needsStash) rebaseArgs.push("--autostash");
      rebaseArgs.push(ref);
      result = await git(a.repoDir, ...rebaseArgs);
    } else {
      // Merge mode
      const progressMsg = `merging ${ref} into ${a.branch}`;
      inlineStart(a.repo, progressMsg);
      if (a.needsStash) {
        await git(a.repoDir, "stash", "push", "-m", "arb: autostash before merge");
      }
      result = await git(a.repoDir, "merge", ref);
    }

    if (result.exitCode === 0) {
      // For merge mode with stash, pop the stash
      let stashPopOk = true;
      if (a.needsStash && mode === "merge") {
        const popResult = await git(a.repoDir, "stash", "pop");
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

  const reportCtx = { tty: isTTY() };
  if (conflictNodes.length > 0) process.stderr.write(render(conflictNodes, reportCtx));
  if (stashNodes.length > 0) process.stderr.write(render(stashNodes, reportCtx));

  // Update config after successful retarget (skip branch-merged replays — base doesn't change)
  await maybeWriteRetargetConfig({
    dryRun: options.dryRun,
    wsDir,
    branch,
    assessments,
    retargetConfigTarget,
    cache,
    hasConflicts: conflicted.length > 0,
  });

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
    headSha: a.headSha,
  };
}

/** Dirty-skip that is actually up to date (behind === 0 with a resolved base). */
function isDirtyButUpToDate(a: RepoAssessment): boolean {
  return a.outcome === "skip" && a.skipFlag === "dirty" && a.baseBranch != null && a.behind === 0;
}

export function buildIntegratePlanNodes(
  assessments: RepoAssessment[],
  mode: IntegrateMode,
  verbose?: boolean,
  graph?: boolean,
): OutputNode[] {
  const nodes: OutputNode[] = [{ kind: "gap" }];

  const rows = assessments.map((a) => {
    let actionCell: Cell;
    if (a.outcome === "will-operate") {
      actionCell = integrateActionCell(describeIntegrateAction(a, mode));
    } else if (a.outcome === "up-to-date" || isDirtyButUpToDate(a)) {
      actionCell = upToDateCell();
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

  // Drifted repos hint
  const driftedCount = assessments.filter((a) => a.drifted && a.outcome === "will-operate").length;
  if (driftedCount > 0) {
    nodes.push({
      kind: "hint",
      cell: cell(`  hint: ${plural(driftedCount, "repo")} on a different branch than the workspace`, "muted"),
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
): string {
  const nodes = buildIntegratePlanNodes(assessments, mode, verbose, graph);
  const envCols = Number(process.env.COLUMNS);
  const termCols = process.stdout.columns ?? (Number.isFinite(envCols) ? envCols : 0);
  const ctx: RenderContext = { tty: isTTY(), terminalWidth: termCols > 0 ? termCols : undefined };
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

async function gatherIntegrateGraphData(assessments: RepoAssessment[], verbose: boolean): Promise<void> {
  await Promise.all(
    assessments
      .filter((a) => a.outcome === "will-operate")
      .map(async (a) => {
        // Resolve the ref used for merge-base and outgoing commits
        let mergeBaseRef: string;
        if (a.retarget?.from) {
          const oldBaseRemoteExists = await remoteBranchExists(a.repoDir, a.retarget.from, a.baseRemote);
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
