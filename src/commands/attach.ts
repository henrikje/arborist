import { basename } from "node:path";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { error, info, plural, success, warn } from "../lib/output";
import { resolveRemotesMap } from "../lib/remotes";
import { listRepos, selectInteractive, workspaceRepoDirs } from "../lib/repos";
import { applyRepoTemplates, applyWorkspaceTemplates } from "../lib/templates";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";
import { addWorktrees } from "../lib/worktrees";

export function registerAttachCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("attach [repos...]")
		.option("-a, --all-repos", "Attach all remaining repos")
		.summary("Attach repos to the workspace")
		.description(
			"Attach one or more repos to the current workspace on the workspace's feature branch. If the workspace has a configured base branch, new branches are created from it. Automatically seeds files from .arb/templates/repos/ into newly attached repos and regenerates templates that reference the repo list (those using {% for repo in workspace.repos %}). Prompts with a repo picker when run without arguments. Use --all-repos to attach all repos not yet in the workspace.",
		)
		.action(async (repoArgs: string[], options: { allRepos?: boolean }) => {
			const ctx = getCtx();
			const { wsDir, workspace } = requireWorkspace(ctx);
			const branch = await requireBranch(wsDir, workspace);

			const allRepos = listRepos(ctx.reposDir);
			const currentRepos = new Set(workspaceRepoDirs(wsDir).map((d) => basename(d)));
			const available = allRepos.filter((r) => !currentRepos.has(r));

			let repos = repoArgs;
			if (options.allRepos) {
				if (available.length === 0) {
					error("All repos are already in this workspace.");
					process.exit(1);
				}
				repos = available;
			} else if (repos.length > 0) {
				const unknown = repos.filter((r) => !allRepos.includes(r));
				if (unknown.length > 0) {
					error(`Unknown repos: ${unknown.join(", ")}. Not found in .arb/repos/.`);
					process.exit(1);
				}
			} else if (repos.length === 0) {
				if (!process.stdin.isTTY) {
					error("No repos specified. Pass repo names or use --all-repos.");
					process.exit(1);
				}
				if (available.length === 0) {
					error("All repos are already in this workspace.");
					process.exit(1);
				}
				repos = await selectInteractive(available, "Select repos to attach");
				if (repos.length === 0) {
					error("No repos selected.");
					process.exit(1);
				}
			}
			const base = configGet(`${wsDir}/.arbws/config`, "base") ?? undefined;

			const remotesMap = await resolveRemotesMap(repos, ctx.reposDir);
			const result = await addWorktrees(workspace, branch, repos, ctx.reposDir, ctx.arbRootDir, base, remotesMap);

			const changed = { added: result.created };
			const wsRepoNames = workspaceRepoDirs(wsDir).map((d) => basename(d));
			const repoTemplates = await applyRepoTemplates(ctx.arbRootDir, wsDir, wsRepoNames, changed);
			const wsTemplates = await applyWorkspaceTemplates(ctx.arbRootDir, wsDir, changed);
			const totalSeeded = repoTemplates.seeded.length + wsTemplates.seeded.length;
			const totalRegenerated = repoTemplates.regenerated.length + wsTemplates.regenerated.length;
			if (totalSeeded > 0) {
				info(`Seeded ${plural(totalSeeded, "template file")}`);
			}
			if (totalRegenerated > 0) {
				info(`Regenerated ${plural(totalRegenerated, "template file")}`);
			}
			for (const f of [...repoTemplates.failed, ...wsTemplates.failed]) {
				warn(`Failed to copy template ${f.path}: ${f.error}`);
			}

			process.stderr.write("\n");
			if (result.failed.length === 0 && result.skipped.length === 0) {
				success(`Attached ${plural(result.created.length, "repo")} to ${ctx.currentWorkspace}`);
			} else {
				if (result.created.length > 0) info(`  attached: ${result.created.join(" ")}`);
				if (result.skipped.length > 0) warn(`  skipped:  ${result.skipped.join(" ")}`);
				if (result.failed.length > 0) error(`  failed:   ${result.failed.join(" ")}`);
			}
		});
}
