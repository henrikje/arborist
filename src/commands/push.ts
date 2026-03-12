import { basename } from "node:path";
import type { Command } from "commander";
import { ArbError, readWorkspaceConfig } from "../lib/core";
import type { ArbContext } from "../lib/core";
import { GitCache, getCommitsBetweenFull, getShortHead, gitWithTimeout, networkTimeout } from "../lib/git";
import type { RepoRemotes } from "../lib/git";
import { createRenderContext, finishSummary, render } from "../lib/render";
import type { Cell, OutputNode } from "../lib/render";
import { VERBOSE_COMMIT_LIMIT, skipCell, upToDateCell, verboseCommitsToNodes } from "../lib/render";
import { cell, suffix } from "../lib/render";
import type { SkipFlag } from "../lib/status";
import { type RepoStatus, computeFlags, gatherRepoStatus, repoMatchesWhere, resolveWhereFilter } from "../lib/status";
import { classifyNetworkError, confirmOrExit, runPlanFlow } from "../lib/sync";
import { dryRunNotice, info, inlineResult, inlineStart, plural, red } from "../lib/terminal";
import { requireBranch, requireWorkspace, resolveReposFromArgsOrStdin, workspaceRepoDirs } from "../lib/workspace";

export interface PushAssessment {
  repo: string;
  repoDir: string;
  outcome: "will-push" | "will-force-push" | "will-force-push-outdated" | "up-to-date" | "skip";
  skipReason?: string;
  skipFlag?: SkipFlag;
  ahead: number;
  behind: number;
  rebased: number;
  replaced: number;
  squashed: number;
  baseAhead: number;
  baseRef: string;
  branch: string;
  shareRemote: string;
  newBranch: boolean;
  headSha: string;
  recreate: boolean;
  behindBase: number;
  drifted?: boolean;
  commits?: { shortHash: string; subject: string }[];
  totalCommits?: number;
}

