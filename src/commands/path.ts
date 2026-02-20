import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { error } from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";

export function registerPathCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("path [name]")
		.summary("Print a path (arb root, workspace, or worktree)")
		.description(
			'Print the absolute path to the arb root, a workspace, or a worktree within a workspace. When run from inside a workspace, names are resolved as worktrees first (e.g. "arb path backend" prints the backend worktree path). Use "workspace/repo" to be explicit.',
		)
		.action((input?: string) => {
			const ctx = getCtx();
			if (!input) {
				process.stdout.write(`${ctx.baseDir}\n`);
				return;
			}

			// Explicit workspace/subpath syntax — always resolve from root
			const slashIdx = input.indexOf("/");
			if (slashIdx >= 0) {
				const wsName = input.slice(0, slashIdx);
				const subpath = input.slice(slashIdx + 1);

				const wsDir = `${ctx.baseDir}/${wsName}`;
				if (!existsSync(wsDir)) {
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
				return;
			}

			// No slash — scope-aware resolution
			if (ctx.currentWorkspace) {
				const wsDir = `${ctx.baseDir}/${ctx.currentWorkspace}`;
				const worktreeNames = workspaceRepoDirs(wsDir).map((d) => basename(d));

				if (worktreeNames.includes(input)) {
					process.stdout.write(`${wsDir}/${input}\n`);
					return;
				}
			}

			// Fall back to workspace resolution
			const wsDir = `${ctx.baseDir}/${input}`;
			if (!existsSync(wsDir)) {
				if (ctx.currentWorkspace) {
					error(`'${input}' is not a worktree in workspace '${ctx.currentWorkspace}' or a workspace`);
				} else {
					error(`Workspace '${input}' does not exist`);
				}
				process.exit(1);
			}

			process.stdout.write(`${wsDir}\n`);
		});
}
