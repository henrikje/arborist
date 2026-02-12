import { basename } from "node:path";
import type { Command } from "commander";
import { isRepoDirty } from "../lib/git";
import { boldLine, error, info } from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { requireWorkspace } from "../lib/workspace-context";

export function registerExecCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("exec")
		.argument("<command...>", "Command to run in each worktree")
		.option("-d, --dirty", "Only run in dirty repos")
		.allowUnknownOption(true)
		.summary("Run a command in each worktree")
		.description(
			"Run the given command sequentially in each worktree and report which succeeded or failed. Use --dirty to only run in worktrees with uncommitted changes.",
		)
		.action(async (args: string[], options: { dirty?: boolean }) => {
			const ctx = getCtx();
			const { wsDir } = requireWorkspace(ctx);
			const execOk: string[] = [];
			const execFailed: string[] = [];

			for (const repoDir of workspaceRepoDirs(wsDir)) {
				const repo = basename(repoDir);

				if (options.dirty) {
					if (!(await isRepoDirty(repoDir))) {
						continue;
					}
				}

				boldLine(`  [${repo}]`);
				const proc = Bun.spawn(args, {
					cwd: repoDir,
					stdout: "inherit",
					stderr: "inherit",
					stdin: "inherit",
				});
				const exitCode = await proc.exited;
				if (exitCode === 0) {
					execOk.push(repo);
				} else {
					execFailed.push(repo);
				}
				process.stderr.write("\n");
			}

			if (execOk.length > 0) info(`Ran in ${execOk.length} repo(s)`);
			if (execFailed.length > 0) error(`Failed: ${execFailed.join(" ")}`);

			if (execFailed.length > 0) process.exit(1);
		});
}
