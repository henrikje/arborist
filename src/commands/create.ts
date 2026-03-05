import { existsSync, mkdirSync } from "node:fs";
import input from "@inquirer/input";
import select, { Separator } from "@inquirer/select";
import type { Command } from "commander";
import { ArbError, writeConfig } from "../lib/core";
import type { ArbContext } from "../lib/core";
import {
	GitCache,
	type RepoRemotes,
	assertMinimumGitVersion,
	listRemoteBranches,
	validateBranchName,
	validateWorkspaceName,
} from "../lib/git";
import { render } from "../lib/render";
import { parallelFetch, reportFetchFailures } from "../lib/sync";
import { blue, bold, dim, error, info, isTTY, plural, readNamesFromStdin, success, warn } from "../lib/terminal";
import {
	addWorktrees,
	applyRepoTemplates,
	applyWorkspaceTemplates,
	displayOverlaySummary,
	listRepos,
	selectReposInteractive,
} from "../lib/workspace";

const CREATE_DEFAULT = "\0create-default";
const CREATE_CUSTOM = "\0create-custom";

export function deriveWorkspaceNameFromBranch(branch: string): string | null {
	const tail = branch.split("/").filter(Boolean).at(-1);
	return tail ?? null;
}

export function shouldShowBranchPasteHint(
	nameArg: string | undefined,
	branchOpt: string | undefined,
	validationError: string,
): boolean {
	if (!nameArg || branchOpt) return false;
	if (!validationError.includes("must not contain '/'")) return false;
	return validateBranchName(nameArg);
}

