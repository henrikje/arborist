import type { Command } from "commander";
import { hint } from "../lib/output";

export function registerCdCommand(program: Command): void {
	program
		.command("cd [name]")
		.summary("Navigate to a workspace")
		.description(
			"Change directory into a workspace or a worktree within a workspace. This is a shell function provided by arb.zsh — it requires the shell integration to be loaded.",
		)
		.action(() => {
			hint("The cd command requires the arb shell function.");
			hint("Add to your shell profile:  source <(arb --shell-init)");
		});
}
