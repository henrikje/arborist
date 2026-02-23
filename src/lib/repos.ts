import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import checkbox from "@inquirer/checkbox";
import confirm from "@inquirer/confirm";
import { error } from "./output";

export function listWorkspaces(baseDir: string): string[] {
	return readdirSync(baseDir)
		.filter((entry) => !entry.startsWith("."))
		.filter((entry) => statSync(join(baseDir, entry)).isDirectory())
		.filter((entry) => existsSync(join(baseDir, entry, ".arbws")))
		.sort();
}

export function listRepos(reposDir: string): string[] {
	if (!existsSync(reposDir)) return [];
	return readdirSync(reposDir)
		.filter((entry) => statSync(join(reposDir, entry)).isDirectory())
		.filter((entry) => existsSync(join(reposDir, entry, ".git")))
		.sort();
}

export function workspaceRepoDirs(wsDir: string): string[] {
	if (!existsSync(wsDir)) return [];
	return readdirSync(wsDir)
		.filter((entry) => entry !== ".arbws")
		.map((entry) => join(wsDir, entry))
		.filter((fullPath) => statSync(fullPath).isDirectory())
		.filter((fullPath) => existsSync(join(fullPath, ".git")))
		.sort();
}

export async function selectInteractive(items: string[], message: string): Promise<string[]> {
	if (items.length === 0) {
		throw new Error("No items to select");
	}

	if (items.length === 1) {
		const yes = await confirm(
			{
				message: `Only option: ${items[0]}. Include it?`,
				default: true,
			},
			{ output: process.stderr },
		);
		return yes ? items : [];
	}

	return checkbox(
		{
			message,
			choices: items.map((name) => ({ name, value: name })),
			pageSize: 20,
		},
		{ output: process.stderr },
	);
}

export async function selectReposInteractive(reposDir: string): Promise<string[]> {
	const repos = listRepos(reposDir);
	if (repos.length === 0) {
		throw new Error("No repos found. Clone a repo first: arb repo clone <url>");
	}
	return selectInteractive(repos, "Select repos to include");
}

export function collectRepo(value: string, previous: string[]): string[] {
	return previous.concat(value);
}

export function validateRepoNames(wsDir: string, repoNames: string[]): void {
	const allRepoNames = workspaceRepoDirs(wsDir).map((d) => basename(d));
	for (const repo of repoNames) {
		if (!allRepoNames.includes(repo)) {
			error(`Repo '${repo}' is not in this workspace.`);
			process.exit(1);
		}
	}
}

export function resolveRepoSelection(wsDir: string, repoArgs: string[]): string[] {
	const allRepoNames = workspaceRepoDirs(wsDir).map((d) => basename(d));

	if (allRepoNames.length === 0) {
		error("No repos in this workspace.");
		process.exit(1);
	}

	if (repoArgs.length > 0) {
		for (const repo of repoArgs) {
			if (!allRepoNames.includes(repo)) {
				error(`Repo '${repo}' is not in this workspace.`);
				process.exit(1);
			}
		}
		return repoArgs;
	}

	return allRepoNames;
}

export function findRepoUsage(baseDir: string, repoName: string): string[] {
	const workspaces = listWorkspaces(baseDir);
	const using: string[] = [];
	for (const ws of workspaces) {
		const wsDir = join(baseDir, ws);
		const repos = workspaceRepoDirs(wsDir).map((d) => basename(d));
		if (repos.includes(repoName)) {
			using.push(ws);
		}
	}
	return using;
}
