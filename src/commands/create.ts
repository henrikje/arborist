import { existsSync, mkdirSync } from "node:fs";
import input from "@inquirer/input";
import type { Command } from "commander";
import { writeConfig } from "../lib/config";
import { validateBranchName, validateWorkspaceName } from "../lib/git";
import { dim, error, info, plural, success, warn } from "../lib/output";
import { resolveRemotesMap } from "../lib/remotes";
import { listRepos, selectReposInteractive } from "../lib/repos";
import { applyRepoTemplates, applyWorkspaceTemplates } from "../lib/templates";
import type { ArbContext } from "../lib/types";
import { addWorktrees } from "../lib/worktrees";

export function registerCreateCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("create [name] [repos...]")
		.option("-b, --branch <branch>", "Branch name")
		.option("--base <branch>", "Base branch to branch from")
		.option("-a, --all-repos", "Include all repos")
		.summary("Create a new workspace")
		.description(
			"Create a workspace for a feature or issue. Sets up worktrees for selected repos on a shared feature branch, with isolated working directories. Automatically seeds files from .arb/templates/ into the new workspace. Prompts interactively for name, branch, and repos when run without arguments.",
		)
		.action(
			async (
				nameArg: string | undefined,
				repoArgs: string[],
				options: { branch?: string; base?: string; allRepos?: boolean },
			) => {
				const ctx = getCtx();

				if (listRepos(ctx.reposDir).length === 0) {
					error("No repos found. Clone a repo first: arb clone <url>");
					process.exit(1);
				}

				let name = nameArg;
				if (!name) {
					if (!process.stdin.isTTY) {
						error("Usage: arb create <name> [repos...]");
						process.exit(1);
					}
					name = await input(
						{
							message: "Workspace name:",
							validate: (v) => validateWorkspaceName(v) ?? true,
						},
						{ output: process.stderr },
					);
				}

				const validationError = validateWorkspaceName(name);
				if (validationError) {
					error(validationError);
					process.exit(1);
				}

				let branch = options.branch;
				if (!branch) {
					const defaultBranch = name.toLowerCase();
					if (!nameArg && process.stdin.isTTY) {
						branch = await input(
							{
								message: "Branch name:",
								default: defaultBranch,
								validate: (v) => (validateBranchName(v) ? true : "Invalid branch name"),
							},
							{ output: process.stderr },
						);
					} else {
						branch = defaultBranch;
					}
				}

				if (!validateBranchName(branch)) {
					error(`Invalid branch name: ${branch}`);
					process.exit(1);
				}

				let base = options.base;
				if (!base && !nameArg && process.stdin.isTTY) {
					const baseInput = await input(
						{
							message: "Base branch (leave blank for repo default):",
						},
						{ output: process.stderr },
					);
					if (baseInput.trim()) {
						base = baseInput.trim();
					}
				}

				if (base && !validateBranchName(base)) {
					error(`Invalid base branch name: ${base}`);
					process.exit(1);
				}

				let repos = repoArgs;

				if (options.allRepos) {
					repos = listRepos(ctx.reposDir);
				}

				if (repos.length === 0 && process.stdin.isTTY) {
					try {
						repos = await selectReposInteractive(ctx.reposDir);
					} catch (e) {
						error((e as Error).message);
						process.exit(1);
					}
				}

				const wsDir = `${ctx.baseDir}/${name}`;
				if (existsSync(wsDir)) {
					error(`Workspace '${name}' already exists`);
					process.exit(1);
				}

				mkdirSync(`${wsDir}/.arbws`, { recursive: true });
				writeConfig(`${wsDir}/.arbws/config`, branch, base);

				let result = { created: [] as string[], skipped: [] as string[], failed: [] as string[] };
				if (repos.length > 0) {
					const remotesMap = await resolveRemotesMap(repos, ctx.reposDir);
					result = await addWorktrees(name, branch, repos, ctx.reposDir, ctx.baseDir, base, remotesMap);
				}

				const wsTemplates = applyWorkspaceTemplates(ctx.baseDir, wsDir);
				const repoTemplates = applyRepoTemplates(ctx.baseDir, wsDir, result.created);
				const totalSeeded = wsTemplates.seeded.length + repoTemplates.seeded.length;
				if (totalSeeded > 0) {
					info(`Seeded ${plural(totalSeeded, "template file")}`);
				}
				for (const f of [...wsTemplates.failed, ...repoTemplates.failed]) {
					warn(`Failed to copy template ${f.path}: ${f.error}`);
				}

				process.stderr.write("\n");
				const branchSuffix = branch === name.toLowerCase() ? "" : ` on branch ${branch}`;
				if (repos.length === 0) {
					success(`Created workspace ${name}`);
					info(`  ${dim(wsDir)}`);
					warn("No repos added. Use 'arb add' to add repos to this workspace.");
				} else if (result.failed.length === 0 && result.skipped.length === 0) {
					success(`Created workspace ${name} (${plural(result.created.length, "repo")})${branchSuffix}`);
					info(`  ${dim(wsDir)}`);
				} else {
					success(`Created workspace ${name}${branchSuffix}`);
					if (result.created.length > 0) info(`  added:   ${result.created.join(" ")}`);
					if (result.skipped.length > 0) warn(`  skipped: ${result.skipped.join(" ")}`);
					if (result.failed.length > 0) error(`  failed:  ${result.failed.join(" ")}`);
					info(`  ${dim(wsDir)}`);
				}
			},
		);
}
