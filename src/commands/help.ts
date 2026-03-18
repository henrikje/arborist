import type { Command } from "commander";
import { ArbError } from "../lib/core";
import { findTopic } from "../lib/help";
import { error } from "../lib/terminal";

export function registerHelpCommand(program: Command): void {
  // Disable Commander's built-in help command so we can handle topics
  program.helpCommand(false);

  program
    .command("help [command-or-topic]")
    .summary("Display help for a command or topic")
    .description(
      "Examples:\n\n  arb help status                          Show help for a command\n  arb help where                           Show filter syntax reference\n\nDisplay help for a command or topic.",
    )
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
      throw new ArbError(`Unknown command or topic: '${arg}'.`);
    });
}
