import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { Command } from "commander";
import { ArbError, arbAction, readWorkspaceConfig } from "../lib/core";
import { branchExistsLocally, detectOperation, gitLocal, isRepoDirty } from "../lib/git";
import { createRenderContext, finishSummary, render, skipCell } from "../lib/render";
import { cell } from "../lib/render";
import type { OutputNode } from "../lib/render";
import { LOSE_WORK_FLAGS, type RepoFlags, computeFlags, gatherRepoStatus, wouldLoseWork } from "../lib/status";
import { confirmOrExit, resolveDefaultFetch, runPlanFlow } from "../lib/sync";
import { applyRepoTemplates, applyWorkspaceTemplates, displayOverlaySummary } from "../lib/templates";
import {
  dryRunNotice,
  error,
  info,
  inlineResult,
  inlineStart,
  plural,
  readNamesFromStdin,
  shouldColor,
  warn,
} from "../lib/terminal";
import {
  isWorktreeRefValid,
  listRepos,
  pruneWorktreeEntriesForDir,
  requireBranch,
  requireWorkspace,
  selectInteractive,
  workspaceRepoDirs,
} from "../lib/workspace";

interface DetachAssessment {
  repo: string;
  outcome: "will-detach" | "skip";
  skipReason?: string;
}

function buildDetachPlanNodes(assessments: DetachAssessment[]): OutputNode[] {
  const rows = assessments.map((a) => ({
    cells: {
      repo: cell(a.repo),
      action: a.outcome === "will-detach" ? cell("detach") : skipCell(a.skipReason ?? ""),
    },
  }));
  return [
    { kind: "gap" },
    {
      kind: "table",
      columns: [
        { header: "REPO", key: "repo" },
        { header: "ACTION", key: "action" },
      ],
      rows,
    },
    { kind: "gap" },
  ];
}

function formatDetachPlan(assessments: DetachAssessment[]): string {
  const nodes = buildDetachPlanNodes(assessments);
  const ctx = createRenderContext();
  return render(nodes, ctx);
}

const DETACH_SKIP_LABELS: Partial<Record<keyof RepoFlags, string>> = {
  isDirty: "uncommitted changes",
  isAheadOfShare: "unpushed commits",
  hasOperation: "operation in progress",
  isDetached: "detached HEAD",
  isWrongBranch: "wrong branch",
};

