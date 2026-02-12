import { basename } from "node:path";
import checkbox from "@inquirer/checkbox";
import type { Command } from "commander";
import { error, info, warn } from "../lib/output";
import { listRepos, workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";
import { addWorktrees } from "../lib/worktrees";

export function registerAddCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("add [repos...]")
		.description("Add worktrees to the workspace")
		.action(async (repoArgs: string[]) => {
			const ctx = getCtx();
			const { wsDir, workspace } = requireWorkspace(ctx);

			let repos = repoArgs;
			if (repos.length === 0) {
				if (!process.stdin.isTTY) {
					error("Usage: arb add <repos...>");
					error("No repos specified. Pass repo names as arguments.");
					process.exit(1);
				}
				const allRepos = listRepos(ctx.reposDir);
				const currentRepos = new Set(workspaceRepoDirs(wsDir).map((d) => basename(d)));
				const available = allRepos.filter((r) => !currentRepos.has(r));
				if (available.length === 0) {
					error("All repos are already in this workspace.");
					process.exit(1);
				}
				repos = await checkbox({
					message: "Select repos to add",
					choices: available.map((name) => ({ name, value: name })),
				});
				if (repos.length === 0) {
					error("No repos selected.");
					process.exit(1);
				}
			}
			const branch = await requireBranch(wsDir, workspace);

			const result = await addWorktrees(workspace, branch, repos, ctx.reposDir, ctx.baseDir);

			process.stderr.write("\n");
			if (result.failed.length === 0 && result.skipped.length === 0) {
				info(`Added ${result.created.length} repo(s) to ${ctx.currentWorkspace}`);
			} else {
				if (result.created.length > 0) info(`  added:   ${result.created.join(" ")}`);
				if (result.skipped.length > 0) warn(`  skipped: ${result.skipped.join(" ")}`);
				if (result.failed.length > 0) error(`  failed:  ${result.failed.join(" ")}`);
			}
		});
}
