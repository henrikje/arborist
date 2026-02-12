import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import checkbox from "@inquirer/checkbox";
import confirm from "@inquirer/confirm";
import { hasRemote } from "./git";

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

export async function selectReposInteractive(reposDir: string): Promise<string[]> {
	const repos = listRepos(reposDir);
	if (repos.length === 0) {
		throw new Error("No repos found under repos/. Clone a repo first: arb clone <url>");
	}

	if (repos.length === 1) {
		const yes = await confirm({
			message: `Only repo available: ${repos[0]}. Include it?`,
			default: true,
		});
		if (!yes) {
			throw new Error("Aborted");
		}
		return repos;
	}

	const selected = await checkbox({
		message: "Select repos to include",
		choices: repos.map((name) => ({ name, value: name })),
		pageSize: 20,
	});

	if (selected.length === 0) {
		throw new Error("No repos selected");
	}
	return selected;
}

export async function classifyRepos(
	wsDir: string,
	reposDir: string,
): Promise<{ repos: string[]; fetchDirs: string[]; localRepos: string[] }> {
	const repos: string[] = [];
	const fetchDirs: string[] = [];
	const localRepos: string[] = [];
	for (const repoDir of workspaceRepoDirs(wsDir)) {
		const repo = basename(repoDir);
		repos.push(repo);
		if (!(await hasRemote(`${reposDir}/${repo}`))) {
			localRepos.push(repo);
		} else {
			fetchDirs.push(repoDir);
		}
	}
	return { repos, fetchDirs, localRepos };
}
