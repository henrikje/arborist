import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import {
	branchExistsLocally,
	git,
	hasRemote,
	isRepoDirty,
	remoteBranchExists,
	validateWorkspaceName,
} from "../lib/git";
import { error, green, inlineResult, inlineStart, red, success, warn, yellow } from "../lib/output";
import { resolveRemotes } from "../lib/remotes";
import { listWorkspaces, selectInteractive, workspaceRepoDirs } from "../lib/repos";
import { type RepoStatus, gatherRepoStatus, isDirty, isUnpushed } from "../lib/status";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";

async function removeWorkspace(
	name: string,
	ctx: ArbContext,
	options: { force?: boolean; deleteRemote?: boolean },
): Promise<void> {
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

	// Read branch and base from config
	let branch: string;
	const wb = await workspaceBranch(wsDir);
	if (wb) {
		branch = wb.branch;
	} else {
		branch = name.toLowerCase();
		warn(`Could not determine branch for ${name}, assuming '${branch}'`);
	}
	const configBase = configGet(`${wsDir}/.arbws/config`, "base");

	// Discover repos
	const repoPaths = workspaceRepoDirs(wsDir);
	const repos = repoPaths.map((d) => basename(d));

	if (repos.length === 0) {
		warn(`No worktrees found in ${wsDir} — cleaning up directory`);
		rmSync(wsDir, { recursive: true, force: true });
		return;
	}

	// Per-repo status gathering using shared logic
	const repoStatuses: RepoStatus[] = [];
	for (const repo of repos) {
		const wtPath = `${wsDir}/${repo}`;
		repoStatuses.push(await gatherRepoStatus(wtPath, ctx.reposDir, branch, configBase));
	}

	// Check canonical repos for dirt
	const canonicalDirtyMap = new Map<string, boolean>();
	for (const repo of repos) {
		const repoPath = `${ctx.reposDir}/${repo}`;
		canonicalDirtyMap.set(repo, await isRepoDirty(repoPath));
	}

	// Determine at-risk repos and collect remote repos
	let hasAtRisk = false;
	let atRiskCount = 0;
	const remoteRepos: string[] = [];
	let deleteRemote = options.deleteRemote ?? false;

	for (const status of repoStatuses) {
		const repoPath = `${ctx.reposDir}/${status.name}`;
		if (await hasRemote(repoPath)) {
			if (status.remote.pushed) {
				remoteRepos.push(status.name);
			}
		}

		const repoIsDirty = isDirty(status);
		const repoIsUnpushed = !status.remote.local && isUnpushed(status);
		const canonicalDirty = canonicalDirtyMap.get(status.name) ?? false;

		// Check if branch has unique commits but was never pushed
		let notPushedWithCommits = false;
		if (!status.remote.local && !status.remote.pushed && status.base && status.base.ahead > 0) {
			notPushedWithCommits = true;
		}

		const atRisk = repoIsDirty || repoIsUnpushed || notPushedWithCommits || canonicalDirty;
		if (atRisk) {
			hasAtRisk = true;
			atRiskCount++;
		}
	}

	// Display status table
	const maxRepoLen = Math.max(...repos.map((r) => r.length));
	process.stderr.write("\n");
	for (const status of repoStatuses) {
		const canonicalDirty = canonicalDirtyMap.get(status.name) ?? false;
		const notPushedWithCommits = !status.remote.local && !status.remote.pushed && status.base && status.base.ahead > 0;

		const parts = [
			status.local.staged > 0 && green(`${status.local.staged} staged`),
			status.local.modified > 0 && yellow(`${status.local.modified} modified`),
			status.local.untracked > 0 && yellow(`${status.local.untracked} untracked`),
			canonicalDirty && yellow("canonical repo dirty"),
			notPushedWithCommits
				? red("not pushed at all")
				: status.remote.pushed && status.remote.ahead > 0
					? yellow(`${status.remote.ahead} commits not pushed`)
					: !status.remote.local && !status.remote.pushed && false,
		]
			.filter(Boolean)
			.join(", ");

		const display = parts || green("\u2714 clean, pushed");
		process.stderr.write(`  ${status.name.padEnd(maxRepoLen)} ${display}\n`);
	}
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

		const shouldRemove = await confirm({ message: `Remove workspace ${name}?`, default: false });
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
		inlineStart(repo, "removing");

		await git(`${ctx.reposDir}/${repo}`, "worktree", "remove", "--force", `${wsDir}/${repo}`);

		if (await branchExistsLocally(`${ctx.reposDir}/${repo}`, branch)) {
			await git(`${ctx.reposDir}/${repo}`, "branch", "-D", branch);
		}

		if (deleteRemote && (await hasRemote(`${ctx.reposDir}/${repo}`))) {
			let publishRemote = "origin";
			try {
				const remotes = await resolveRemotes(`${ctx.reposDir}/${repo}`);
				publishRemote = remotes.publish;
			} catch {
				// Fall back to origin
			}
			if (await remoteBranchExists(`${ctx.reposDir}/${repo}`, branch, publishRemote)) {
				const pushResult = await git(`${ctx.reposDir}/${repo}`, "push", publishRemote, "--delete", branch);
				if (pushResult.exitCode !== 0) {
					inlineResult(repo, "removed (failed to delete remote)");
					continue;
				}
			}
		}

		inlineResult(repo, "removed");
	}

	// Clean up workspace directory
	rmSync(wsDir, { recursive: true, force: true });

	// Prune worktree metadata
	for (const repo of repos) {
		await git(`${ctx.reposDir}/${repo}`, "worktree", "prune");
	}

	process.stderr.write("\n");
	success(`Removed workspace ${name}`);
}

export function registerRemoveCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("remove [names...]")
		.option("-f, --force", "Force removal without prompts")
		.option("-d, --delete-remote", "Delete remote branches")
		.summary("Remove one or more workspaces")
		.description(
			"Remove one or more workspaces and their worktrees. Shows the status of each worktree (uncommitted changes, unpushed commits) before proceeding. Prompts with a workspace picker when run without arguments. Use --force to skip prompts, and --delete-remote to also delete the remote branches.",
		)
		.action(async (nameArgs: string[], options: { force?: boolean; deleteRemote?: boolean }) => {
			const ctx = getCtx();

			let names = nameArgs;
			if (names.length === 0) {
				if (!process.stdin.isTTY) {
					error("No workspace specified.");
					process.exit(1);
				}
				const workspaces = listWorkspaces(ctx.baseDir);
				if (workspaces.length === 0) {
					error("No workspaces found.");
					process.exit(1);
				}
				names = await selectInteractive(workspaces, "Select workspaces to remove");
				if (names.length === 0) {
					error("No workspaces selected.");
					process.exit(1);
				}
			}

			for (const name of names) {
				await removeWorkspace(name, ctx, options);
			}
		});
}
