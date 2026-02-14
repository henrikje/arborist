import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { error, success } from "../lib/output";
import type { ArbContext } from "../lib/types";

export function registerCloneCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("clone <url> [name]")
		.summary("Clone a repo into .arb/repos/")
		.description(
			"Clone a git repository into .arb/repos/<name> as a canonical copy. These permanent clones are never worked in directly — instead, arb creates worktrees that point back to them. The repo name is derived from the URL if not specified.",
		)
		.action(async (url: string, nameArg?: string) => {
			const ctx = getCtx();
			const repoName = nameArg || basename(url).replace(/\.git$/, "");

			if (!repoName) {
				error("Could not derive repo name from URL. Specify one: arb clone <url> <name>");
				process.exit(1);
			}

			const target = `${ctx.reposDir}/${repoName}`;
			if (existsSync(target)) {
				error(`${repoName} is already cloned`);
				process.exit(1);
			}

			const result = await Bun.$`git clone ${url} ${target}`.quiet().nothrow();
			if (result.exitCode === 0) {
				await Bun.$`git -C ${target} checkout --detach`.quiet().nothrow();
				success(`Cloned repo ${repoName}`);
			} else {
				error(`Clone failed: ${result.stderr.toString().trim()}`);
				process.exit(1);
			}
		});
}
