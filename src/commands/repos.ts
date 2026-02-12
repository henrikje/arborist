import type { Command } from "commander";
import { listRepos } from "../lib/repos";
import type { ArbContext } from "../lib/types";

export function registerReposCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("repos")
		.summary("List cloned repos")
		.description("List all repositories that have been cloned into .arb/repos/.")
		.action(() => {
			const ctx = getCtx();
			for (const repo of listRepos(ctx.reposDir)) {
				process.stdout.write(`${repo}\n`);
			}
		});
}
