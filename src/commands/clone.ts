import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { error, hint, info } from "../lib/output";
import type { ArbContext } from "../lib/types";

export function registerCloneCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("clone <url> [name]")
		.description("Clone a repo")
		.action(async (url: string, nameArg?: string) => {
			const ctx = getCtx();
			const repoName = nameArg || basename(url).replace(/\.git$/, "");

			if (!repoName) {
				error("Could not derive repo name from URL. Specify one: arb clone <url> <name>");
				process.exit(1);
			}

			const target = `${ctx.reposDir}/${repoName}`;
			if (existsSync(target)) {
				error(`repos/${repoName} already exists`);
				process.exit(1);
			}

			const result = await Bun.$`git clone ${url} ${target}`.quiet().nothrow();
			if (result.exitCode === 0) {
				info(`Cloned repo ${repoName}`);
				hint(`Create a workspace:  arb create <workspace> ${repoName}`);
				hint(`Add to a workspace:  arb add ${repoName}`);
			} else {
				error("Clone failed");
				process.exit(1);
			}
		});
}
