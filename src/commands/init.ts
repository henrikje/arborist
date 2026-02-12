import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { detectBaseDir } from "../lib/base-dir";
import { error, hint, info } from "../lib/output";

export function registerInitCommand(program: Command): void {
	program
		.command("init [path]")
		.description("Initialize a directory as an arb root")
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

			info(`Initialized arb in ${target}`);
			process.stderr.write("\n");
			if (path) {
				hint(`Clone a repo:  cd ${path} && arb clone <url>`);
			} else {
				hint("Clone a repo:  arb clone <url>");
			}
		});
}
