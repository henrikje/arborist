import { existsSync } from "node:fs";
import select from "@inquirer/select";
import type { Command } from "commander";
import { error, info } from "../lib/output";
import { listWorkspaces } from "../lib/repos";
import type { ArbContext } from "../lib/types";

export function registerCdCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("cd [name]")
		.summary("Navigate to a workspace directory")
		.description(
			'Change into a workspace or worktree directory. Supports workspace/repo paths (e.g. "fix-login/frontend"). When run without arguments in a TTY, shows an interactive workspace picker.\n\nRequires shell integration (installed by install.sh) to change the shell\'s working directory. Without it, the resolved path is printed to stdout.',
		)
		.action(async (input?: string) => {
			const ctx = getCtx();

			if (!input) {
				if (!process.stdin.isTTY || !process.stderr.isTTY) {
					error("Usage: arb cd <workspace>");
					process.exit(1);
				}

				const workspaces = listWorkspaces(ctx.baseDir);
				if (workspaces.length === 0) {
					error("No workspaces found.");
					process.exit(1);
				}

				const selected = await select(
					{
						message: "Select a workspace",
						choices: workspaces.map((name) => ({ name, value: name })),
						pageSize: 20,
					},
					{ output: process.stderr },
				);

				process.stdout.write(`${ctx.baseDir}/${selected}\n`);
				printHintIfNeeded();
				return;
			}

			const slashIdx = input.indexOf("/");
			const wsName = slashIdx >= 0 ? input.slice(0, slashIdx) : input;
			const subpath = slashIdx >= 0 ? input.slice(slashIdx + 1) : "";

			const wsDir = `${ctx.baseDir}/${wsName}`;
			if (!existsSync(`${wsDir}/.arbws`)) {
				error(`Workspace '${wsName}' does not exist`);
				process.exit(1);
			}

			if (subpath) {
				const fullPath = `${wsDir}/${subpath}`;
				if (!existsSync(fullPath)) {
					error(`'${subpath}' not found in workspace '${wsName}'`);
					process.exit(1);
				}
				process.stdout.write(`${fullPath}\n`);
			} else {
				process.stdout.write(`${wsDir}\n`);
			}

			printHintIfNeeded();
		});
}

function printHintIfNeeded(): void {
	if (process.stdout.isTTY && process.stderr.isTTY) {
		info("Hint: install shell integration to cd directly. See 'arb cd --help'.");
	}
}
