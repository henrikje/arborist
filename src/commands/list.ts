import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { bold, green, red, yellow } from "../lib/output";
import { listWorkspaces, workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";

export function registerListCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("list")
		.summary("List all workspaces")
		.description(
			"List all workspaces in the arb root, showing which repos each contains. The active workspace (the one you're currently inside) is marked with *.",
		)
		.action(() => {
			const ctx = getCtx();
			const workspaces = listWorkspaces(ctx.baseDir);

			if (workspaces.length === 0) {
				process.stdout.write("No workspaces found.\n");
				return;
			}

			for (const name of workspaces) {
				const wsDir = `${ctx.baseDir}/${name}`;

				const marker = name === ctx.currentWorkspace ? `${green("*")} ` : "  ";

				const repos = workspaceRepoDirs(wsDir).map((d) => basename(d));
				const configMissing = !existsSync(`${wsDir}/.arbws/config`);
				const configTag = configMissing ? ` ${red("(config missing)")}` : "";

				if (repos.length > 0) {
					const joined = repos.join(", ");
					process.stdout.write(`${marker}${bold(name.padEnd(20))} ${joined}${configTag}\n`);
				} else {
					process.stdout.write(`${marker}${bold(name.padEnd(20))} ${yellow("(empty)")}${configTag}\n`);
				}
			}
		});
}
