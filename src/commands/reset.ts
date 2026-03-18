import { basename } from "node:path";
import type { Command } from "commander";
import { arbAction, readWorkspaceConfig } from "../lib/core";
import { getShortHead, gitLocal } from "../lib/git";
import type { Cell, OutputNode, Span } from "../lib/render";
import { cell, createRenderContext, finishSummary, render, skipCell, spans, suffix } from "../lib/render";
import type { SkipFlag } from "../lib/status";
import { type RepoStatus, computeFlags, resolveWhereFilter } from "../lib/status";
import { buildCachedStatusAssess, confirmOrExit, resolveDefaultFetch, runPlanFlow } from "../lib/sync";
import { dryRunNotice, info, inlineResult, inlineStart, plural, shouldColor, warn, yellow } from "../lib/terminal";
import { requireBranch, requireWorkspace, resolveReposFromArgsOrStdin, workspaceRepoDirs } from "../lib/workspace";

// ── Assessment ──

export interface ResetAssessment {
  repo: string;
  repoDir: string;
  outcome: "will-reset" | "already-clean" | "skip";
  skipReason?: string;
  skipFlag?: SkipFlag;
  mode: "share" | "base";
  baseRemote: string;
  baseRef: string;
  target: string;
  dirtyFiles: number;
  totalAhead: number;
  unpushedCommits: number;
  headSha: string;
}

export function assessResetRepo(
  status: RepoStatus,
  repoDir: string,
  branch: string,
  fetchFailed: string[],
  headSha: string,
  useBase: boolean,
): ResetAssessment {
  const defaults: ResetAssessment = {
    repo: status.name,
    repoDir,
    outcome: "skip",
    mode: "base",
    baseRemote: "",
    baseRef: "",
    target: "",
    dirtyFiles: 0,
    totalAhead: 0,
    unpushedCommits: 0,
    headSha,
  };

  // Fetch failed for this repo
  if (fetchFailed.includes(status.name)) {
    return { ...defaults, skipReason: "fetch failed", skipFlag: "fetch-failed" };
  }

  // Operation in progress
  if (status.operation !== null) {
    return { ...defaults, skipReason: `${status.operation} in progress`, skipFlag: "operation-in-progress" };
  }

  // Branch check — detached or wrong branch
  if (status.identity.headMode.kind === "detached") {
    return { ...defaults, skipReason: "HEAD is detached", skipFlag: "detached-head" };
  }
  if (status.identity.headMode.branch !== branch) {
    return {
      ...defaults,
      skipReason: `on branch ${status.identity.headMode.branch}, expected ${branch}`,
      skipFlag: "wrong-branch",
    };
  }

  // No base branch resolved
  if (status.base === null) {
    return { ...defaults, skipReason: "no base branch", skipFlag: "no-base-branch" };
  }

  // No base remote resolved
  if (!status.base.remote) {
    return { ...defaults, skipReason: "no base remote", skipFlag: "no-base-remote" };
  }

  const baseRemote = status.base.remote;
  const baseRef = status.base.ref;
  const dirtyFiles = status.local.staged + status.local.modified + status.local.conflicts;

  // Resolve target: prefer share ref (remote feature branch) unless --base or no share ref
  const shareRef =
    !useBase && (status.share.refMode === "implicit" || status.share.refMode === "configured")
      ? status.share.ref
      : null;

  let target: string;
  let mode: "share" | "base";
  let totalAhead: number;
  let unpushedCommits: number;

  if (shareRef !== null) {
    // Reset to the remote share branch
    target = shareRef;
    mode = "share";
    totalAhead = status.share.toPush ?? 0;
    unpushedCommits = status.share.toPush ?? 0;

    // Already at share ref with no dirty files.
    // toPush/toPull are non-null when refMode is implicit/configured (rev-list succeeded).
    // If null (rev-list failed), null === 0 is false → falls through to will-reset, which is safe.
    if (status.share.toPush === 0 && status.share.toPull === 0 && dirtyFiles === 0) {
      return {
        ...defaults,
        outcome: "already-clean",
        mode,
        baseRemote,
        baseRef,
        target,
        dirtyFiles: 0,
        totalAhead: 0,
        unpushedCommits: 0,
      };
    }
  } else {
    // Reset to base branch (no share ref, --base flag, or gone/noRef)
    target = `${baseRemote}/${baseRef}`;
    mode = "base";

    // Already merged into base — resetting to base would silently discard merge evidence
    if (status.base.merge != null) {
      const strategy = status.base.merge.kind === "squash" ? "squash-merged" : "merged";
      return {
        ...defaults,
        skipReason: `already ${strategy} into ${baseRef}`,
        skipFlag: "already-merged",
        baseRemote,
        baseRef,
      };
    }

    // Stacked base branch merged into default — needs retarget, not reset
    if (status.base.baseMergedIntoDefault != null) {
      return {
        ...defaults,
        skipReason: `base branch ${status.base.configuredRef ?? status.base.ref} was merged into default (use arb rebase --retarget)`,
        skipFlag: "base-merged-into-default",
        baseRemote,
        baseRef,
      };
    }

    const flags = computeFlags(status, branch);
    totalAhead = status.base.ahead ?? 0;
    unpushedCommits = flags.isAheadOfShare ? (status.share.toPush ?? totalAhead) : 0;

    // Already at base ref with no dirty files
    if (status.base.behind === 0 && totalAhead === 0 && dirtyFiles === 0) {
      return {
        ...defaults,
        outcome: "already-clean",
        mode,
        baseRemote,
        baseRef,
        target,
        dirtyFiles: 0,
        totalAhead: 0,
        unpushedCommits: 0,
      };
    }
  }

  return {
    ...defaults,
    outcome: "will-reset",
    mode,
    baseRemote,
    baseRef,
    target,
    dirtyFiles,
    totalAhead,
    unpushedCommits,
  };
}

