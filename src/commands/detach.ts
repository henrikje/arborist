import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { branchExistsLocally, git, isRepoDirty, parseGitStatus } from "../lib/git";
import { error, inlineResult, inlineStart, plural, success, warn } from "../lib/output";
import { selectInteractive, workspaceRepoDirs } from "../lib/repos";
import { isLocalDirty } from "../lib/status";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";

export function registerDetachCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("detach [repos...]")
		.option("-f, --force", "Force detach even with uncommitted changes")
		.option("-a, --all-repos", "Detach all repos from the workspace")
		.option("--delete-branch", "Delete the local branch from the canonical repo")
		.summary("Detach repos from the workspace")
		.description(
			"Detach one or more repos from the current workspace without deleting the workspace itself. Skips repos with uncommitted changes unless --force is used. Use --all-repos to detach all repos. Use --delete-branch to also delete the local branch from the canonical repo.",
		)
		.action(async (repoArgs: string[], options: { force?: boolean; allRepos?: boolean; deleteBranch?: boolean }) => {
			const ctx = getCtx();
			const { wsDir, workspace } = requireWorkspace(ctx);

			const currentRepos = workspaceRepoDirs(wsDir).map((d) => basename(d));

			let repos = repoArgs;
			if (options.allRepos) {
				if (currentRepos.length === 0) {
					error("No repos in this workspace.");
					process.exit(1);
				}
				repos = currentRepos;
			} else if (repos.length === 0) {
				if (!process.stdin.isTTY) {
					error("No repos specified. Pass repo names or use --all-repos.");
					process.exit(1);
				}
				if (currentRepos.length === 0) {
					error("No repos in this workspace.");
					process.exit(1);
				}
				repos = await selectInteractive(currentRepos, "Select repos to detach");
				if (repos.length === 0) {
					error("No repos selected.");
					process.exit(1);
				}
			}
			const branch = await requireBranch(wsDir, workspace);

			const detached: string[] = [];
			const skipped: string[] = [];

			for (const repo of repos) {
				const wtPath = `${wsDir}/${repo}`;

				if (!existsSync(wtPath) || !existsSync(`${wtPath}/.git`)) {
					warn(`  [${repo}] not in this workspace — skipping`);
					skipped.push(repo);
					continue;
				}

				// Check for uncommitted changes
				if (!options.force) {
					if (isLocalDirty(await parseGitStatus(wtPath))) {
						warn(`  [${repo}] has uncommitted changes — skipping (use --force to override)`);
						skipped.push(repo);
						continue;
					}
				}

				inlineStart(repo, "detaching worktree");
				const removeArgs = ["worktree", "remove"];
				if (options.force) removeArgs.push("--force");
				removeArgs.push(wtPath);
				const removeResult = await git(`${ctx.reposDir}/${repo}`, ...removeArgs);
				if (removeResult.exitCode !== 0) {
					// Fallback: rm and prune
					rmSync(wtPath, { recursive: true, force: true });
					await git(`${ctx.reposDir}/${repo}`, "worktree", "prune");
				}
				inlineResult(repo, "detached");

				if (options.deleteBranch) {
					if (await isRepoDirty(`${ctx.reposDir}/${repo}`)) {
						warn(`  [${repo}] canonical repo has uncommitted changes`);
					}
					if (await branchExistsLocally(`${ctx.reposDir}/${repo}`, branch)) {
						inlineStart(repo, `deleting branch ${branch}`);
						const delResult = await git(`${ctx.reposDir}/${repo}`, "branch", "-d", branch);
						if (delResult.exitCode === 0) {
							inlineResult(repo, "branch deleted");
						} else {
							warn(`  [${repo}] failed (branch not fully merged, use git branch -D to force)`);
						}
					}
				}

				detached.push(repo);
			}

			process.stderr.write("\n");
			if (detached.length > 0) success(`Detached ${plural(detached.length, "repo")} from ${ctx.currentWorkspace}`);
			if (skipped.length > 0) warn(`Skipped: ${skipped.join(" ")}`);
		});
}
