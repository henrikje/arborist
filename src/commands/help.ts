import type { Command } from "commander";
import { findTopic } from "../lib/help-topics";
import { error } from "../lib/output";

export function registerHelpCommand(program: Command): void {
	// Disable Commander's built-in help command so we can handle topics
	program.helpCommand(false);

	program
		.command("help [command-or-topic]")
		.description("Display help for a command or topic")
		.helpOption(false)
		.action((arg?: string) => {
			if (!arg) {
				program.help();
				return;
			}

			// Check topics first
			const topic = findTopic(arg);
			if (topic) {
				topic.render();
				return;
			}

			// Fall back to command help
			const cmd = program.commands.find((c) => c.name() === arg || c.aliases().includes(arg));
			if (cmd) {
				cmd.help();
				return;
			}

			// Unknown
			error(`Unknown command or topic: '${arg}'. Run 'arb help' for available commands.`);
			process.exitCode = 1;
		});
}
