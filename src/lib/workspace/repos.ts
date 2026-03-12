import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import checkbox from "@inquirer/checkbox";
import confirm from "@inquirer/confirm";
import { readProjectConfig } from "../core/config";
import { ArbError } from "../core/errors";
import { error } from "../terminal/output";
import { readNamesFromStdin } from "../terminal/stdin";

export function listWorkspaces(arbRootDir: string): string[] {
  return readdirSync(arbRootDir)
    .filter((entry) => !entry.startsWith("."))
    .filter((entry) => statSync(join(arbRootDir, entry)).isDirectory())
    .filter((entry) => existsSync(join(arbRootDir, entry, ".arbws")))
    .sort();
}

export function listRepos(reposDir: string): string[] {
  if (!existsSync(reposDir)) return [];
  return readdirSync(reposDir)
    .filter((entry) => statSync(join(reposDir, entry)).isDirectory())
    .filter((entry) => existsSync(join(reposDir, entry, ".git")))
    .sort();
}

export function listDefaultRepos(arbRootDir: string): Set<string> {
  const configFile = join(arbRootDir, ".arb", "config.json");
  return new Set(readProjectConfig(configFile)?.defaults ?? []);
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

export async function selectInteractive(items: string[], message: string, defaults?: Set<string>): Promise<string[]> {
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
      choices: items.map((name) => ({ name, value: name, checked: defaults?.has(name) ?? false })),
      pageSize: 20,
      loop: false,
    },
    { output: process.stderr },
  );
}

export async function selectReposInteractive(reposDir: string, defaults?: Set<string>): Promise<string[]> {
  const repos = listRepos(reposDir);
  if (repos.length === 0) {
    throw new Error("No repos found. Clone a repo first: arb repo clone <url>");
  }
  return checkbox(
    {
      message: "Repos:",
      choices: repos.map((name) => ({ name, value: name, checked: defaults?.has(name) ?? false })),
      validate: (selected) => (selected.length > 0 ? true : "At least one repo must be selected."),
      pageSize: 20,
      loop: false,
    },
    { output: process.stderr },
  );
}

export function collectRepo(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

export function validateRepoNames(wsDir: string, repoNames: string[]): void {
  const allRepoNames = workspaceRepoDirs(wsDir).map((d) => basename(d));
  for (const repo of repoNames) {
    if (!allRepoNames.includes(repo)) {
      error(`Repo '${repo}' is not in this workspace.`);
      throw new ArbError(`Repo '${repo}' is not in this workspace.`);
    }
  }
}

export function resolveRepoSelection(wsDir: string, repoArgs: string[]): string[] {
  const allRepoNames = workspaceRepoDirs(wsDir).map((d) => basename(d));

  if (allRepoNames.length === 0) {
    error("No repos in this workspace.");
    throw new ArbError("No repos in this workspace.");
  }

  if (repoArgs.length > 0) {
    for (const repo of repoArgs) {
      if (!allRepoNames.includes(repo)) {
        error(`Repo '${repo}' is not in this workspace.`);
        throw new ArbError(`Repo '${repo}' is not in this workspace.`);
      }
    }
    return repoArgs;
  }

  return allRepoNames;
}

/** Read repo names from args, falling back to stdin, then resolve against the workspace. */
export async function resolveReposFromArgsOrStdin(wsDir: string, repoArgs: string[]): Promise<string[]> {
  let repoNames = repoArgs;
  if (repoNames.length === 0) {
    const stdinNames = await readNamesFromStdin();
    if (stdinNames.length > 0) repoNames = stdinNames;
  }
  return resolveRepoSelection(wsDir, repoNames);
}

export function findRepoUsage(arbRootDir: string, repoName: string): string[] {
  const workspaces = listWorkspaces(arbRootDir);
  const using: string[] = [];
  for (const ws of workspaces) {
    const wsDir = join(arbRootDir, ws);
    const repos = workspaceRepoDirs(wsDir).map((d) => basename(d));
    if (repos.includes(repoName)) {
      using.push(ws);
    }
  }
  return using;
}
