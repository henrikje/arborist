import { type Command, Option } from "commander";
import { arbAction } from "../lib/core";
import { integrate } from "../lib/sync";
import { requireWorkspace, resolveReposFromArgsOrStdin } from "../lib/workspace";

export function registerMergeCommand(program: Command): void {
  program
    .command("merge [repos...]")
    .option("--fetch", "Fetch from all remotes before merge (default)")
    .option("-N, --no-fetch", "Skip fetching before merge")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Show what would happen without executing")
    .option("-v, --verbose", "Show incoming commits in the plan")
    .option("-g, --graph", "Show branch divergence graph in the plan")
    .option("--autostash", "Stash uncommitted changes before merge, re-apply after")
    .option("--include-wrong-branch", "Include repos on a different branch than the workspace")
    .option("-w, --where <filter>", "Only merge repos matching status filter (comma = OR, + = AND, ^ = negate)")
    .addOption(new Option("--continue", "Resume after resolving conflicts").conflicts("abort"))
    .addOption(new Option("--abort", "Cancel the in-progress merge and restore pre-merge state").conflicts("continue"))
    .summary("Merge the base branch into feature branches")
    .description(
      "Examples:\n\n  arb merge                                Merge base into all repos\n  arb merge api web                        Merge in specific repos\n  arb merge --verbose --graph              Show commits and divergence diagram\n\nFetches all repos, then merges the base branch (e.g. main) into the feature branch for all repos, or only the named repos. Shows a plan and asks for confirmation before proceeding.\n\nRepos with uncommitted changes are skipped unless --autostash is used. Repos on a different branch than the workspace are skipped unless --include-wrong-branch is used. Repos already up to date are skipped.\n\nIf any repos conflict, arb continues with the remaining repos and reports all conflicts at the end with per-repo resolution instructions.\n\nFetches before merge by default; use -N/--no-fetch to skip fetching when refs are known to be fresh. Use --autostash to stash uncommitted changes before merging and re-apply them after.\n\nUse --verbose to show the incoming commits for each repo in the plan. Use --graph to show a branch divergence diagram with the merge-base point. Combine --graph --verbose to see commits inline in the diagram.\n\nUse --where to filter repos by status flags. See 'arb help filtering' for filter syntax. See 'arb help remotes' for remote role resolution.",
    )
    .action(
      arbAction(async (ctx, repoArgs: string[], options) => {
        if ((options.continue || options.abort) && repoArgs.length > 0) {
          const { ArbError } = await import("../lib/core");
          const { error } = await import("../lib/terminal");
          const flag = options.continue ? "--continue" : "--abort";
          error(`${flag} does not accept repo arguments`);
          throw new ArbError(`${flag} does not accept repo arguments`);
        }
        const { wsDir } = requireWorkspace(ctx);
        const repoNames = await resolveReposFromArgsOrStdin(wsDir, repoArgs);
        await integrate(ctx, "merge", options, repoNames);
      }),
    );
}