export function registerCreateCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("create [name] [repos...]")
		.option("-b, --branch <branch>", "Branch name")
		.option("--base <branch>", "Base branch to branch from")
		.option("-a, --all-repos", "Include all repos")
		.summary("Create a new workspace")
		.description(
			"Create a workspace for a feature or issue. Creates a working copy of each selected repo on a shared feature branch, with isolated working directories. Automatically seeds files from .arb/templates/ into the new workspace. Running with no arguments opens a guided flow; providing args or flags uses sensible defaults and prompts only for missing required values.\n\nIf the branch already exists locally or on the share remote, arb checks it out instead of creating a new one. This lets you resume work on an existing feature, collaborate on a shared branch, or set up a local workspace for a branch someone else started.\n\nSee 'arb help stacked' for stacking workspaces on feature branches.",
		)
		.action(
			async (
				nameArg: string | undefined,
				repoArgs: string[],
				options: { branch?: string; base?: string; allRepos?: boolean },
			) => {
				const ctx = getCtx();
				const isInteractive = process.stdin.isTTY === true;
				const isBareGuidedCreate =
					isInteractive && !nameArg && repoArgs.length === 0 && !options.branch && !options.base && !options.allRepos;
				const allKnownRepos = listRepos(ctx.reposDir);

				if (allKnownRepos.length === 0) {
					error("No repos found. Clone a repo first: arb repo clone <url>");
					throw new ArbError("No repos found. Clone a repo first: arb repo clone <url>");
				}

				// 1. Workspace name
				const isDerivedFromBranch = !nameArg && !!options.branch;
				const derivedName = options.branch ? deriveWorkspaceNameFromBranch(options.branch) : null;
				if (isDerivedFromBranch && !derivedName) {
					const msg = `Could not derive workspace name from branch '${options.branch}'. Pass an explicit workspace name: arb create <workspace-name> --branch ${options.branch}`;
					error(msg);
					throw new ArbError(msg);
				}

				let name = nameArg ?? derivedName ?? undefined;
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
					if (shouldShowBranchPasteHint(nameArg, options.branch, validationError)) {
						error(validationError);
						process.stderr.write("\n");
						info("It looks like you may have pasted a branch name.");
						process.stderr.write("\n");
						info("Try:");
						info(`  arb create --branch ${nameArg}`);
						process.stderr.write("\n");
						info("Or set an explicit workspace name:");
						info(`  arb create <workspace-name> --branch ${nameArg}`);
						throw new ArbError(validationError);
					}
					if (isDerivedFromBranch) {
						const msg = `Derived workspace name '${name}' from branch '${options.branch}' is invalid.`;
						error(msg);
						info(`Pass an explicit workspace name: arb create <workspace-name> --branch ${options.branch}`);
						throw new ArbError(msg);
					}
					error(validationError);
					throw new ArbError(validationError);
				}

				const wsDir = `${ctx.arbRootDir}/${name}`;
				if (existsSync(wsDir)) {
					if (isDerivedFromBranch) {
						const msg = `Derived workspace name '${name}' from branch '${options.branch}' already exists.`;
						error(msg);
						info(`Pass an explicit workspace name: arb create <workspace-name> --branch ${options.branch}`);
						throw new ArbError(msg);
					}
					error(`Workspace '${name}' already exists`);
					throw new ArbError(`Workspace '${name}' already exists`);
				}
				if (isDerivedFromBranch) {
					info(`${blue("!")} ${bold("Workspace name")}: ${blue(name)} (derived from ${options.branch})`);
				}

				// 2. Repo selection (moved before branch)
				let repos = repoArgs;

				if (options.allRepos) {
					repos = allKnownRepos;
				}

				if (repos.length === 0) {
					const stdinNames = await readNamesFromStdin();
					if (stdinNames.length > 0) repos = stdinNames;
				}

				if (repos.length > 0 && !options.allRepos) {
					const unknown = repos.filter((r) => !allKnownRepos.includes(r));
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

				if (repos.length === 0) {
					error("Usage: arb create <name> [repos...]");
					throw new ArbError("Usage: arb create <name> [repos...]");
				}

				// Hoist cache + git version check (needed for branch discovery and addWorktrees)
				const cache = new GitCache();
				await assertMinimumGitVersion(cache);
				let remotesMap: Map<string, RepoRemotes> | undefined;
				let alreadyFetched = false;

				// 3. Branch selection
				const defaultBranch = name;
				let branch = options.branch;
				if (!branch) {
					if (isBareGuidedCreate) {
						// Fetch selected repos so branch list is up-to-date
						remotesMap = await cache.resolveRemotesMap(repos, ctx.reposDir);
						const fetchDirs = repos.map((r) => `${ctx.reposDir}/${r}`);
						const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
						reportFetchFailures(repos, fetchResults);
						cache.invalidateAfterFetch();
						alreadyFetched = true;

						// Discover remote branches from selected repos
						const branchSets = await Promise.all(
							repos.map(async (repo) => {
								const remotes = remotesMap?.get(repo);
								if (!remotes) return [];
								const repoDir = `${ctx.reposDir}/${repo}`;
								const branches = await listRemoteBranches(repoDir, remotes.share);
								const defaultBr = await cache.getDefaultBranch(repoDir, remotes.share);
								return branches.filter((b) => b !== defaultBr);
							}),
						);
						const allBranches = [...new Set(branchSets.flat())].sort();

						if (allBranches.length > 0) {
							const defaultIsExisting = allBranches.includes(defaultBranch);
							const defaultLabel = defaultIsExisting
								? `${defaultBranch} (existing branch)`
								: `${defaultBranch} (new branch)`;
							const remainingBranches = allBranches.filter((b) => b !== defaultBranch);

							const selected = await select(
								{
									message: "Branch:",
									choices: [
										{ name: defaultLabel, value: CREATE_DEFAULT },
										{ name: "Enter a different name...", value: CREATE_CUSTOM },
										new Separator(),
										...remainingBranches.map((b) => ({ name: b, value: b })),
									],
									pageSize: 20,
									loop: false,
								},
								{ output: process.stderr },
							);

							if (selected === CREATE_DEFAULT) {
								branch = defaultBranch;
							} else if (selected !== CREATE_CUSTOM) {
								branch = selected;
							}
							// CREATE_CUSTOM falls through to input below
						}
					}

					if (!branch) {
						if (isBareGuidedCreate) {
							branch = await input(
								{
									message: "Branch name:",
									validate: (v) => (validateBranchName(v) ? true : "Invalid branch name"),
								},
								{ output: process.stderr },
							);
						} else {
							branch = defaultBranch;
						}
					}
				}

				if (!validateBranchName(branch)) {
					error(`Invalid branch name: ${branch}`);
					throw new ArbError(`Invalid branch name: ${branch}`);
				}

				// 4. Base branch (flag-only)
				const base = options.base;
				if (base && !validateBranchName(base)) {
					error(`Invalid base branch name: ${base}`);
					throw new ArbError(`Invalid base branch name: ${base}`);
				}

				// 5. Create workspace
				mkdirSync(`${wsDir}/.arbws`, { recursive: true });
				writeConfig(`${wsDir}/.arbws/config`, branch, base);

				if (!remotesMap) {
					remotesMap = await cache.resolveRemotesMap(repos, ctx.reposDir);
				}

				// Fetch repos (skip if interactive branch selector already fetched)
				if (!alreadyFetched) {
					const fetchDirs = repos.map((r) => `${ctx.reposDir}/${r}`);
					const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
					reportFetchFailures(repos, fetchResults);
				}

				const result = await addWorktrees(name, branch, repos, ctx.reposDir, ctx.arbRootDir, base, remotesMap, cache);

				const wsTemplates = await applyWorkspaceTemplates(ctx.arbRootDir, wsDir, undefined, cache);
				const repoTemplates = await applyRepoTemplates(ctx.arbRootDir, wsDir, result.created, undefined, cache);
				displayOverlaySummary(wsTemplates, repoTemplates, (nodes) => render(nodes, { tty: isTTY() }));

				process.stderr.write("\n");
				const branchSuffix = branch === defaultBranch ? "" : ` on branch ${branch}`;
				if (result.failed.length === 0 && result.skipped.length === 0) {
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
