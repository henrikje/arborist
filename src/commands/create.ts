import { existsSync, mkdirSync } from "node:fs";
import input from "@inquirer/input";
import type { Command } from "commander";
import { writeConfig } from "../lib/config";
import { ArbError } from "../lib/errors";
import { validateBranchName, validateWorkspaceName } from "../lib/git";
import { dim, error, info, plural, success, warn } from "../lib/output";
import { resolveRemotesMap } from "../lib/remotes";
import { listRepos, selectReposInteractive } from "../lib/repos";
import { readNamesFromStdin } from "../lib/stdin";
import { applyRepoTemplates, applyWorkspaceTemplates, displayOverlaySummary } from "../lib/templates";
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
			"Create a workspace for a feature or issue. Creates a working copy of each selected repo on a shared feature branch, with isolated working directories. Automatically seeds files from .arb/templates/ into the new workspace. Prompts interactively for name, branch, and repos when run without arguments.",
		)
		.action(
			async (
				nameArg: string | undefined,
				repoArgs: string[],
				options: { branch?: string; base?: string; allRepos?: boolean },
			) => {
				const ctx = getCtx();

				if (listRepos(ctx.reposDir).length === 0) {
					error("No repos found. Clone a repo first: arb repo clone <url>");
					throw new ArbError("No repos found. Clone a repo first: arb repo clone <url>");
				}

				let name = nameArg;
				if (!name) {
					if (!process.stdin.isTTY) {
						error("Usage: arb create <name> [repos...]");
						throw new ArbError("Usage: arb create <name> [repos...]");
					}
					name = await input(
						{
							message: "Workspace name:",
							validate: (v) => {
								const formatError = validateWorkspaceName(v);
								if (formatError) return formatError;
								if (existsSync(`${ctx.arbRootDir}/${v}`)) return `Workspace '${v}' already exists`;
								return true;
							},
						},
						{ output: process.stderr },
					);
				}

				const validationError = validateWorkspaceName(name);
				if (validationError) {
					error(validationError);
					throw new ArbError(validationError);
				}

				const wsDir = `${ctx.arbRootDir}/${name}`;
				if (existsSync(wsDir)) {
					error(`Workspace '${name}' already exists`);
					throw new ArbError(`Workspace '${name}' already exists`);
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
					throw new ArbError(`Invalid branch name: ${branch}`);
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
					throw new ArbError(`Invalid base branch name: ${base}`);
				}

				let repos = repoArgs;

				if (options.allRepos) {
					repos = listRepos(ctx.reposDir);
				}

				if (repos.length === 0) {
					const stdinNames = await readNamesFromStdin();
					if (stdinNames.length > 0) repos = stdinNames;
				}

				if (repos.length > 0 && !options.allRepos) {
					const allRepos = listRepos(ctx.reposDir);
					const unknown = repos.filter((r) => !allRepos.includes(r));
					if (unknown.length > 0) {
						error(`Unknown repos: ${unknown.join(", ")}. Not found in .arb/repos/.`);
						throw new ArbError(`Unknown repos: ${unknown.join(", ")}. Not found in .arb/repos/.`);
					}
				}

				if (repos.length === 0 && process.stdin.isTTY) {
					try {
						repos = await selectReposInteractive(ctx.reposDir);
					} catch (e) {
						error((e as Error).message);
						throw new ArbError((e as Error).message);
					}
				}

				mkdirSync(`${wsDir}/.arbws`, { recursive: true });
				writeConfig(`${wsDir}/.arbws/config`, branch, base);

				let result = { created: [] as string[], skipped: [] as string[], failed: [] as string[] };
				if (repos.length > 0) {
					const remotesMap = await resolveRemotesMap(repos, ctx.reposDir);
					result = await addWorktrees(name, branch, repos, ctx.reposDir, ctx.arbRootDir, base, remotesMap);
				}

				const wsTemplates = await applyWorkspaceTemplates(ctx.arbRootDir, wsDir);
				const repoTemplates = await applyRepoTemplates(ctx.arbRootDir, wsDir, result.created);
				displayOverlaySummary(wsTemplates, repoTemplates);

				process.stderr.write("\n");
				const branchSuffix = branch === name.toLowerCase() ? "" : ` on branch ${branch}`;
				if (repos.length === 0) {
					success(`Created workspace ${name}`);
					info(`  ${dim(wsDir)}`);
					warn("No repos added. Use 'arb attach' to add repos to this workspace.");
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

				if (result.failed.length === 0) {
					process.stdout.write(`${wsDir}\n`);
				}
			},
		);
}