// ── Plan formatting ──

function commitLossSpans(totalAhead: number, unpushed: number): Span[] {
  if (totalAhead === 0) return [];
  if (unpushed === totalAhead) {
    return [{ text: plural(totalAhead, "unpushed commit"), attention: "attention" }];
  }
  if (unpushed === 0) {
    return [{ text: `${plural(totalAhead, "commit")} (pushed)`, attention: "default" }];
  }
  return [
    { text: `${plural(totalAhead, "commit")} (`, attention: "default" },
    { text: `${unpushed} unpushed`, attention: "attention" },
    { text: ")", attention: "default" },
  ];
}

function resetActionCell(a: ResetAssessment): Cell {
  const commitSpans = commitLossSpans(a.totalAhead, a.unpushedCommits);
  const hasDirty = a.dirtyFiles > 0;
  const hasCommits = commitSpans.length > 0;

  if (!hasDirty && !hasCommits) {
    let result = cell(`reset to ${a.target}`);
    if (a.headSha) result = suffix(result, `  (HEAD ${a.headSha})`, "muted");
    return result;
  }

  const allSpans: Span[] = [{ text: `reset to ${a.target} — discard `, attention: "default" }];
  if (hasDirty) {
    allSpans.push({ text: plural(a.dirtyFiles, "dirty file"), attention: "default" });
    if (hasCommits) allSpans.push({ text: ", ", attention: "default" });
  }
  allSpans.push(...commitSpans);

  let result = spans(...allSpans);
  if (a.headSha) result = suffix(result, `  (HEAD ${a.headSha})`, "muted");
  return result;
}

function alreadyCleanCell(target: string): Cell {
  return cell(`already at ${target}`);
}

