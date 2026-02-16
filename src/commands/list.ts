import { existsSync } from "node:fs";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { hasRemote } from "../lib/git";
import { bold, dim, green, info, plural, red, yellow } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { resolveRemotesMap } from "../lib/remotes";
import { listRepos, listWorkspaces, workspaceRepoDirs } from "../lib/repos";
import { type WorkspaceSummary, gatherWorkspaceSummary, isUnpushed } from "../lib/status";
import { isTTY } from "../lib/tty";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";

interface ListRow {
	name: string;
	marker: boolean;
	branch: string;
	base: string;
	repos: string;
	statusColored: string;
	special: "config-missing" | "empty" | null;
}

interface ListJsonWorkspace {
	workspace: string;
	active: boolean;
	branch: string | null;
	base: string | null;
	repoCount: number | null;
	status: "config-missing" | "empty" | null;
	dirty?: number;
	unpushed?: number;
	behind?: number;
	drifted?: number;
}

export function registerListCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("list")
		.summary("List all workspaces")
		.description(
			"List all workspaces in the arb root with aggregate status. Shows branch, base, repo count, and status for each workspace. The active workspace (the one you're currently inside) is marked with *. Use --quick to skip per-repo status gathering for faster output. Use --fetch to fetch all repos before listing for fresh remote data. Use --json for machine-readable output.",
		)
		.option("-f, --fetch", "Fetch all repos before listing")
		.option("-q, --quick", "Skip per-repo status (faster for large setups)")
		.option("--json", "Output structured JSON")
		.action(async (options: { fetch?: boolean; quick?: boolean; json?: boolean }) => {
			const ctx = getCtx();

			// Fetch all canonical repos (benefits all workspaces)
			if (options.fetch) {
				const allRepoNames = listRepos(ctx.reposDir);
				const fetchDirs: string[] = [];
				const localRepos: string[] = [];
				for (const repo of allRepoNames) {
					const repoDir = `${ctx.reposDir}/${repo}`;
					if (await hasRemote(repoDir)) {
						fetchDirs.push(repoDir);
					} else {
						localRepos.push(repo);
					}
				}
				if (fetchDirs.length > 0) {
					const remoteRepoNames = allRepoNames.filter((r) => !localRepos.includes(r));
					const remotesMap = await resolveRemotesMap(remoteRepoNames, ctx.reposDir);
					process.stderr.write(`Fetching ${plural(fetchDirs.length, "repo")}...\n`);
					const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
					reportFetchFailures(allRepoNames, localRepos, fetchResults);
				}
			}

			const workspaces = listWorkspaces(ctx.baseDir);

			// ── Phase 1: gather lightweight metadata (fast, sequential) ──
			const rows: ListRow[] = [];
			const toScan: { index: number; wsDir: string }[] = [];
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
						statusColored: yellow("(empty)"),
						special: "empty",
					});
					continue;
				}

				const reposText = `${repoDirs.length}`;
				if (reposText.length > maxRepos) maxRepos = reposText.length;

				// Placeholder — status will be filled in Phase 2
				rows.push({
					name,
					marker,
					branch,
					base,
					repos: reposText,
					statusColored: dim("..."),
					special: null,
				});
				toScan.push({ index: rows.length - 1, wsDir });
			}

			if (rows.length === 0) {
				if (options.json) {
					process.stdout.write("[]\n");
					return;
				}
				info("No workspaces yet. Create one with: arb create <name>");
				return;
			}

			const showStatus = !options.quick;

			// ── JSON output path ──
			if (options.json) {
				const jsonEntries: ListJsonWorkspace[] = rows.map((row) => ({
					workspace: row.name,
					active: row.marker,
					branch: row.special === "config-missing" ? null : row.branch || null,
					base: row.special === "config-missing" ? null : row.base || null,
					repoCount: row.special === "config-missing" ? null : Number.parseInt(row.repos, 10) || 0,
					status: row.special,
				}));

				if (!showStatus) {
					process.stdout.write(`${JSON.stringify(jsonEntries, null, 2)}\n`);
					return;
				}

				// Gather all workspace summaries (no progress display in JSON mode)
				const results = await Promise.all(
					toScan.map(async (entry) => {
						const summary = await gatherWorkspaceSummary(entry.wsDir, ctx.reposDir);
						return { index: entry.index, summary };
					}),
				);

				for (const { index, summary } of results) {
					const entry = jsonEntries[index];
					if (entry && entry.status === null) {
						const agg = computeAggregates(summary);
						Object.assign(entry, agg);
					}
				}

				process.stdout.write(`${JSON.stringify(jsonEntries, null, 2)}\n`);
				return;
			}

			// ── Table output path ──

			// Column widths
			if (maxName < 9) maxName = 9;
			if (maxBranch < 6) maxBranch = 6;
			if (hasAnyBase && maxBase < 4) maxBase = 4;
			if (maxRepos < 5) maxRepos = 5;

			const tty = isTTY();

			// Render helpers
			const renderHeader = (): string => {
				let header = `  ${dim("WORKSPACE")}${" ".repeat(maxName - 9)}`;
				header += `    ${dim("BRANCH")}${" ".repeat(maxBranch - 6)}`;
				if (hasAnyBase) {
					header += `    ${dim("BASE")}${" ".repeat(maxBase - 4)}`;
				}
				header += `    ${dim("REPOS")}${" ".repeat(maxRepos - 5)}`;
				if (showStatus) {
					header += `    ${dim("STATUS")}`;
				}
				return header;
			};

			const renderRow = (row: ListRow): string => {
				const prefix = row.marker ? `${green("*")} ` : "  ";
				const paddedName = bold(row.name.padEnd(maxName));

				if (row.special === "config-missing") {
					let line = `${prefix}${paddedName}`;
					line += `    ${" ".repeat(maxBranch)}`;
					if (hasAnyBase) line += `    ${" ".repeat(maxBase)}`;
					line += `    ${" ".repeat(maxRepos)}`;
					if (showStatus) line += `    ${row.statusColored}`;
					return line;
				}

				let line = `${prefix}${paddedName}`;
				line += `    ${row.branch.padEnd(maxBranch)}`;
				if (hasAnyBase) {
					line += `    ${row.base.padEnd(maxBase)}`;
				}
				line += `    ${row.repos.padEnd(maxRepos)}`;
				if (showStatus) line += `    ${row.statusColored}`;
				return line;
			};

			const renderTable = () => {
				process.stdout.write(`${renderHeader()}\n`);
				for (const row of rows) {
					process.stdout.write(`${renderRow(row)}\n`);
				}
			};

			// ── Quick mode: skip Phase 2, render immediately ──
			if (!showStatus) {
				renderTable();
				return;
			}

			// ── Phase 2: gather status in parallel ──
			if (tty && toScan.length > 0) {
				// Render initial table with placeholder status
				const rowCount = 1 + rows.length; // header + data rows
				renderTable();

				// Progress counter on stderr
				let totalRepos = 0;
				let scannedRepos = 0;
				const updateProgress = () => {
					process.stderr.write(`\r  Scanning ${scannedRepos}/${totalRepos}`);
				};

				// Run all workspace scans in parallel
				const results = await Promise.all(
					toScan.map(async (entry) => {
						const summary = await gatherWorkspaceSummary(entry.wsDir, ctx.reposDir, (scanned, total) => {
							// On first callback from this workspace, add its total to the aggregate
							if (scanned === 1) totalRepos += total;
							scannedRepos++;
							updateProgress();
						});
						return { index: entry.index, summary };
					}),
				);

				// Clear progress line
				process.stderr.write(`\r${" ".repeat(40)}\r`);

				// Apply results to rows
				for (const { index, summary } of results) {
					const row = rows[index];
					if (row) applySummaryToRow(row, summary);
				}

				// Re-render table in place: move cursor up, overwrite each line
				process.stdout.write(`\x1b[${rowCount}A`);
				for (let i = 0; i < rowCount; i++) {
					process.stdout.write("\r\x1b[2K");
					if (i < rowCount - 1) process.stdout.write("\x1b[1B");
				}
				process.stdout.write(`\x1b[${rowCount - 1}A`);
				renderTable();
			} else {
				// Non-TTY or nothing to scan: gather all data, output once
				const results = await Promise.all(
					toScan.map(async (entry) => {
						const summary = await gatherWorkspaceSummary(entry.wsDir, ctx.reposDir);
						return { index: entry.index, summary };
					}),
				);

				for (const { index, summary } of results) {
					const row = rows[index];
					if (row) applySummaryToRow(row, summary);
				}

				renderTable();
			}
		});
}

function computeAggregates(summary: WorkspaceSummary): {
	dirty: number;
	unpushed: number;
	behind: number;
	drifted: number;
} {
	return {
		dirty: summary.dirty,
		unpushed: summary.repos.filter((r) => !r.remote.local && isUnpushed(r)).length,
		behind: summary.repos.filter((r) => (r.base && r.base.behind > 0) || r.remote.behind > 0).length,
		drifted: summary.drifted,
	};
}

function applySummaryToRow(row: ListRow, summary: WorkspaceSummary): void {
	const agg = computeAggregates(summary);

	const statusColoredParts: string[] = [];

	if (agg.dirty > 0) statusColoredParts.push(yellow(`${agg.dirty} dirty`));
	if (agg.unpushed > 0) statusColoredParts.push(yellow(`${agg.unpushed} unpushed`));
	if (agg.behind > 0) statusColoredParts.push(`${agg.behind} behind`);
	if (agg.drifted > 0) statusColoredParts.push(yellow(`${agg.drifted} drifted`));

	if (statusColoredParts.length === 0) {
		row.statusColored = "ok";
	} else {
		row.statusColored = statusColoredParts.join(", ");
	}
}
