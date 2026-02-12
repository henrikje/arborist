import { existsSync } from "node:fs";
import type { Command } from "commander";
import { error } from "../lib/output";
import type { ArbContext } from "../lib/types";

export function registerPathCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("path [name]")
		.description("Print the path to the arb root or a workspace")
		.action((input?: string) => {
			const ctx = getCtx();
			if (!input) {
				process.stdout.write(`${ctx.baseDir}\n`);
				return;
			}

			const slashIdx = input.indexOf("/");
			const wsName = slashIdx >= 0 ? input.slice(0, slashIdx) : input;
			const subpath = slashIdx >= 0 ? input.slice(slashIdx + 1) : "";

			const wsDir = `${ctx.baseDir}/${wsName}`;
			if (!existsSync(wsDir)) {
				error(`Workspace '${wsName}' does not exist`);
				process.exit(1);
			}

			if (subpath) {
				const fullPath = `${wsDir}/${subpath}`;
				if (!existsSync(fullPath)) {
					error(`'${subpath}' not found in workspace '${wsName}'`);
					process.exit(1);
				}
				process.stdout.write(`${fullPath}\n`);
			} else {
				process.stdout.write(`${wsDir}\n`);
			}
		});
}
