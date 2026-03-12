import { basename } from "node:path";
import type { Command } from "commander";
import { readWorkspaceConfig } from "../lib/core";
import type { ArbContext } from "../lib/core";
import { GitCache, assertMinimumGitVersion, getShortHead, git } from "../lib/git";
import type { Cell, OutputNode, Span } from "../lib/render";
import { type RenderContext, cell, finishSummary, render, skipCell, spans, suffix } from "../lib/render";
import type { SkipFlag } from "../lib/status";
import { type RepoStatus, computeFlags, gatherRepoStatus, repoMatchesWhere, resolveWhereFilter } from "../lib/status";
import { confirmOrExit, runPlanFlow } from "../lib/sync";
import {
  dryRunNotice,
  info,
  inlineResult,
  inlineStart,
  isTTY,
  plural,
  readNamesFromStdin,
  warn,
  yellow,
} from "../lib/terminal";
import { requireBranch, requireWorkspace, resolveRepoSelection, workspaceRepoDirs } from "../lib/workspace";

// ── Assessment ──

export interface ResetAssessment {
  repo: string;
  repoDir: string;
  outcome: "will-reset" | "already-clean" | "skip";
  skipReason?: string;
  skipFlag?: SkipFlag;
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
): ResetAssessment {
  const base: ResetAssessment = {
    repo: status.name,
    repoDir,
    outcome: "skip",
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
    return { ...base, skipReason: "fetch failed", skipFlag: "fetch-failed" };
  }

  // Operation in progress
  if (status.operation !== null) {
    return { ...base, skipReason: `${status.operation} in progress`, skipFlag: "operation-in-progress" };
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

  // No base branch resolved
  if (status.base === null) {
    return { ...base, skipReason: "no base branch", skipFlag: "no-base-branch" };
  }

  // No base remote resolved
  if (!status.base.remote) {
    return { ...base, skipReason: "no base remote", skipFlag: "no-base-remote" };
  }

  const baseRemote = status.base.remote;
  const baseRef = status.base.ref;
  const target = `${baseRemote}/${baseRef}`;

  const dirtyFiles = status.local.staged + status.local.modified + status.local.conflicts;
  const flags = computeFlags(status, branch);
  const totalAhead = status.base.ahead ?? 0;
  const unpushedCommits = flags.isUnpushed ? (status.share.toPush ?? totalAhead) : 0;

  // Check if already at the base ref with no dirty files
  if (status.base.behind === 0 && totalAhead === 0 && dirtyFiles === 0) {
    return {
      ...base,
      outcome: "already-clean",
      baseRemote,
      baseRef,
      target,
      dirtyFiles: 0,
      totalAhead: 0,
      unpushedCommits: 0,
    };
  }

  return {
    ...base,
    outcome: "will-reset",
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

function alreadyCleanCell(): Cell {
  return cell("already at base");
}

export function buildResetPlanNodes(assessments: ResetAssessment[]): OutputNode[] {
  const nodes: OutputNode[] = [{ kind: "gap" }];

  const rows = assessments.map((a) => {
    let actionCell: Cell;
    if (a.outcome === "will-reset") {
      actionCell = resetActionCell(a);
    } else if (a.outcome === "already-clean") {
      actionCell = alreadyCleanCell();
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
  const envCols = Number(process.env.COLUMNS);
  const termCols = process.stdout.columns ?? (Number.isFinite(envCols) ? envCols : 0);
  const ctx: RenderContext = { tty: isTTY(), terminalWidth: termCols > 0 ? termCols : undefined };
  return render(nodes, ctx);
}

// ── Command registration ──

export function registerResetCommand(program: Command, getCtx: () => ArbContext): void {
  program
    .command("reset [repos...]")
    .option("--fetch", "Fetch from all remotes before reset (default)")
    .option("-N, --no-fetch", "Skip fetching before reset")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("-w, --where <filter>", "Only reset repos matching status filter (comma = OR, + = AND, ^ = negate)")
    .summary("Reset all repos to the base branch")
    .description(
      "Reset all repos (or only the named repos) to the base branch HEAD, discarding local commits and staged/unstaged changes. Resolves the correct base remote and branch per repo automatically — no need to hard-code 'origin/main'. Untracked files are preserved (no git clean). Shows a plan with what will be lost (dirty files, unpushed commits) and asks for confirmation before proceeding.\n\nTo change the base branch before resetting, use 'arb branch base <branch>'.\n\nUse --where to filter repos by status flags. See 'arb help where' for filter syntax.\n\nSee 'arb help remotes' for remote role resolution.",
    )
    .action(
      async (
        repoArgs: string[],
        options: {
          fetch?: boolean;
          yes?: boolean;
          dryRun?: boolean;
          where?: string;
        },
      ) => {
        const where = resolveWhereFilter(options);
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
        const shouldFetch = options.fetch !== false;
        const allFetchDirs = workspaceRepoDirs(wsDir);
        const allRepos = allFetchDirs.map((d) => basename(d));
        const repos = allRepos.filter((r) => selectedSet.has(r));
        const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));

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
              return assessResetRepo(status, repoDir, branch, fetchFailed, headSha);
            }),
          );
          return assessments.filter((a): a is ResetAssessment => a !== null);
        };

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
          info(alreadyClean.length > 0 ? "All repos already at base" : "Nothing to do");
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
          const result = await git(a.repoDir, "reset", "--hard", a.target);
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
          const reportCtx = { tty: isTTY() };
          process.stderr.write(render(failureNodes, reportCtx));
        }

        // Phase 5: summary
        process.stderr.write("\n");
        const parts: string[] = [];
        parts.push(`Reset ${plural(resetOk, "repo")}`);
        if (failed.length > 0) parts.push(`${failed.length} failed`);
        if (alreadyClean.length > 0) parts.push(`${alreadyClean.length} already at base`);
        if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
        finishSummary(parts, failed.length > 0);
      },
    );
}
