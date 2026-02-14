import type { Command } from "commander";
import { integrate } from "../lib/integrate";
import type { ArbContext } from "../lib/types";

export function registerRebaseCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("rebase [repos...]")
		.option("--fetch", "Fetch all repos before rebasing")
		.option("-y, --yes", "Skip confirmation prompt")
		.summary("Rebase feature branches onto the base branch")
		.description(
			"Rebase the feature branch onto the updated base branch (e.g. main) for all repos, or only the named repos. Shows a plan and asks for confirmation before proceeding. Repos with uncommitted changes or that are already up to date are skipped. If a rebase conflicts, arb stops and shows resolution instructions.",
		)
		.action(async (repoArgs: string[], options: { fetch?: boolean; yes?: boolean }) => {
			const ctx = getCtx();
			await integrate(ctx, "rebase", options, repoArgs);
		});
}
