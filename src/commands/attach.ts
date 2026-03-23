import { basename } from "node:path";
import type { Command } from "commander";
import { ArbError, arbAction, readWorkspaceConfig } from "../lib/core";
import { finishSummary, render } from "../lib/render";
import { parallelFetch, reportFetchFailures, resolveDefaultFetch } from "../lib/sync";
import { applyRepoTemplates, applyWorkspaceTemplates, displayOverlaySummary } from "../lib/templates";
import { error, info, plural, warn } from "../lib/terminal";
import { readNamesFromStdin } from "../lib/terminal";
import { shouldColor } from "../lib/terminal";
import {
  addWorktrees,
  listDefaultRepos,
  listRepos,
  requireBranch,
  requireWorkspace,
  selectInteractive,
  workspaceRepoDirs,
} from "../lib/workspace";

export function registerAttachCommand(program: Command): void {
  program
    .command("attach [repos...]")
    .option("-a, --all-repos", "Attach all remaining repos")
    .option("--fetch", "Fetch before attaching (default)")
    .option("-N, --no-fetch", "Skip pre-fetch")
    .summary("Attach repos to the workspace")
    .description(
      "Examples:\n\n  arb attach api web                       Attach specific repos\n  arb attach --all-repos                   Attach all available repos\n  arb attach                               Interactive picker\n\nAttach one or more repos to the current workspace on the workspace's feature branch. If the workspace has a configured base branch, new branches are created from it. Fetches the selected repos before attaching for fresh remote state (skip with -N/--no-fetch). Automatically seeds files from .arb/templates/repos/ into newly attached repos and regenerates workspace-level templates that reference the repo list (those using {% for repo in workspace.repos %}). Prompts with a repo picker when run without arguments. Use --all-repos to attach all repos not yet in the workspace.",
    )
    .action(
      arbAction(async (ctx, repoArgs: string[], options) => {
        const { wsDir, workspace } = requireWorkspace(ctx);
        const branch = await requireBranch(wsDir, workspace);

        const allRepos = listRepos(ctx.reposDir);
        const currentRepos = new Set(workspaceRepoDirs(wsDir).map((d) => basename(d)));
        const available = allRepos.filter((r) => !currentRepos.has(r));

        let repos = repoArgs;
        if (options.allRepos) {
          if (available.length === 0) {
            error("All repos are already in this workspace.");
            throw new ArbError("All repos are already in this workspace.");
          }
          repos = available;
        } else if (repos.length === 0) {
          const stdinNames = await readNamesFromStdin();
          if (stdinNames.length > 0) repos = stdinNames;
        }
        if (repos.length > 0 && !options.allRepos) {
          const unknown = repos.filter((r) => !allRepos.includes(r));
          if (unknown.length > 0) {
            error(`Unknown repos: ${unknown.join(", ")}. Not found in .arb/repos/.`);
            throw new ArbError(`Unknown repos: ${unknown.join(", ")}. Not found in .arb/repos/.`);
          }
        } else if (repos.length === 0) {
          if (!process.stdin.isTTY) {
            error("No repos specified. Pass repo names or use --all-repos.");
            throw new ArbError("No repos specified. Pass repo names or use --all-repos.");
          }
          if (available.length === 0) {
            error("All repos are already in this workspace.");
            throw new ArbError("All repos are already in this workspace.");
          }
          const defaults = listDefaultRepos(ctx.arbRootDir);
          repos = await selectInteractive(available, "Select repos to attach", defaults);
          if (repos.length === 0) {
            error("No repos selected.");
            throw new ArbError("No repos selected.");
          }
        }
        const cache = ctx.cache;
        const base = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;
        const remotesMap = await cache.resolveRemotesMap(repos, ctx.reposDir);

        if (resolveDefaultFetch(options.fetch)) {
          const fetchDirs = repos.map((r) => `${ctx.reposDir}/${r}`);
          const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
          reportFetchFailures(repos, fetchResults);
        }

        const result = await addWorktrees(
          workspace,
          branch,
          repos,
          ctx.reposDir,
          ctx.arbRootDir,
          base ?? undefined,
          remotesMap,
          cache,
        );

        const changed = { added: result.created };
        const wsRepoNames = workspaceRepoDirs(wsDir).map((d) => basename(d));
        const repoTemplates = await applyRepoTemplates(ctx.arbRootDir, wsDir, wsRepoNames, changed, cache);
        const wsTemplates = await applyWorkspaceTemplates(ctx.arbRootDir, wsDir, changed, cache);
        displayOverlaySummary(wsTemplates, repoTemplates, (nodes) => render(nodes, { tty: shouldColor() }));

        process.stderr.write("\n");
        if (result.failed.length > 0 || result.skipped.length > 0) {
          if (result.created.length > 0) info(`  attached: ${result.created.join(" ")}`);
          if (result.skipped.length > 0) warn(`  skipped:  ${result.skipped.join(" ")}`);
          if (result.failed.length > 0) error(`  failed:   ${result.failed.join(" ")}`);
        }
        const parts: string[] = [];
        if (result.created.length > 0) parts.push(`Attached ${plural(result.created.length, "repo")}`);
        if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);
        if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
        if (parts.length > 0) finishSummary(parts, result.failed.length > 0);
      }),
    );
}
