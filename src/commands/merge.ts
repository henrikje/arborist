import type { Command } from "commander";
import { integrate } from "../lib/integrate";
import { readNamesFromStdin } from "../lib/stdin";
import type { ArbContext } from "../lib/types";

export function registerMergeCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("merge [repos...]")
		.option("--fetch", "Fetch from all remotes before merge (default)")
		.option("-N, --no-fetch", "Skip fetching before merge")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-n, --dry-run", "Show what would happen without executing")
		.option("-v, --verbose", "Show incoming commits in the plan")
		.option("-g, --graph", "Show branch divergence graph in the plan")
		.option("--autostash", "Stash uncommitted changes before merge, re-apply after")
		.summary("Merge the base branch into feature branches")
		.description(
			"Fetches all repos, then merges the base branch (e.g. main) into the feature branch for all repos, or only the named repos. Shows a plan and asks for confirmation before proceeding. Repos with uncommitted changes are skipped unless --autostash is used. Repos already up to date are skipped. If any repos conflict, arb continues with the remaining repos and reports all conflicts at the end with per-repo resolution instructions. Fetches before merge by default; use -N/--no-fetch to skip fetching when refs are known to be fresh. Use --verbose to show the incoming commits for each repo in the plan. Use --graph to show a branch divergence diagram with the merge-base point. Combine --graph --verbose to see commits inline in the diagram. Use --autostash to stash uncommitted changes before merging and re-apply them after.",
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
					autostash?: boolean;
				},
			) => {
				let repoNames = repoArgs;
				if (repoNames.length === 0) {
					const stdinNames = await readNamesFromStdin();
					if (stdinNames.length > 0) repoNames = stdinNames;
				}
				const ctx = getCtx();
				await integrate(ctx, "merge", options, repoNames);
			},
		);
}
