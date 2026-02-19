import type { Command } from "commander";
import { integrate } from "../lib/integrate";
import type { ArbContext } from "../lib/types";

export function registerRebaseCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("rebase [repos...]")
		.option("-F, --no-fetch", "Skip fetching before rebase")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-n, --dry-run", "Show what would happen without executing")
		.option("--retarget", "Retarget repos whose base branch has been merged into the default branch")
		.summary("Rebase feature branches onto the base branch")
		.description(
			"Fetches all repos, then rebases the feature branch onto the updated base branch (e.g. main) for all repos, or only the named repos. Shows a plan and asks for confirmation before proceeding. Repos with uncommitted changes or that are already up to date are skipped. If any repos conflict, arb continues with the remaining repos and reports all conflicts at the end with per-repo resolution instructions. Use --no-fetch to skip fetching when refs are known to be fresh. Use --retarget when the configured base branch has been merged into the default branch — this rebases onto the default branch and updates the workspace config.",
		)
		.action(
			async (repoArgs: string[], options: { fetch?: boolean; yes?: boolean; dryRun?: boolean; retarget?: boolean }) => {
				const ctx = getCtx();
				await integrate(ctx, "rebase", options, repoArgs);
			},
		);
}
