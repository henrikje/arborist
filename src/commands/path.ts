import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { ArbError } from "../lib/errors";
import { error } from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";

export function registerPathCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("path [name]")
		.summary("Print a path (arb root, workspace, or repo)")
		.description(
			'Print the absolute path to the arb root, a workspace, or a repo within a workspace. When run from inside a workspace, names are resolved as repos first (e.g. "arb path backend" prints the backend repo path). Use "workspace/repo" to be explicit.',
		)
		.action((input?: string) => {
			const ctx = getCtx();
			if (!input) {
				process.stdout.write(`${ctx.arbRootDir}\n`);
				return;
			}

			// Explicit workspace/subpath syntax — always resolve from root
			const slashIdx = input.indexOf("/");
			if (slashIdx >= 0) {
				const wsName = input.slice(0, slashIdx);
				const subpath = input.slice(slashIdx + 1);

				const wsDir = `${ctx.arbRootDir}/${wsName}`;
				if (!existsSync(wsDir)) {
					error(`Workspace '${wsName}' does not exist`);
					throw new ArbError(`Workspace '${wsName}' does not exist`);
				}

				if (subpath) {
					const fullPath = `${wsDir}/${subpath}`;
					if (!existsSync(fullPath)) {
						error(`'${subpath}' not found in workspace '${wsName}'`);
						throw new ArbError(`'${subpath}' not found in workspace '${wsName}'`);
					}
					process.stdout.write(`${fullPath}\n`);
				} else {
					process.stdout.write(`${wsDir}\n`);
				}
				return;
			}

			// No slash — scope-aware resolution
			if (ctx.currentWorkspace) {
				const wsDir = `${ctx.arbRootDir}/${ctx.currentWorkspace}`;
				const worktreeNames = workspaceRepoDirs(wsDir).map((d) => basename(d));

				if (worktreeNames.includes(input)) {
					process.stdout.write(`${wsDir}/${input}\n`);
					return;
				}
			}

			// Fall back to workspace resolution
			const wsDir = `${ctx.arbRootDir}/${input}`;
			if (!existsSync(wsDir)) {
				const msg = ctx.currentWorkspace
					? `'${input}' is not a repo in workspace '${ctx.currentWorkspace}' or a workspace`
					: `Workspace '${input}' does not exist`;
				error(msg);
				throw new ArbError(msg);
			}

			process.stdout.write(`${wsDir}\n`);
		});
}
