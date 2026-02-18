import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { error, info, success } from "../lib/output";
import type { ArbContext } from "../lib/types";

export function registerCloneCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("clone <url> [name]")
		.option("--upstream <url>", "Add an upstream remote (for fork workflows)")
		.summary("Clone a repo into .arb/repos/")
		.description(
			"Clone a git repository into .arb/repos/<name> as a canonical copy. These permanent clones are never worked in directly — instead, arb creates worktrees that point back to them. The repo name is derived from the URL if not specified.\n\nFor fork workflows, use --upstream to add the canonical repo as an upstream remote. This sets remote.pushDefault so arb knows to push to origin (your fork) and rebase from upstream.",
		)
		.action(async (url: string, nameArg: string | undefined, options: { upstream?: string }) => {
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

			const result = await Bun.$`git clone ${url} ${target}`.cwd(ctx.reposDir).quiet().nothrow();
			if (result.exitCode !== 0) {
				error(`Clone failed: ${result.stderr.toString().trim()}`);
				process.exit(1);
			}

			await Bun.$`git -C ${target} checkout --detach`.cwd(target).quiet().nothrow();

			if (options.upstream) {
				// Add upstream remote
				const addResult = await Bun.$`git -C ${target} remote add upstream ${options.upstream}`
					.cwd(target)
					.quiet()
					.nothrow();
				if (addResult.exitCode !== 0) {
					error(`Failed to add upstream remote: ${addResult.stderr.toString().trim()}`);
					process.exit(1);
				}

				// Set remote.pushDefault so resolveRemotes() detects the fork layout
				await Bun.$`git -C ${target} config remote.pushDefault origin`.cwd(target).quiet().nothrow();

				// Fetch upstream and auto-detect HEAD
				const fetchResult = await Bun.$`git -C ${target} fetch upstream`.cwd(target).quiet().nothrow();
				if (fetchResult.exitCode !== 0) {
					error(`Failed to fetch upstream: ${fetchResult.stderr.toString().trim()}`);
					process.exit(1);
				}
				await Bun.$`git -C ${target} remote set-head upstream --auto`.cwd(target).quiet().nothrow();

				info(`  share:    origin (${url})`);
				info(`  upstream: upstream (${options.upstream})`);
				success(`Cloned repo ${repoName}`);
			} else {
				success(`Cloned repo ${repoName}`);
			}
		});
}
