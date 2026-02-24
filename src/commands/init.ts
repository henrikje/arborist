import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { detectArbRoot } from "../lib/arb-root";
import { dim, error, info, success } from "../lib/output";

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

			const existingRoot = detectArbRoot(target);
			if (existingRoot) {
				error(`Cannot init inside existing arb root: ${existingRoot}`);
				process.exit(1);
			}

			mkdirSync(`${target}/.arb/repos`, { recursive: true });
			writeFileSync(`${target}/.arb/.gitignore`, "repos/\n");

			success("Initialized arb root");
			info(`  ${dim(target)}`);
			info("");
			info("Next steps:");
			info(`  arb repo clone <url>  ${dim("Clone repos into the project")}`);
			info(`  arb create <name>     ${dim("Create a workspace")}`);
		});
}