export function registerPushCommand(program: Command, getCtx: () => ArbContext): void {
  program
    .command("push [repos...]")
    .option("-f, --force", "Force push with lease")
    .option("--include-merged", "Include branches already merged into base")
    .option("--include-drifted", "Include repos on a different branch than the workspace")
    .option("--fetch", "Fetch from all remotes before push (default)")
    .option("-N, --no-fetch", "Skip fetching before push")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("-v, --verbose", "Show outgoing commits in the plan")
    .option("-w, --where <filter>", "Only push repos matching status filter (comma = OR, + = AND, ^ = negate)")
    .summary("Push the feature branch to the share remote")
    .description(
      "Fetches all repos, then pushes the feature branch for all repos, or only the named repos. Pushes to the share remote (origin by default, or as configured for fork workflows). Sets up tracking on first push. Shows a plan and asks for confirmation before pushing. The plan highlights repos that are behind the base branch, with a hint to rebase before pushing. Skips repos with no commits to push, or whose branches have been merged into the base branch unless --include-merged is used. Repos on a different branch than the workspace are skipped unless --include-drifted is used; when included, they are pushed to their actual branch. If a remote branch was deleted after merge, use --include-merged to recreate it. After rebase, amend, or squash, Arborist detects that all remote commits are outdated and pushes automatically with --force-with-lease. Use --force when the remote has genuinely new commits that you want to overwrite. Use --verbose to show the outgoing commits for each repo in the plan. Fetches before push by default; use -N/--no-fetch to skip fetching when refs are known to be fresh. Use --where to filter repos by status flags. See 'arb help where' for filter syntax.\n\nSee 'arb help remotes' for remote role resolution.",
    )
    .action(
      async (
        repoArgs: string[],
        options: {
          force?: boolean;
          includeMerged?: boolean;
          includeDrifted?: boolean;
          fetch?: boolean;
          yes?: boolean;
          dryRun?: boolean;
          verbose?: boolean;
          where?: string;
        },
      ) => {
        const ctx = getCtx();
        const { wsDir, workspace } = requireWorkspace(ctx);
        const branch = await requireBranch(wsDir, workspace);
        const where = resolveWhereFilter(options);

        const selectedRepos = await resolveReposFromArgsOrStdin(wsDir, repoArgs);
        const cache = await GitCache.create();
        const remotesMap = await cache.resolveRemotesMap(selectedRepos, ctx.reposDir);
        const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;

        const shouldFetch = options.fetch !== false;
        const allFetchDirs = workspaceRepoDirs(wsDir);
        const selectedSet = new Set(selectedRepos);
        const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
        const allRepos = fetchDirs.map((d) => basename(d));

        const prevStatuses = new Map<string, RepoStatus>();
        const assess = async (_fetchFailed: string[], unchangedRepos: Set<string>) => {
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
              const headSha = await getShortHead(repoDir);
              return assessPushRepo(status, repoDir, branch, headSha, {
                force: options.force,
                includeMerged: options.includeMerged,
                includeDrifted: options.includeDrifted,
              });
            }),
          );
          const filtered = assessments.filter((a): a is PushAssessment => a !== null);
          for (const a of filtered) {
            if (a.outcome === "will-force-push" && !options.force) {
              a.outcome = "skip";
              const rebasedHint = a.rebased > 0 ? `, ${a.rebased} rebased` : "";
              a.skipReason = `diverged from ${a.shareRemote}${rebasedHint} (use --force)`;
              a.skipFlag = "diverged";
            }
          }
          return filtered;
        };

        const postAssess = options.verbose
          ? (nextAssessments: PushAssessment[]) => gatherPushVerboseCommits(nextAssessments, remotesMap)
          : undefined;

        const assessments = await runPlanFlow({
          shouldFetch,
          fetchDirs,
          reposForFetchReport: allRepos,
          remotesMap,
          assess,
          postAssess,
          formatPlan: (nextAssessments) => formatPushPlan(nextAssessments, remotesMap, options.verbose),
          onPostFetch: () => cache.invalidateAfterFetch(),
        });

        const willPush = assessments.filter(
          (a) =>
            a.outcome === "will-push" || a.outcome === "will-force-push" || a.outcome === "will-force-push-outdated",
        );
        const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
        const skipped = assessments.filter((a) => a.outcome === "skip");

        if (willPush.length === 0) {
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
          message: `Push ${plural(willPush.length, "repo")}?`,
        });

        process.stderr.write("\n");

        // Phase 4: execute
        let pushOk = 0;
        const pushTimeout = networkTimeout("ARB_PUSH_TIMEOUT", 120);

        for (const a of willPush) {
          inlineStart(a.repo, "pushing");
          const pushArgs =
            a.outcome === "will-force-push" || a.outcome === "will-force-push-outdated"
              ? ["push", "-u", "--force-with-lease", a.shareRemote, a.branch]
              : ["push", "-u", a.shareRemote, a.branch];
          const pushResult = await gitWithTimeout(a.repoDir, pushTimeout, pushArgs);
          if (pushResult.exitCode === 0) {
            inlineResult(a.repo, `pushed ${plural(a.ahead, "commit")}`);
            pushOk++;
          } else {
            inlineResult(a.repo, red("failed"));
            process.stderr.write("\n");
            const errText = pushResult.stderr.trim();
            if (errText) {
              for (const line of errText.split("\n")) {
                process.stderr.write(`  ${line}\n`);
              }
            }
            const errorClass = classifyNetworkError(errText);
            const recoveryHint =
              pushResult.exitCode === 124
                ? "Check your network connection, then re-run 'arb push' to continue. Adjust timeout with ARB_PUSH_TIMEOUT."
                : errorClass === "offline"
                  ? "Check your network connection, then re-run 'arb push' to continue."
                  : errorClass === "auth"
                    ? "Check your credentials or token, then re-run 'arb push' to continue."
                    : errorClass === "not-found"
                      ? "Verify the remote URL is correct, then re-run 'arb push' to continue."
                      : "To resolve, check the error above, then re-run 'arb push' to continue.";
            process.stderr.write(`\n  ${recoveryHint}\n`);
            throw new ArbError(`Push failed for ${a.repo}`);
          }
        }

        // Phase 5: summary
        process.stderr.write("\n");
        const parts = [`Pushed ${plural(pushOk, "repo")}`];
        if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
        if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
        finishSummary(parts, false);
      },
    );
}

export function formatPushPlan(
  assessments: PushAssessment[],
  remotesMap: Map<string, RepoRemotes>,
  verbose?: boolean,
): string {
  const nodes = buildPushPlanNodes(assessments, remotesMap, verbose);
  const ctx = createRenderContext();
  return render(nodes, ctx);
}

