import type { Command } from "commander";
import { isRepoDirty } from "../lib/git";
import { error, info } from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { requireWorkspace } from "../lib/workspace-context";

export function registerOpenCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("open <command>")
		.option("-d, --dirty", "Only open dirty worktrees")
		.summary("Open worktrees in an application")
		.description(
			'Run a command with all worktree directories as arguments, using absolute paths. Useful for opening worktrees in an editor, e.g. "arb open code". The command must exist in your PATH. Use --dirty to only include worktrees with uncommitted changes.',
		)
		.action(async (editor: string, options: { dirty?: boolean }) => {
			const ctx = getCtx();
			const { wsDir } = requireWorkspace(ctx);

			// Check if editor exists in PATH
			const which = Bun.spawnSync(["which", editor]);
			if (which.exitCode !== 0) {
				error(`'${editor}' not found in PATH`);
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

			const proc = Bun.spawn([editor, ...dirsToOpen], {
				stdout: "inherit",
				stderr: "inherit",
				stdin: "inherit",
			});
			await proc.exited;
		});
}