export function buildResetPlanNodes(assessments: ResetAssessment[]): OutputNode[] {
  const nodes: OutputNode[] = [{ kind: "gap" }];

  const rows = assessments.map((a) => {
    let actionCell: Cell;
    if (a.outcome === "will-reset") {
      actionCell = resetActionCell(a);
    } else if (a.outcome === "already-clean") {
      actionCell = alreadyCleanCell(a.target);
    } else {
      actionCell = skipCell(a.skipReason ?? "", a.skipFlag);
    }
    return { cells: { repo: cell(a.repo), action: actionCell } };
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

export function formatResetPlan(assessments: ResetAssessment[]): string {
  const nodes = buildResetPlanNodes(assessments);
  const ctx = createRenderContext();
  return render(nodes, ctx);
}

// ── Command registration ──

export function registerResetCommand(program: Command): void {
  program
    .command("reset [repos...]")
    .option("--fetch", "Fetch from all remotes before reset (default)")
    .option("-N, --no-fetch", "Skip fetching before reset")
    .option("--base", "Always reset to the base branch, even when a remote share branch exists")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("-w, --where <filter>", "Only reset repos matching status filter (comma = OR, + = AND, ^ = negate)")
    .summary("Reset all repos to the share branch (or base if not pushed)")
    .description(
      "Examples:\n\n  arb reset                                Reset all repos to remote HEAD\n  arb reset api                            Reset a specific repo\n  arb reset --base                         Reset to base branch instead\n\nReset all repos (or only the named repos) to the remote share branch HEAD, discarding local commits and staged/unstaged changes. When no remote share branch exists (never pushed), falls back to the base branch. Resolves the correct remote and branch per repo automatically. Untracked files are preserved (no git clean). Shows a plan with what will be lost (dirty files, unpushed commits) and asks for confirmation before proceeding.\n\nRepos whose branch has already been merged (or squash-merged) into base are skipped when the reset target is the base branch. Repos whose configured base branch was merged into the default branch are also skipped (use 'arb rebase --retarget' to update the base first).\n\nUse --base to always reset to the base branch, even when a remote share branch exists.\n\nTo change the base branch, use 'arb branch base <branch>'.\n\nUse --where to filter repos by status flags. See 'arb help where' for filter syntax.\n\nSee 'arb help remotes' for remote role resolution.",
    )
    .action(
      arbAction(async (ctx, repoArgs: string[], options) => {
        const where = resolveWhereFilter(options);
        const { wsDir, workspace } = requireWorkspace(ctx);
        const branch = await requireBranch(wsDir, workspace);

        const selectedRepos = await resolveReposFromArgsOrStdin(wsDir, repoArgs);
        const selectedSet = new Set(selectedRepos);
        const cache = ctx.cache;
        const remotesMap = await cache.resolveRemotesMap(selectedRepos, ctx.reposDir);
        const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;

        // Phase 1: fetch
        const shouldFetch = resolveDefaultFetch(options.fetch);
        const allFetchDirs = workspaceRepoDirs(wsDir);
        const allRepos = allFetchDirs.map((d) => basename(d));
        const repos = allRepos.filter((r) => selectedSet.has(r));
        const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));

        // Phase 2: assess
        const useBase = options.base === true;
        const assess = buildCachedStatusAssess<ResetAssessment>({
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
            const headSha = await getShortHead(repoDir);
            return assessResetRepo(status, repoDir, branch, fetchFailed, headSha, useBase);
          },
        });

        const assessments = await runPlanFlow({
          shouldFetch,
          fetchDirs,
          reposForFetchReport: repos,
          remotesMap,
          assess,
          formatPlan: (nextAssessments) => formatResetPlan(nextAssessments),
          onPostFetch: () => cache.invalidateAfterFetch(),
        });

        const willReset = assessments.filter((a) => a.outcome === "will-reset");
        const alreadyClean = assessments.filter((a) => a.outcome === "already-clean");
        const skipped = assessments.filter((a) => a.outcome === "skip");

        if (willReset.length === 0) {
          info(alreadyClean.length > 0 ? "Nothing to reset" : "Nothing to do");
          return;
        }

        // Warn about unpushed commits
        const withUnpushed = willReset.filter((a) => a.unpushedCommits > 0);
        if (withUnpushed.length > 0) {
          const totalUnpushed = withUnpushed.reduce((sum, a) => sum + a.unpushedCommits, 0);
          warn(
            `Warning: ${plural(totalUnpushed, "unpushed commit")} in ${plural(withUnpushed.length, "repo")} will be permanently lost`,
          );
        }

        if (options.dryRun) {
          dryRunNotice();
          return;
        }

        // Phase 3: confirm
        await confirmOrExit({
          yes: options.yes,
          message: `Reset ${plural(willReset.length, "repo")}?`,
        });

        process.stderr.write("\n");

        // Phase 4: execute
        let resetOk = 0;
        const failed: { assessment: ResetAssessment; stderr: string }[] = [];

        for (const a of willReset) {
          inlineStart(a.repo, `resetting to ${a.target}`);
          const result = await gitLocal(a.repoDir, "reset", "--hard", a.target);
          if (result.exitCode === 0) {
            inlineResult(a.repo, `reset to ${a.target}`);
            resetOk++;
          } else {
            inlineResult(a.repo, yellow("failed"));
            failed.push({ assessment: a, stderr: result.stderr });
          }
        }

        // Failure report
        if (failed.length > 0) {
          const failureNodes: OutputNode[] = [
            { kind: "gap" },
            { kind: "message", level: "default", text: `${failed.length} repo(s) failed:` },
          ];
          for (const entry of failed) {
            const lines = entry.stderr
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean);
            failureNodes.push(
              { kind: "gap" },
              {
                kind: "section",
                header: cell(entry.assessment.repo),
                items: [
                  cell("reset failed"),
                  ...lines.slice(0, 3).map((line) => cell(line, "muted")),
                  cell(`cd ${entry.assessment.repo}`),
                  cell("# fix the issue, then re-run: arb reset"),
                ],
              },
            );
          }
          const reportCtx = { tty: shouldColor() };
          process.stderr.write(render(failureNodes, reportCtx));
        }

        // Phase 5: summary
        process.stderr.write("\n");
        const parts: string[] = [];
        parts.push(`Reset ${plural(resetOk, "repo")}`);
        if (failed.length > 0) parts.push(`${failed.length} failed`);
        if (alreadyClean.length > 0) parts.push(`${alreadyClean.length} up to date`);
        if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
        finishSummary(parts, failed.length > 0);
      }),
    );
}
