import { basename } from "node:path";
import type { Command } from "commander";
import { isRepoDirty } from "../lib/git";
import { boldLine, error, success } from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { requireWorkspace } from "../lib/workspace-context";

export function registerExecCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("exec")
		.argument("<command...>", "Command to run in each worktree")
		.option("-d, --dirty", "Only run in dirty repos")
		.passThroughOptions()
		.summary("Run a command in each worktree")
		.description(
			"Run the given command sequentially in each worktree and report which succeeded or failed. Each worktree is preceded by an ==> repo <== header. The command inherits your terminal, so interactive programs work.\n\nArb flags (--dirty) must come before the command. Everything after the command name is passed through verbatim:\n\n  arb exec --dirty git diff -d    # --dirty → arb, -d → git diff",
		)
		.action(async (args: string[], options: { dirty?: boolean }) => {
			const ctx = getCtx();
			const { wsDir } = requireWorkspace(ctx);
			const execOk: string[] = [];
			const execFailed: string[] = [];
			const skipped: string[] = [];

			for (const repoDir of workspaceRepoDirs(wsDir)) {
				const repo = basename(repoDir);

				if (options.dirty) {
					if (!(await isRepoDirty(repoDir))) {
						skipped.push(repo);
						continue;
					}
				}

				boldLine(`==> ${repo} <==`);
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

			const parts: string[] = [];
			if (execOk.length > 0) parts.push(`Ran in ${execOk.length} repo(s)`);
			if (skipped.length > 0) parts.push(`${skipped.length} clean`);
			if (parts.length > 0) success(parts.join(", "));
			if (execFailed.length > 0) error(`Failed: ${execFailed.join(" ")}`);

			if (execFailed.length > 0) process.exit(1);
		});
}
