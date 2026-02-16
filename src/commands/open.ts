import type { Command } from "commander";
import { isRepoDirty } from "../lib/git";
import { error, info } from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { requireWorkspace } from "../lib/workspace-context";

export function registerOpenCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("open")
		.argument("<command...>", "Command to open worktrees with")
		.option("-d, --dirty", "Only open dirty worktrees")
		.passThroughOptions()
		.summary("Open worktrees in an application")
		.description(
			'Run a command with all worktree directories as arguments, using absolute paths. Useful for opening worktrees in an editor, e.g. "arb open code". The command must exist in your PATH.\n\nArb flags (--dirty) must come before the command. Everything after the command name is passed through verbatim:\n\n  arb open --dirty code -n --add    # --dirty → arb, -n --add → code',
		)
		.action(async (args: string[], options: { dirty?: boolean }) => {
			const [command = "", ...extraFlags] = args;
			const ctx = getCtx();
			const { wsDir } = requireWorkspace(ctx);

			// Check if command exists in PATH
			const which = Bun.spawnSync(["which", command], { cwd: wsDir });
			if (which.exitCode !== 0) {
				error(`'${command}' not found in PATH`);
				process.exit(1);
			}

			const dirsToOpen: string[] = [];

			for (const repoDir of workspaceRepoDirs(wsDir)) {
				if (options.dirty) {
					if (!(await isRepoDirty(repoDir))) {
						continue;
					}
				}
				dirsToOpen.push(repoDir);
			}

			if (dirsToOpen.length === 0) {
				if (options.dirty) {
					info("All worktrees are clean — nothing to open");
				} else {
					info("No worktrees in workspace");
				}
				return;
			}

			const proc = Bun.spawn([command, ...extraFlags, ...dirsToOpen], {
				cwd: wsDir,
				stdout: "inherit",
				stderr: "inherit",
				stdin: "inherit",
			});
			await proc.exited;
		});
}
