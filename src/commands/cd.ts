import { existsSync } from "node:fs";
import { basename } from "node:path";
import select from "@inquirer/select";
import type { Command } from "commander";
import { error, info } from "../lib/output";
import { listWorkspaces, workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";

export function registerCdCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("cd [name]")
		.summary("Navigate to a workspace or worktree directory")
		.description(
			'Change into a workspace or worktree directory. When run from inside a workspace, names are resolved as worktrees first (e.g. "arb cd backend" navigates to the backend worktree). Use "workspace/repo" to be explicit. When run without arguments in a TTY, shows an interactive picker (worktrees when inside a workspace, workspaces otherwise).\n\nRequires shell integration (installed by install.sh) to change the shell\'s working directory. Without it, the resolved path is printed to stdout.',
		)
		.action(async (input?: string) => {
			const ctx = getCtx();

			if (!input) {
				if (!process.stdin.isTTY || !process.stderr.isTTY) {
					error("Usage: arb cd <workspace>");
					process.exit(1);
				}

				if (ctx.currentWorkspace) {
					const wsDir = `${ctx.baseDir}/${ctx.currentWorkspace}`;
					const worktreeNames = workspaceRepoDirs(wsDir).map((d) => basename(d));
					if (worktreeNames.length === 0) {
						error(`No worktrees in workspace '${ctx.currentWorkspace}'.`);
						process.exit(1);
					}

					const selected = await select(
						{
							message: `Select a worktree in '${ctx.currentWorkspace}'`,
							choices: worktreeNames.map((name) => ({ name, value: name })),
							pageSize: 20,
						},
						{ output: process.stderr },
					);

					process.stdout.write(`${wsDir}/${selected}\n`);
					printHintIfNeeded();
					return;
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

			// Explicit workspace/subpath syntax — always resolve from root
			const slashIdx = input.indexOf("/");
			if (slashIdx >= 0) {
				const wsName = input.slice(0, slashIdx);
				const subpath = input.slice(slashIdx + 1);

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
				return;
			}

			// No slash — scope-aware resolution
			if (ctx.currentWorkspace) {
				const wsDir = `${ctx.baseDir}/${ctx.currentWorkspace}`;
				const worktreeNames = workspaceRepoDirs(wsDir).map((d) => basename(d));

				if (worktreeNames.includes(input)) {
					process.stdout.write(`${wsDir}/${input}\n`);
					printHintIfNeeded();
					return;
				}
			}

			// Fall back to workspace resolution
			const wsDir = `${ctx.baseDir}/${input}`;
			if (!existsSync(`${wsDir}/.arbws`)) {
				if (ctx.currentWorkspace) {
					error(`'${input}' is not a worktree in workspace '${ctx.currentWorkspace}' or a workspace`);
				} else {
					error(`Workspace '${input}' does not exist`);
				}
				process.exit(1);
			}

			process.stdout.write(`${wsDir}\n`);
			printHintIfNeeded();
		});
}

function printHintIfNeeded(): void {
	if (process.stdout.isTTY && process.stderr.isTTY) {
		info("Hint: install shell integration to cd directly. See 'arb cd --help'.");
	}
}
