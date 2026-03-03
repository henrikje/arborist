import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { ArbError } from "../lib/core";
import { dim, error, info, success } from "../lib/terminal";
import { detectArbRoot } from "../lib/workspace";

export function registerInitCommand(program: Command): void {
	program
		.command("init [path]")
		.summary("Initialize a new project")
		.description(
			"Create the .arb/ marker directory and scaffolding that arb needs. The current directory (or the given path) becomes the project root — canonical repos go in .arb/repos/, and workspaces are created as top-level directories.",
		)
		.action((path?: string) => {
			let target = path ?? process.cwd();

			// Resolve relative paths
			if (!target.startsWith("/")) {
				target = resolve(process.cwd(), target);
			}

			if (existsSync(`${target}/.arb`)) {
				error(`Already initialized: ${target}`);
				throw new ArbError(`Already initialized: ${target}`);
			}

			const existingRoot = detectArbRoot(target);
			if (existingRoot) {
				error(`Cannot init inside an existing project: ${existingRoot}`);
				throw new ArbError(`Cannot init inside an existing project: ${existingRoot}`);
			}

			mkdirSync(`${target}/.arb/repos`, { recursive: true });
			writeFileSync(`${target}/.arb/.gitignore`, "repos/\n");

			success("Initialized project");
			info(`  ${dim(target)}`);
			info("");
			info("Next steps:");
			info(`  arb repo clone <url>  ${dim("Clone repos into the project")}`);
			info(`  arb create <name>     ${dim("Create a workspace")}`);
		});
}
