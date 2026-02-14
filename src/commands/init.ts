import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { detectBaseDir } from "../lib/base-dir";
import { error, success } from "../lib/output";

export function registerInitCommand(program: Command): void {
	program
		.command("init [path]")
		.summary("Initialize a new arb root")
		.description(
			"Create the .arb/ marker directory and scaffolding that arb needs. The current directory (or the given path) becomes the arb root — canonical repos go in .arb/repos/, and workspaces are created as top-level directories.",
		)
		.action((path?: string) => {
			let target = path ?? process.cwd();

			// Resolve relative paths
			if (!target.startsWith("/")) {
				target = resolve(process.cwd(), target);
			}

			if (existsSync(`${target}/.arb`)) {
				error(`Already initialized: ${target}`);
				process.exit(1);
			}

			const existingRoot = detectBaseDir(target);
			if (existingRoot) {
				error(`Cannot init inside existing arb root: ${existingRoot}`);
				process.exit(1);
			}

			mkdirSync(`${target}/.arb/repos`, { recursive: true });

			success(`Initialized arb in ${target}`);
		});
}
