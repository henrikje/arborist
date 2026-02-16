import type { Command } from "commander";
import { integrate } from "../lib/integrate";
import type { ArbContext } from "../lib/types";

export function registerMergeCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("merge [repos...]")
		.option("--fetch", "Fetch all repos before merging")
		.option("-y, --yes", "Skip confirmation prompt")
		.summary("Merge the base branch into feature branches")
		.description(
			"Merge the base branch (e.g. main) into the feature branch for all repos, or only the named repos. Shows a plan and asks for confirmation before proceeding. Repos with uncommitted changes or that are already up to date are skipped. If any repos conflict, arb continues with the remaining repos and reports all conflicts at the end with per-repo resolution instructions.",
		)
		.action(async (repoArgs: string[], options: { fetch?: boolean; yes?: boolean }) => {
			const ctx = getCtx();
			await integrate(ctx, "merge", options, repoArgs);
		});
}