export function buildPushPlanNodes(
  assessments: PushAssessment[],
  remotesMap: Map<string, RepoRemotes>,
  verbose?: boolean,
): OutputNode[] {
  const nodes: OutputNode[] = [{ kind: "gap" }];

  const rows = assessments.map((a) => {
    let actionCell: Cell;
    if (a.outcome === "will-push" || a.outcome === "will-force-push" || a.outcome === "will-force-push-outdated") {
      actionCell = pushActionCell(a, remotesMap);
    } else if (a.outcome === "up-to-date") {
      actionCell = upToDateCell();
    } else {
      actionCell = skipCell(a.skipReason ?? "", a.skipFlag);
    }

    let afterRow: OutputNode[] | undefined;
    if (
      verbose &&
      (a.outcome === "will-push" || a.outcome === "will-force-push" || a.outcome === "will-force-push-outdated") &&
      a.commits &&
      a.commits.length > 0
    ) {
      const label = `Outgoing to ${a.shareRemote}:`;
      afterRow = verboseCommitsToNodes(a.commits, a.totalCommits ?? a.commits.length, label);
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

  const behindBaseCount = assessments.filter(
    (a) =>
      (a.outcome === "will-push" || a.outcome === "will-force-push" || a.outcome === "will-force-push-outdated") &&
      a.behindBase > 0,
  ).length;
  if (behindBaseCount > 0) {
    nodes.push({
      kind: "hint",
      cell: cell(
        `  hint: ${plural(behindBaseCount, "repo")} behind base — consider 'arb rebase' before pushing`,
        "muted",
      ),
    });
  }

  const mergedNewWorkCount = assessments.filter((a) => a.skipFlag === "merged-new-work").length;
  if (mergedNewWorkCount > 0) {
    nodes.push({
      kind: "hint",
      cell: cell(
        `  hint: ${plural(mergedNewWorkCount, "repo")} ${mergedNewWorkCount === 1 ? "was" : "were"} merged but ${mergedNewWorkCount === 1 ? "has" : "have"} new commits since — run 'arb rebase' first`,
        "muted",
      ),
    });
  }

  const driftedCount = assessments.filter(
    (a) =>
      a.drifted &&
      (a.outcome === "will-push" || a.outcome === "will-force-push" || a.outcome === "will-force-push-outdated"),
  ).length;
  if (driftedCount > 0) {
    nodes.push({
      kind: "hint",
      cell: cell(`  hint: ${plural(driftedCount, "repo")} on a different branch than the workspace`, "muted"),
    });
  }

  nodes.push({ kind: "gap" });
  return nodes;
}

export function pushActionCell(a: PushAssessment, remotesMap: Map<string, RepoRemotes>): Cell {
  const remotes = remotesMap.get(a.repo);
  const forkText = remotes && remotes.base !== remotes.share ? ` → ${a.shareRemote}` : "";

  let result: Cell;

  if (a.outcome === "will-push") {
    const remoteBranch = `${a.shareRemote}/${a.branch}`;
    const newBranchSuffix = a.recreate
      ? ` (recreate: ${remoteBranch})`
      : a.newBranch
        ? ` (new branch: ${remoteBranch})`
        : "";
    let desc: string;
    if (a.baseAhead > 0 || a.rebased > 0) {
      const fromBase = Math.max(0, a.ahead - a.baseAhead);
      const newCount = Math.max(0, a.ahead - fromBase - a.rebased);
      const parts: string[] = [];
      if (fromBase > 0) parts.push(`${fromBase} from ${a.baseRef}`);
      if (a.rebased > 0) parts.push(`${a.rebased} rebased`);
      if (newCount > 0) parts.push(`${newCount} new`);
      desc = parts.length > 0 ? parts.join(" + ") : plural(a.ahead, "commit");
    } else {
      desc = plural(a.ahead, "commit");
    }
    result = cell(`${desc} to push${newBranchSuffix}`);
    if (a.behindBase > 0) {
      result = suffix(result, ` (${a.behindBase} behind base)`, "attention");
    }
    if (forkText) result = suffix(result, forkText);
    if (a.headSha) result = suffix(result, `  (HEAD ${a.headSha})`, "muted");
  } else if (a.outcome === "will-force-push-outdated") {
    // will-force-push-outdated — all remote commits are accounted for (rebased, replaced, or squashed)
    const outdatedSuffix = ` (replaces ${a.behind} outdated on ${a.shareRemote})`;
    if (a.baseAhead > 0 || a.rebased > 0) {
      const fromBase = Math.max(0, a.ahead - a.baseAhead);
      const newCount = Math.max(0, a.ahead - fromBase - a.rebased);
      const parts: string[] = [];
      if (fromBase > 0) parts.push(`${fromBase} from ${a.baseRef}`);
      if (a.rebased > 0) parts.push(`${a.rebased} rebased`);
      if (newCount > 0) parts.push(`${newCount} new`);
      const desc = parts.length > 0 ? parts.join(" + ") : plural(a.ahead, "commit");
      result = cell(`${desc} to push${outdatedSuffix}`);
      if (a.behindBase > 0) {
        result = suffix(result, ` (${a.behindBase} behind base)`, "attention");
      }
      if (a.headSha) result = suffix(result, `  (HEAD ${a.headSha})`, "muted");
    } else {
      result = cell(`${plural(a.ahead, "commit")} to push${outdatedSuffix}`);
      if (a.behindBase > 0) {
        result = suffix(result, ` (${a.behindBase} behind base)`, "attention");
      }
      if (a.headSha) result = suffix(result, `  (HEAD ${a.headSha})`, "muted");
    }
  } else if (a.baseAhead > 0 || a.rebased > 0) {
    // will-force-push with base info
    const fromBase = Math.max(0, a.ahead - a.baseAhead);
    const newCount = Math.max(0, a.ahead - fromBase - a.rebased);
    const parts: string[] = [];
    if (fromBase > 0) parts.push(`${fromBase} from ${a.baseRef}`);
    if (a.rebased > 0) parts.push(`${a.rebased} rebased`);
    if (newCount > 0) parts.push(`${newCount} new`);
    const desc = parts.length > 0 ? parts.join(" + ") : plural(a.ahead, "commit");
    result = cell(`${desc} to push (force)`);
    if (a.behindBase > 0) {
      result = suffix(result, ` (${a.behindBase} behind base)`, "attention");
    }
    if (a.headSha) result = suffix(result, `  (HEAD ${a.headSha})`, "muted");
  } else {
    // will-force-push without base info
    result = cell(`${plural(a.ahead, "commit")} to push (force \u2014 ${a.behind} behind ${a.shareRemote})`);
    if (a.behindBase > 0) {
      result = suffix(result, ` (${a.behindBase} behind base)`, "attention");
    }
    if (a.headSha) result = suffix(result, `  (HEAD ${a.headSha})`, "muted");
  }

  if (a.drifted) {
    result = suffix(result, ` (branch: ${a.branch})`, "attention");
  }

  return result;
}

async function gatherPushVerboseCommits(
  assessments: PushAssessment[],
  remotesMap: Map<string, RepoRemotes>,
): Promise<void> {
  await Promise.all(
    assessments
      .filter(
        (a) => a.outcome === "will-push" || a.outcome === "will-force-push" || a.outcome === "will-force-push-outdated",
      )
      .map(async (a) => {
        const shareRemote = remotesMap.get(a.repo)?.share;
        if (!shareRemote) return;
        // For new branches or recreated branches, use the base remote's base branch
        const ref =
          a.newBranch || a.recreate
            ? `${remotesMap.get(a.repo)?.base ?? shareRemote}/HEAD`
            : `${shareRemote}/${a.branch}`;
        const commits = await getCommitsBetweenFull(a.repoDir, ref, "HEAD");
        const total = commits.length;
        a.commits = commits.slice(0, VERBOSE_COMMIT_LIMIT).map((c) => ({
          shortHash: c.shortHash,
          subject: c.subject,
        }));
        a.totalCommits = total;
      }),
  );
}

export function assessPushRepo(
  status: RepoStatus,
  repoDir: string,
  branch: string,
  headSha: string,
  options?: { force?: boolean; includeMerged?: boolean; includeDrifted?: boolean },
): PushAssessment {
  const behindBase = status.base?.behind ?? 0;

  const base: PushAssessment = {
    repo: status.name,
    repoDir,
    outcome: "skip",
    ahead: 0,
    behind: 0,
    rebased: 0,
    replaced: 0,
    squashed: 0,
    baseAhead: status.base?.ahead ?? 0,
    baseRef: status.base?.ref ?? "base",
    branch,
    shareRemote: status.share.remote,
    newBranch: false,
    headSha,
    recreate: false,
    behindBase,
  };

  // Branch check — detached or drifted
  if (status.identity.headMode.kind === "detached") {
    return { ...base, skipReason: "HEAD is detached", skipFlag: "detached-head" };
  }
  if (status.identity.headMode.branch !== branch) {
    if (!options?.includeDrifted) {
      return {
        ...base,
        skipReason: `on branch ${status.identity.headMode.branch}, expected ${branch} (use --include-drifted)`,
        skipFlag: "drifted",
      };
    }
    base.branch = status.identity.headMode.branch;
    base.drifted = true;
  }

  // Base branch merged into default — retarget before pushing
  if (status.base?.baseMergedIntoDefault != null) {
    const baseName = status.base.configuredRef ?? status.base.ref;
    return {
      ...base,
      skipReason: `base branch ${baseName} was merged into default (retarget first with 'arb rebase --retarget')`,
      skipFlag: "base-merged-into-default",
    };
  }

  // Remote branch was deleted (gone)
  if (status.share.refMode === "gone") {
    if (status.base?.mergedIntoBase != null && !options?.includeMerged) {
      const n = status.base.newCommitsAfterMerge;
      if (n && n > 0) {
        return {
          ...base,
          skipReason: `branch was merged into ${status.base.ref}, but has ${n} new ${n === 1 ? "commit" : "commits"} since (rebase or use --include-merged to push)`,
          skipFlag: "merged-new-work",
        };
      }
      return {
        ...base,
        skipReason: `already merged into ${status.base.ref} (use --include-merged to recreate)`,
        skipFlag: "already-merged",
      };
    }
    const ahead = status.base?.ahead ?? 1;
    return { ...base, outcome: "will-push", ahead, recreate: true };
  }

  // Merged but not gone — nothing useful to push unless forced
  if (status.base?.mergedIntoBase != null && !options?.includeMerged) {
    const n = status.base.newCommitsAfterMerge;
    if (n && n > 0) {
      return {
        ...base,
        skipReason: `branch was merged into ${status.base.ref}, but has ${n} new ${n === 1 ? "commit" : "commits"} since (rebase or use --include-merged to push)`,
        skipFlag: "merged-new-work",
      };
    }
    return {
      ...base,
      skipReason: `already merged into ${status.base.ref} (use --include-merged)`,
      skipFlag: "already-merged",
    };
  }

  // Never pushed (noRef) — new branch
  if (status.share.refMode === "noRef") {
    const ahead = status.base?.ahead ?? 1;
    if (ahead === 0) {
      return { ...base, outcome: "skip", skipReason: "no commits to push", skipFlag: "no-commits" };
    }
    return { ...base, outcome: "will-push", ahead, newBranch: true };
  }

  // Has push/pull counts — compare
  const toPush = status.share.toPush ?? 0;
  const toPull = status.share.toPull ?? 0;

  if (toPush === 0 && toPull === 0) {
    return { ...base, outcome: "up-to-date" };
  }

  if (toPush === 0 && toPull > 0) {
    return {
      ...base,
      outcome: "skip",
      skipReason: `behind ${status.share.remote} (pull first?)`,
      skipFlag: "behind-remote",
      behind: toPull,
    };
  }

  if (toPush > 0 && toPull > 0) {
    const rebased = status.share.rebased ?? 0;
    const replaced = status.share.replaced ?? 0;
    const squashed = status.share.squashed ?? 0;
    const allOutdated = rebased + replaced + squashed >= toPull;
    if (allOutdated) {
      return {
        ...base,
        outcome: "will-force-push-outdated",
        ahead: toPush,
        behind: toPull,
        rebased,
        replaced,
        squashed,
      };
    }
    return { ...base, outcome: "will-force-push", ahead: toPush, behind: toPull, rebased, replaced, squashed };
  }

  return { ...base, outcome: "will-push", ahead: toPush };
}
