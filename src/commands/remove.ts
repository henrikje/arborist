import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import {
	branchExistsLocally,
	getDefaultBranch,
	git,
	hasRemote,
	isRepoDirty,
	parseGitStatus,
	remoteBranchExists,
	validateWorkspaceName,
} from "../lib/git";
import { boldLine, error, green, info, red, warn, yellow } from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";

export function registerRemoveCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("remove <name>")
		.option("-f, --force", "Force removal without prompts")
		.option("-d, --delete-remote", "Delete remote branches")
		.description("Remove a workspace")
		.action(async (name: string, options: { force?: boolean; deleteRemote?: boolean }) => {
			const ctx = getCtx();
			const validationError = validateWorkspaceName(name);
			if (validationError) {
				error(validationError);
				process.exit(1);
			}

			const wsDir = `${ctx.baseDir}/${name}`;
			if (!existsSync(wsDir)) {
				error(`No workspace found for ${name}`);
				process.exit(1);
			}

			// Read branch from config
			let branch: string;
			const wb = await workspaceBranch(wsDir);
			if (wb) {
				branch = wb.branch;
			} else {
				branch = name.toLowerCase();
				warn(`Could not determine branch for ${name}, assuming '${branch}'`);
			}

			// Discover repos
			const repoPaths = workspaceRepoDirs(wsDir);
			const repos = repoPaths.map((d) => basename(d));

			if (repos.length === 0) {
				warn(`No worktrees found in ${wsDir} — cleaning up directory`);
				rmSync(wsDir, { recursive: true, force: true });
				return;
			}

			// Per-repo status gathering
			const repoStatuses: string[] = [];
			let hasAtRisk = false;
			let atRiskCount = 0;
			const remoteRepos: string[] = [];
			let deleteRemote = options.deleteRemote ?? false;

			for (const repo of repos) {
				const wtPath = `${wsDir}/${repo}`;
				let unpushed = 0;
				let notPushedAtAll = false;
				let _hasRemoteBranch = false;

				// Parse git status
				const { staged, modified, untracked } = await parseGitStatus(wtPath);

				// Check canonical repo for uncommitted changes
				const repoPath = `${ctx.reposDir}/${repo}`;
				const canonicalDirty = await isRepoDirty(repoPath);

				// Push status
				if (await hasRemote(repoPath)) {
					if (await remoteBranchExists(repoPath, branch)) {
						_hasRemoteBranch = true;
						remoteRepos.push(repo);
						const lr = await git(wtPath, "rev-list", "--left-right", "--count", `origin/${branch}...HEAD`);
						if (lr.exitCode === 0) {
							const parts = lr.stdout.trim().split(/\s+/);
							unpushed = Number.parseInt(parts[1] ?? "0", 10);
						}
					} else {
						// Only flag as "not pushed" if the branch has unique commits
						const defaultBranch = await getDefaultBranch(repoPath);
						const ahead = await git(wtPath, "rev-list", "--count", `origin/${defaultBranch}..HEAD`);
						if (ahead.exitCode === 0 && Number.parseInt(ahead.stdout.trim(), 10) > 0) {
							notPushedAtAll = true;
						}
					}
				}

				// Determine at-risk status
				const atRisk = staged > 0 || modified > 0 || untracked > 0 || unpushed > 0 || notPushedAtAll;
				if (atRisk) {
					hasAtRisk = true;
					atRiskCount++;
				}

				// Build status description
				const parts = [
					staged > 0 && green(`${staged} staged`),
					modified > 0 && yellow(`${modified} modified`),
					untracked > 0 && yellow(`${untracked} untracked`),
					canonicalDirty && yellow("canonical repo dirty"),
					notPushedAtAll ? red("not pushed at all") : unpushed > 0 && yellow(`${unpushed} commits not pushed`),
				]
					.filter(Boolean)
					.join(", ");

				repoStatuses.push(parts || green("\u2714 clean, pushed"));
			}

			// Display status table
			process.stderr.write("\n");
			boldLine(`Workspace: ${name}`);
			process.stderr.write("\n");
			repos.forEach((repo, i) => {
				process.stderr.write(`  ${repo.padEnd(20)} ${repoStatuses[i]}\n`);
			});
			process.stderr.write("\n");

			if (hasAtRisk) {
				warn(`  \u26A0 ${atRiskCount} repo(s) have changes that will be lost.`);
				process.stderr.write("\n");
			}

			// Confirmation behavior
			if (!options.force) {
				if (!process.stdin.isTTY) {
					error("Cannot prompt for confirmation: not a terminal. Use --force to skip prompts.");
					process.exit(1);
				}

				if (hasAtRisk) {
					error(`Refusing to remove: ${atRiskCount} repo(s) have work that would be lost. Use --force to override.`);
					process.exit(1);
				}

				const shouldRemove = await confirm({ message: "Remove workspace?", default: false });
				if (!shouldRemove) {
					process.stderr.write("Aborted.\n");
					return;
				}

				if (remoteRepos.length > 0 && !deleteRemote) {
					deleteRemote = await confirm({ message: "Also delete remote branches?", default: false });
				}
			}

			// Remove worktrees and branches
			for (const repo of repos) {
				process.stderr.write(`  [${repo}] removing... `);

				await git(`${ctx.reposDir}/${repo}`, "worktree", "remove", "--force", `${wsDir}/${repo}`);

				if (await branchExistsLocally(`${ctx.reposDir}/${repo}`, branch)) {
					await git(`${ctx.reposDir}/${repo}`, "branch", "-D", branch);
				}

				if (deleteRemote && (await hasRemote(`${ctx.reposDir}/${repo}`))) {
					if (await remoteBranchExists(`${ctx.reposDir}/${repo}`, branch)) {
						const pushResult = await git(`${ctx.reposDir}/${repo}`, "push", "origin", "--delete", branch);
						if (pushResult.exitCode !== 0) {
							warn("ok (failed to delete remote)");
							continue;
						}
					}
				}

				info("ok");
			}

			// Clean up workspace directory
			rmSync(wsDir, { recursive: true, force: true });

			// Prune worktree metadata
			for (const repo of repos) {
				await git(`${ctx.reposDir}/${repo}`, "worktree", "prune");
			}

			process.stderr.write("\n");
			info(`Removed workspace ${name}`);
		});
}
