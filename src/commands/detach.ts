import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { Command } from "commander";
import { ArbError } from "../lib/core";
import type { ArbContext } from "../lib/core";
import { branchExistsLocally, createCommandCache, git, isRepoDirty, parseGitStatus } from "../lib/git";
import { type RenderContext, render } from "../lib/render";
import { cell } from "../lib/render";
import type { OutputNode } from "../lib/render";
import { isLocalDirty } from "../lib/status";
import { confirmOrExit, parallelFetch, reportFetchFailures } from "../lib/sync";
import { applyRepoTemplates, applyWorkspaceTemplates, displayOverlaySummary } from "../lib/templates";
import {
  dryRunNotice,
  error,
  inlineResult,
  inlineStart,
  isTTY,
  plural,
  readNamesFromStdin,
  success,
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
      action: a.outcome === "will-detach" ? cell("detach") : cell(a.skipReason ?? "skip", "attention"),
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

export function registerDetachCommand(program: Command, getCtx: () => ArbContext): void {
  program
    .command("detach [repos...]")
    .option("-f, --force", "Force detach even with uncommitted changes")
    .option("-a, --all-repos", "Detach all repos from the workspace")
    .option("--delete-branch", "Delete the local branch from the canonical repo")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("--fetch", "Fetch before detaching (default)")
    .option("-N, --no-fetch", "Skip pre-fetch")
    .summary("Detach repos from the workspace")
    .description(
      "Detach one or more repos from the current workspace without deleting the workspace itself. Shows a plan and asks for confirmation before proceeding. Regenerates templates that reference the repo list (those using {% for repo in workspace.repos %}) to reflect the updated repo list. Skips repos with uncommitted changes unless --force is used. Use --all-repos to detach all repos. Use --delete-branch to also delete the local branch from the canonical repo. Fetches the selected repos before detaching for fresh state (skip with -N/--no-fetch). Use --yes to skip the confirmation prompt. Use --dry-run to see what would happen without executing.",
    )
    .action(
      async (
        repoArgs: string[],
        options: {
          force?: boolean;
          allRepos?: boolean;
          deleteBranch?: boolean;
          yes?: boolean;
          dryRun?: boolean;
          fetch?: boolean;
        },
      ) => {
        const ctx = getCtx();
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

        // Phase 1: fetch
        if (options.fetch !== false) {
          const presentRepos = repos.filter((repo) => existsSync(`${wsDir}/${repo}`));
          if (presentRepos.length > 0) {
            const cache = await createCommandCache();
            const fetchDirs = presentRepos.map((repo) => `${wsDir}/${repo}`);
            const remotesMap = await cache.resolveRemotesMap(presentRepos, ctx.reposDir);
            const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
            reportFetchFailures(presentRepos, fetchResults);
          }
        }

        // Phase 2: assess
        const assessments: DetachAssessment[] = [];

        for (const repo of repos) {
          const wtPath = `${wsDir}/${repo}`;

          if (!existsSync(wtPath) || !existsSync(`${wtPath}/.git`)) {
            assessments.push({ repo, outcome: "skip", skipReason: "not in this workspace" });
            continue;
          }

          if (!options.force) {
            if (isLocalDirty(await parseGitStatus(wtPath))) {
              assessments.push({
                repo,
                outcome: "skip",
                skipReason: "uncommitted changes (use --force to override)",
              });
              continue;
            }
          }

          assessments.push({ repo, outcome: "will-detach" });
        }

        const willDetach = assessments.filter((a) => a.outcome === "will-detach");
        const skipped = assessments.filter((a) => a.outcome === "skip");

        if (willDetach.length === 0) {
          if (skipped.length > 0) {
            for (const a of skipped) {
              warn(`  [${a.repo}] ${a.skipReason} — skipping`);
            }
          }
          process.stderr.write("\n");
          warn("Nothing to detach.");
          return;
        }

        // Phase 3: plan
        const planNodes = buildDetachPlanNodes(assessments);
        const rCtx: RenderContext = { tty: isTTY() };
        process.stderr.write(render(planNodes, rCtx));

        if (options.dryRun) {
          dryRunNotice();
          return;
        }

        // Phase 4: confirm
        await confirmOrExit({
          yes: options.yes,
          message: `Detach ${plural(willDetach.length, "repo")}?`,
        });

        process.stderr.write("\n");

        // Phase 5: execute
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
            const removeResult = await git(canonicalDir, ...removeArgs);
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
              const delResult = await git(`${ctx.reposDir}/${repo}`, "branch", "-d", branch);
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
          displayOverlaySummary(wsTemplates, repoTemplates, (nodes) => render(nodes, { tty: isTTY() }));
        }

        // Phase 6: summarize
        process.stderr.write("\n");
        if (detached.length > 0) success(`Detached ${plural(detached.length, "repo")} from ${ctx.currentWorkspace}`);
        if (skipped.length > 0) warn(`Skipped: ${skipped.map((a) => a.repo).join(" ")}`);
      },
    );
}
