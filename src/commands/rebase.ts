import type { Command } from "commander";
import { integrate } from "../lib/integrate";
import { readNamesFromStdin } from "../lib/stdin";
import type { ArbContext } from "../lib/types";

export function registerRebaseCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("rebase [repos...]")
		.option("--fetch", "Fetch from all remotes before rebase (default)")
		.option("-N, --no-fetch", "Skip fetching before rebase")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-n, --dry-run", "Show what would happen without executing")
		.option("-v, --verbose", "Show incoming commits in the plan")
		.option("-g, --graph", "Show branch divergence graph in the plan")
		.option("--autostash", "Stash uncommitted changes before rebase, re-apply after")
		.option(
			"--retarget [branch]",
			"Retarget repos whose base has been merged; optionally specify the new base branch (defaults to the default branch)",
		)
		.summary("Rebase feature branches onto the base branch")
		.description(
			"Fetches all repos, then rebases the feature branch onto the updated base branch (e.g. main) for all repos, or only the named repos. Shows a plan and asks for confirmation before proceeding. Repos with uncommitted changes are skipped unless --autostash is used. Repos already up to date are skipped. If any repos conflict, arb continues with the remaining repos and reports all conflicts at the end with per-repo resolution instructions. Fetches before rebase by default; use -N/--no-fetch to skip fetching when refs are known to be fresh. Use --autostash to stash uncommitted changes before rebasing and re-apply them after. Use --verbose to show the incoming commits for each repo in the plan. Use --graph to show a branch divergence diagram with the merge-base point. Combine --graph --verbose to see commits inline in the diagram. Use --retarget when the configured base branch has been merged — this rebases onto the default branch and updates the workspace config. Use --retarget <branch> for deep stacks where the base was merged into a non-default branch (e.g. --retarget feat/A when B was merged into A).",
		)
		.action(
			async (
				repoArgs: string[],
				options: {
					fetch?: boolean;
					yes?: boolean;
					dryRun?: boolean;
					verbose?: boolean;
					graph?: boolean;
					retarget?: string | boolean;
					autostash?: boolean;
				},
			) => {
				let repoNames = repoArgs;
				if (repoNames.length === 0) {
					const stdinNames = await readNamesFromStdin();
					if (stdinNames.length > 0) repoNames = stdinNames;
				}
				const ctx = getCtx();
				await integrate(ctx, "rebase", options, repoNames);
			},
		);
}
