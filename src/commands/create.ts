import { existsSync, mkdirSync } from "node:fs";
import input from "@inquirer/input";
import type { Command } from "commander";
import { writeConfig } from "../lib/config";
import { validateBranchName, validateWorkspaceName } from "../lib/git";
import { error, hint, info, warn } from "../lib/output";
import { listRepos, selectReposInteractive } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { addWorktrees } from "../lib/worktrees";

export function registerCreateCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("create [name] [repos...]")
		.option("-b, --branch <branch>", "Branch name")
		.option("-a, --all-repos", "Include all repos")
		.description("Create a new workspace")
		.action(
			async (nameArg: string | undefined, repoArgs: string[], options: { branch?: string; allRepos?: boolean }) => {
				const ctx = getCtx();

				let name = nameArg;
				if (!name) {
					if (!process.stdin.isTTY) {
						error("Usage: arb create <name> [repos...]");
						process.exit(1);
					}
					name = await input({
						message: "Workspace name:",
						validate: (v) => validateWorkspaceName(v) ?? true,
					});
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
						branch = await input({
							message: "Branch name:",
							default: defaultBranch,
							validate: (v) => (validateBranchName(v) ? true : "Invalid branch name"),
						});
					} else {
						branch = defaultBranch;
					}
				}

				if (!validateBranchName(branch)) {
					error(`Invalid branch name: ${branch}`);
					process.exit(1);
				}

				let repos = repoArgs;

				if (options.allRepos) {
					repos = listRepos(ctx.reposDir);
				}

				if (repos.length === 0) {
					if (process.stdin.isTTY) {
						try {
							repos = await selectReposInteractive(ctx.reposDir);
						} catch (e) {
							error((e as Error).message);
							process.exit(1);
						}
					} else {
						error("No repos specified. List repos to include, or use --all-repos for all repos in this root.");
						process.exit(1);
					}
				}

				const wsDir = `${ctx.baseDir}/${name}`;
				if (existsSync(wsDir)) {
					error(`Workspace '${name}' already exists`);
					process.exit(1);
				}

				mkdirSync(`${wsDir}/.arbws`, { recursive: true });
				writeConfig(`${wsDir}/.arbws/config`, branch);

				let result = { created: [] as string[], skipped: [] as string[], failed: [] as string[] };
				if (repos.length > 0) {
					result = await addWorktrees(name, branch, repos, ctx.reposDir, ctx.baseDir);
				}

				process.stderr.write("\n");
				if (result.failed.length === 0 && result.skipped.length === 0) {
					info(`Created workspace ${name} with ${result.created.length} worktree(s) on branch ${branch}`);
				} else {
					info(`Created workspace ${name} on branch ${branch}`);
					if (result.created.length > 0) info(`  added:   ${result.created.join(" ")}`);
					if (result.skipped.length > 0) warn(`  skipped: ${result.skipped.join(" ")}`);
					if (result.failed.length > 0) error(`  failed:  ${result.failed.join(" ")}`);
				}
				hint(`Enter the workspace:  arb cd ${name}`);
			},
		);
}
