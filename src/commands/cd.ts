import type { Command } from "commander";
import { hint } from "../lib/output";

export function registerCdCommand(program: Command): void {
	program
		.command("cd [name]")
		.description("cd into a workspace (shell function)")
		.action(() => {
			hint("The cd command requires the arb shell function.");
			hint("Add to your shell profile:  source <(arb --shell-init)");
		});
}
