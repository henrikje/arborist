import { existsSync } from "node:fs";
import type { Command } from "commander";
import { bold, green, red, yellow } from "../lib/output";
import { listWorkspaces, workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";

export function registerListCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("list")
		.summary("List all workspaces")
		.description(
			"List all workspaces in the arb root. The active workspace (the one you're currently inside) is marked with *.",
		)
		.action(() => {
			const ctx = getCtx();
			const workspaces = listWorkspaces(ctx.baseDir);

			for (const name of workspaces) {
				const wsDir = `${ctx.baseDir}/${name}`;

				const marker = name === ctx.currentWorkspace ? `${green("*")} ` : "  ";

				const repos = workspaceRepoDirs(wsDir);
				const configMissing = !existsSync(`${wsDir}/.arbws/config`);
				const configTag = configMissing ? ` ${red("(config missing)")}` : "";
				const emptyTag = repos.length === 0 ? ` ${yellow("(empty)")}` : "";

				process.stdout.write(`${marker}${bold(name)}${emptyTag}${configTag}\n`);
			}
		});
}