export function registerDetachCommand(program: Command): void {
  program
    .command("detach [repos...]")
    .option("-f, --force", "Force detach even with at-risk repos (uncommitted changes, unpushed commits, etc.)")
    .option("-a, --all-repos", "Detach all repos from the workspace")
    .option("--delete-branch", "Delete the local branch from the canonical repo")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("--fetch", "Fetch before detaching (default)")
    .option("-N, --no-fetch", "Skip pre-fetch")
    .summary("Detach repos from the workspace")
    .description(
      "Examples:\n\n  arb detach api                           Detach a single repo\n  arb detach api web --delete-branch       Detach and delete local branch\n  arb detach --all-repos --force           Detach all, skip safety checks\n\nDetach one or more repos from the current workspace without deleting the workspace itself. Shows a plan and asks for confirmation before proceeding. Regenerates templates that reference the repo list (those using {% for repo in workspace.repos %}) to reflect the updated repo list. Skips repos with at-risk state (uncommitted changes, unpushed commits, operation in progress, detached HEAD, wrong branch) unless --force is used. Use --all-repos to detach all repos. Use --delete-branch to also delete the local branch from the canonical repo. Fetches the selected repos before detaching for fresh state (skip with -N/--no-fetch). Use --yes to skip the confirmation prompt. Use --dry-run to see what would happen without executing.",
    )
    .action(
      arbAction(async (ctx, repoArgs: string[], options) => {
        const { wsDir, workspace } = requireWorkspace(ctx);
        const branch = await requireBranch(wsDir, workspace);

        const currentRepos = workspaceRepoDirs(wsDir).map((d) => basename(d));

        let repos = repoArgs;
        if (options.allRepos) {
          if (currentRepos.length === 0) {
            error("No repos in this workspace.");
            throw new ArbError("No repos in this workspace.");
          }
          repos = currentRepos;
        } else if (repos.length === 0) {
          const stdinNames = await readNamesFromStdin();
          if (stdinNames.length > 0) repos = stdinNames;
        }
        if (repos.length === 0) {
          if (!process.stdin.isTTY) {
            error("No repos specified. Pass repo names or use --all-repos.");
            throw new ArbError("No repos specified. Pass repo names or use --all-repos.");
          }
          if (currentRepos.length === 0) {
            error("No repos in this workspace.");
            throw new ArbError("No repos in this workspace.");
          }
          repos = await selectInteractive(currentRepos, "Select repos to detach");
          if (repos.length === 0) {
            error("No repos selected.");
            throw new ArbError("No repos selected.");
          }
        }

        if (!options.allRepos) {
          const allRepos = listRepos(ctx.reposDir);
          const unknown = repos.filter((r) => !allRepos.includes(r));
          if (unknown.length > 0) {
            error(`Unknown repos: ${unknown.join(", ")}. Not found in .arb/repos/.`);
            throw new ArbError(`Unknown repos: ${unknown.join(", ")}. Not found in .arb/repos/.`);
          }
        }

        const cache = ctx.cache;
        const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;

        // Only fetch repos that exist in the workspace
        const presentRepos = repos.filter((repo) => existsSync(`${wsDir}/${repo}`));
        const fetchDirs = presentRepos.map((repo) => `${wsDir}/${repo}`);
        const remotesMap = await cache.resolveRemotesMap(presentRepos, ctx.reposDir);

        // Phase 1-2: fetch + assess + plan (via runPlanFlow)
        const assess = async (): Promise<DetachAssessment[]> => {
          const results: DetachAssessment[] = [];

          for (const repo of repos) {
            const wtPath = `${wsDir}/${repo}`;

            if (!existsSync(wtPath) || !existsSync(`${wtPath}/.git`)) {
              results.push({ repo, outcome: "skip", skipReason: "not in this workspace" });
              continue;
            }

            const operation = await detectOperation(wtPath);
            if (operation !== null) {
              results.push({ repo, outcome: "skip", skipReason: `${operation} in progress` });
              continue;
            }

            if (!options.force) {
              try {
                const status = await gatherRepoStatus(
                  wtPath,
                  ctx.reposDir,
                  configBase,
                  undefined,
                  cache,
                  ctx.analysisCache,
                );
                const flags = computeFlags(status, branch);
                if (wouldLoseWork(flags)) {
                  const reasons = [...LOSE_WORK_FLAGS]
                    .filter((f) => flags[f])
                    .map((f) => DETACH_SKIP_LABELS[f] ?? f)
                    .join(", ");
                  results.push({
                    repo,
                    outcome: "skip",
                    skipReason: `${reasons} (use --force to override)`,
                  });
                  continue;
                }
              } catch {
                results.push({
                  repo,
                  outcome: "skip",
                  skipReason: "could not determine status (use --force to override)",
                });
                continue;
              }
            }

            results.push({ repo, outcome: "will-detach" });
          }

          return results;
        };

        const assessments = await runPlanFlow({
          shouldFetch: resolveDefaultFetch(options.fetch),
          fetchDirs,
          reposForFetchReport: presentRepos,
          remotesMap,
          assess,
          formatPlan: formatDetachPlan,
          onPostFetch: () => cache.invalidateAfterFetch(),
        });

        const willDetach = assessments.filter((a) => a.outcome === "will-detach");
        const skipped = assessments.filter((a) => a.outcome === "skip");

        if (willDetach.length === 0) {
          info("Nothing to detach");
          return;
        }

        if (options.dryRun) {
          dryRunNotice();
          return;
        }

        // Phase 3: confirm
        await confirmOrExit({
          yes: options.yes,
          message: `Detach ${plural(willDetach.length, "repo")}?`,
        });

        process.stderr.write("\n");

        // Phase 4: execute
        const detached: string[] = [];

        for (const a of willDetach) {
          const repo = a.repo;
          const wtPath = `${wsDir}/${repo}`;

          inlineStart(repo, "detaching");
          const canonicalDir = `${ctx.reposDir}/${repo}`;

          if (!isWorktreeRefValid(join(wsDir, repo))) {
            rmSync(wtPath, { recursive: true, force: true });
          } else {
            const removeArgs = ["worktree", "remove"];
            if (options.force) removeArgs.push("--force");
            removeArgs.push(wtPath);
            const removeResult = await gitLocal(canonicalDir, ...removeArgs);
            if (removeResult.exitCode !== 0) {
              rmSync(wtPath, { recursive: true, force: true });
              await pruneWorktreeEntriesForDir(canonicalDir, wsDir);
            }
          }
          inlineResult(repo, "detached");

          if (options.deleteBranch) {
            if (await isRepoDirty(`${ctx.reposDir}/${repo}`)) {
              warn(`  [${repo}] canonical repo has uncommitted changes`);
            }
            if (await branchExistsLocally(`${ctx.reposDir}/${repo}`, branch)) {
              inlineStart(repo, `deleting branch ${branch}`);
              const delResult = await gitLocal(`${ctx.reposDir}/${repo}`, "branch", "-d", branch);
              if (delResult.exitCode === 0) {
                inlineResult(repo, "branch deleted");
              } else {
                warn(`  [${repo}] failed (branch not fully merged, use git branch -D to force)`);
              }
            }
          }

          detached.push(repo);
        }

        if (detached.length > 0) {
          const changed = { removed: detached };
          const remainingRepos = workspaceRepoDirs(wsDir).map((d) => basename(d));
          const wsTemplates = await applyWorkspaceTemplates(ctx.arbRootDir, wsDir, changed);
          const repoTemplates = await applyRepoTemplates(ctx.arbRootDir, wsDir, remainingRepos, changed);
          displayOverlaySummary(wsTemplates, repoTemplates, (nodes) => render(nodes, { tty: shouldColor() }));
        }

        // Phase 5: summarize
        process.stderr.write("\n");
        const parts = [`Detached ${plural(detached.length, "repo")}`];
        if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
        finishSummary(parts, false);
      }),
    );
}
