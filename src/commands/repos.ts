import type { Command } from "commander";
import { dim } from "../lib/output";
import { getRemoteUrl } from "../lib/remotes";
import { listRepos } from "../lib/repos";
import type { ArbContext } from "../lib/types";

export function registerReposCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("repos")
		.summary("List cloned repos")
		.description(
			"List all repositories that have been cloned into .arb/repos/. These are the canonical clones that workspaces create worktrees from.",
		)
		.action(async () => {
			const ctx = getCtx();
			const repos = listRepos(ctx.reposDir);
			if (repos.length === 0) return;

			const entries: { name: string; url: string }[] = [];
			for (const repo of repos) {
				const repoDir = `${ctx.reposDir}/${repo}`;
				const url = await getRemoteUrl(repoDir, "origin");
				entries.push({ name: repo, url: url ?? "" });
			}

			const maxRepo = Math.max(4, ...entries.map((e) => e.name.length));

			process.stdout.write(`  ${dim("REPO")}${" ".repeat(maxRepo - 4)}    ${dim("URL")}\n`);
			for (const { name, url } of entries) {
				const urlDisplay = url || dim("(local)");
				process.stdout.write(`  ${name.padEnd(maxRepo)}    ${urlDisplay}\n`);
			}
		});
}
