import { existsSync } from "node:fs";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { bold, dim, green, red, yellow } from "../lib/output";
import { listWorkspaces, workspaceRepoDirs } from "../lib/repos";
import { gatherWorkspaceSummary } from "../lib/status";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";

interface ListRow {
	name: string;
	marker: boolean;
	branch: string;
	base: string;
	repos: string;
	status: string;
	statusColored: string;
	special: "config-missing" | "empty" | null;
}

export function registerListCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("list")
		.summary("List all workspaces")
		.description(
			"List all workspaces in the arb root with aggregate status. Shows branch, base, repo count, and status for each workspace. The active workspace (the one you're currently inside) is marked with *.",
		)
		.action(async () => {
			const ctx = getCtx();
			const workspaces = listWorkspaces(ctx.baseDir);

			// Pass 1: gather data
			const rows: ListRow[] = [];
			let maxName = 0;
			let maxBranch = 0;
			let maxBase = 0;
			let maxRepos = 0;
			let hasAnyBase = false;

			for (const name of workspaces) {
				const wsDir = `${ctx.baseDir}/${name}`;
				const marker = name === ctx.currentWorkspace;
				if (name.length > maxName) maxName = name.length;

				const configMissing = !existsSync(`${wsDir}/.arbws/config`);

				if (configMissing) {
					rows.push({
						name,
						marker,
						branch: "",
						base: "",
						repos: "",
						status: "(config missing)",
						statusColored: red("(config missing)"),
						special: "config-missing",
					});
					continue;
				}

				const repoDirs = workspaceRepoDirs(wsDir);
				const wb = await workspaceBranch(wsDir);
				const branch = wb?.branch ?? name.toLowerCase();
				const configBase = configGet(`${wsDir}/.arbws/config`, "base");
				const base = configBase ?? "";

				if (branch.length > maxBranch) maxBranch = branch.length;
				if (base.length > maxBase) maxBase = base.length;
				if (base) hasAnyBase = true;

				if (repoDirs.length === 0) {
					const reposText = "0";
					if (reposText.length > maxRepos) maxRepos = reposText.length;
					rows.push({
						name,
						marker,
						branch,
						base,
						repos: reposText,
						status: "(empty)",
						statusColored: yellow("(empty)"),
						special: "empty",
					});
					continue;
				}

				const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir);

				const reposText = `${summary.total}`;
				if (reposText.length > maxRepos) maxRepos = reposText.length;

				// Compute deduplicated counts
				const dirtyCount = summary.dirty;
				const unpushedCount = summary.repos.filter(
					(r) => !r.origin.local && (!r.origin.pushed || r.origin.ahead > 0),
				).length;
				const behindCount = summary.repos.filter((r) => (r.base && r.base.behind > 0) || r.origin.behind > 0).length;
				const driftedCount = summary.drifted;

				// Build status parts
				const statusParts: string[] = [];
				const statusColoredParts: string[] = [];

				if (dirtyCount > 0) {
					const text = `${dirtyCount} dirty`;
					statusParts.push(text);
					statusColoredParts.push(yellow(text));
				}
				if (unpushedCount > 0) {
					const text = `${unpushedCount} unpushed`;
					statusParts.push(text);
					statusColoredParts.push(yellow(text));
				}
				if (behindCount > 0) {
					const text = `${behindCount} behind`;
					statusParts.push(text);
					statusColoredParts.push(text);
				}
				if (driftedCount > 0) {
					const text = `${driftedCount} drifted`;
					statusParts.push(text);
					statusColoredParts.push(yellow(text));
				}

				let status: string;
				let statusColored: string;
				if (statusParts.length === 0) {
					status = "ok";
					statusColored = "ok";
				} else {
					status = statusParts.join(", ");
					statusColored = statusColoredParts.join(", ");
				}

				rows.push({
					name,
					marker,
					branch,
					base,
					repos: reposText,
					status,
					statusColored,
					special: null,
				});
			}

			if (rows.length === 0) return;

			// Ensure minimum widths for header labels
			if (maxName < 9) maxName = 9; // "WORKSPACE"
			if (maxBranch < 6) maxBranch = 6; // "BRANCH"
			if (hasAnyBase && maxBase < 4) maxBase = 4; // "BASE"
			if (maxRepos < 5) maxRepos = 5; // "REPOS"

			// Header line
			let header = `  ${dim("WORKSPACE")}${" ".repeat(maxName - 9)}`;
			header += `    ${dim("BRANCH")}${" ".repeat(maxBranch - 6)}`;
			if (hasAnyBase) {
				header += `    ${dim("BASE")}${" ".repeat(maxBase - 4)}`;
			}
			header += `    ${dim("REPOS")}${" ".repeat(maxRepos - 5)}`;
			header += `    ${dim("STATUS")}`;
			process.stdout.write(`${header}\n`);

			// Pass 2: render with padding
			for (const row of rows) {
				const prefix = row.marker ? `${green("*")} ` : "  ";
				const paddedName = bold(row.name.padEnd(maxName));

				if (row.special === "config-missing") {
					let line = `${prefix}${paddedName}`;
					// Skip branch column, base column, repos column — jump to status area
					line += `    ${" ".repeat(maxBranch)}`;
					if (hasAnyBase) line += `    ${" ".repeat(maxBase)}`;
					line += `    ${" ".repeat(maxRepos)}`;
					line += `    ${row.statusColored}`;
					process.stdout.write(`${line}\n`);
					continue;
				}

				let line = `${prefix}${paddedName}`;
				line += `    ${row.branch.padEnd(maxBranch)}`;
				if (hasAnyBase) {
					line += `    ${row.base.padEnd(maxBase)}`;
				}
				line += `    ${row.repos.padEnd(maxRepos)}`;
				line += `    ${row.statusColored}`;
				process.stdout.write(`${line}\n`);
			}
		});
}
