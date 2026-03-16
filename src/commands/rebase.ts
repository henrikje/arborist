import type { Command } from "commander";
import { arbAction } from "../lib/core";
import { integrate } from "../lib/sync";
import { requireWorkspace, resolveReposFromArgsOrStdin } from "../lib/workspace";

export function registerRebaseCommand(program: Command): void {
  program
    .command("rebase [repos...]")
    .option("--fetch", "Fetch from all remotes before rebase (default)")
    .option("-N, --no-fetch", "Skip fetching before rebase")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("-v, --verbose", "Show incoming commits in the plan")
    .option("-g, --graph", "Show branch divergence graph in the plan")
    .option("--autostash", "Stash uncommitted changes before rebase, re-apply after")
    .option("--include-wrong-branch", "Include repos on a different branch than the workspace")
    .option(
      "--retarget [branch]",
      "Retarget repos whose base has been merged; optionally specify the new base branch (defaults to the default branch)",
    )
    .option("-w, --where <filter>", "Only rebase repos matching status filter (comma = OR, + = AND, ^ = negate)")
    .summary("Rebase feature branches onto the base branch")
    .description(
      "Fetches all repos, then rebases the feature branch onto the updated base branch (e.g. main) for all repos, or only the named repos. Shows a plan and asks for confirmation before proceeding.\n\nRepos with uncommitted changes are skipped unless --autostash is used. Repos on a different branch than the workspace are skipped unless --include-wrong-branch is used. Repos already up to date are skipped.\n\nIf any repos conflict, arb continues with the remaining repos and reports all conflicts at the end with per-repo resolution instructions.\n\nFetches before rebase by default; use -N/--no-fetch to skip fetching when refs are known to be fresh. Use --autostash to stash uncommitted changes before rebasing and re-apply them after.\n\nUse --verbose to show the incoming commits for each repo in the plan. Use --graph to show a branch divergence diagram with the merge-base point. Combine --graph --verbose to see commits inline in the diagram.\n\nUse --retarget when the configured base branch has been merged — this rebases onto the default branch and updates the workspace config. Use --retarget <branch> for deep stacks where the base was merged into a non-default branch (e.g. --retarget feat/A when B was merged into A).\n\nUse --where to filter repos by status flags. See 'arb help where' for filter syntax. See 'arb help remotes' for remote role resolution. See 'arb help stacked' for stacked workspace workflows.",
    )
    .action(
      arbAction(async (ctx, repoArgs: string[], options) => {
        const { wsDir } = requireWorkspace(ctx);
        const repoNames = await resolveReposFromArgsOrStdin(wsDir, repoArgs);
        await integrate(ctx, "rebase", options, repoNames);
      }),
    );
}
