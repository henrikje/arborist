import { existsSync } from "node:fs";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { hasRemote } from "../lib/git";
import type { ListJsonEntry } from "../lib/json-types";
import { dim, green, info, red, yellow } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { resolveRemotesMap } from "../lib/remotes";
import { listRepos, listWorkspaces, workspaceRepoDirs } from "../lib/repos";
import {
	type WorkspaceSummary,
	formatStatusCounts,
	gatherWorkspaceSummary,
	validateWhere,
	workspaceMatchesWhere,
} from "../lib/status";
import {
	type LastCommitWidths,
	type RelativeTimeParts,
	computeLastCommitWidths,
	formatLastCommitCell,
	formatRelativeTimeParts,
} from "../lib/time";
import { isTTY } from "../lib/tty";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";

interface ListRow {
	name: string;
	marker: boolean;
	branch: string;
	base: string;
	baseFellBack: boolean;
	repos: string;
	statusColored: string;
	lastCommit: string | null;
	special: "config-missing" | "empty" | null;
}

export function registerListCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("list")
		.summary("List all workspaces")
		.description(
			"List all workspaces in the arb root with aggregate status. Shows branch, base, repo count, last commit date, and status for each workspace. The last commit date is the most recent author date across all repos, shown as relative time (e.g. '3 days ago'). The active workspace (the one you're currently inside) is marked with *.\n\nUse --dirty / -d to show only workspaces with dirty repos, or --where <filter> for other status flags (any workspace with at least one matching repo is shown): dirty, unpushed, behind-share, behind-base, diverged, drifted, detached, operation, local, gone, shallow, at-risk, stale. Comma-separated values use OR logic. Use --quick to skip per-repo status gathering for faster output. Use -F/--fetch to fetch all repos before listing for fresh remote data (skip with --no-fetch). Use --json for machine-readable output.",
		)
		.option("-F, --fetch", "Fetch all repos before listing")
		.option("--no-fetch", "Skip fetching (default)", false)
		.option("-q, --quick", "Skip per-repo status (faster for large setups)")
		.option("-d, --dirty", "Only list dirty workspaces (shorthand for --where dirty)")
		.option("-w, --where <filter>", "Filter workspaces by repo status flags (comma-separated, OR logic)")
		.option("--json", "Output structured JSON")
		.action(async (options: { fetch?: boolean; quick?: boolean; dirty?: boolean; where?: string; json?: boolean }) => {
			const ctx = getCtx();

			// Resolve --dirty as shorthand for --where dirty
			if (options.dirty && options.where) {
				process.stderr.write("Cannot combine --dirty with --where. Use --where dirty,... instead.\n");
				process.exit(1);
			}
			const whereFilter = options.dirty ? "dirty" : options.where;
			if (whereFilter) {
				const err = validateWhere(whereFilter);
				if (err) {
					process.stderr.write(`${err}\n`);
					process.exit(1);
				}
				if (options.quick) {
					process.stderr.write("Cannot combine --quick with --where. --where requires status gathering.\n");
					process.exit(1);
				}
			}

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
						baseFellBack: false,
						repos: "",
						statusColored: red("(config missing)"),
						lastCommit: null,
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
						baseFellBack: false,
						repos: reposText,
						statusColored: yellow("(empty)"),
						lastCommit: null,
						special: "empty",
					});
					continue;
				}

				const reposText = `${repoDirs.length}`;
				if (reposText.length > maxRepos) maxRepos = reposText.length;

				// Placeholder — status and lastCommit will be filled in Phase 2
				rows.push({
					name,
					marker,
					branch,
					base,
					baseFellBack: false,
					repos: reposText,
					statusColored: dim("..."),
					lastCommit: null,
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
				const jsonEntries: ListJsonEntry[] = rows.map((row) => ({
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

				const summaryMap = new Map<number, WorkspaceSummary>();
				for (const { index, summary } of results) {
					summaryMap.set(index, summary);
					const entry = jsonEntries[index];
					if (entry && entry.status === null) {
						entry.atRiskCount = summary.atRiskCount;
						entry.statusLabels = summary.statusLabels;
						entry.statusCounts = summary.statusCounts.map(({ label, count }) => ({ label, count }));
						entry.lastCommit = summary.lastCommit;
					}
				}

				// Filter by --where
				let filtered = jsonEntries;
				if (whereFilter) {
					filtered = jsonEntries.filter((_entry, i) => {
						const summary = summaryMap.get(i);
						if (!summary) return false;
						return workspaceMatchesWhere(summary.repos, summary.branch, whereFilter);
					});
				}

				process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
				return;
			}

			// ── Table output path ──

			// Column widths
			if (maxName < 9) maxName = 9;
			if (maxBranch < 6) maxBranch = 6;
			if (hasAnyBase && maxBase < 4) maxBase = 4;
			if (maxRepos < 5) maxRepos = 5;

			const tty = isTTY();

			// LAST COMMIT column width — recomputed before each render
			let lcWidths: LastCommitWidths = { maxNum: 0, maxUnit: 0, total: 11 };
			const lastCommitParts = (row: ListRow): RelativeTimeParts => {
				if (!row.lastCommit) return { num: "", unit: "" };
				return formatRelativeTimeParts(row.lastCommit);
			};
			const recomputeLastCommitWidth = () => {
				lcWidths = computeLastCommitWidths(displayRows.map(lastCommitParts));
			};

			// Render helpers
			const renderHeader = (): string => {
				let header = `  ${dim("WORKSPACE")}${" ".repeat(maxName - 9)}`;
				header += `    ${dim("BRANCH")}${" ".repeat(maxBranch - 6)}`;
				if (hasAnyBase) {
					header += `    ${dim("BASE")}${" ".repeat(maxBase - 4)}`;
				}
				header += `    ${dim("REPOS")}${" ".repeat(maxRepos - 5)}`;
				if (showStatus) {
					header += `    ${dim("LAST COMMIT")}${" ".repeat(lcWidths.total - 11)}`;
					header += `    ${dim("STATUS")}`;
				}
				return header;
			};

			const renderRow = (row: ListRow): string => {
				const prefix = row.marker ? `${green("*")} ` : "  ";
				const paddedName = row.name.padEnd(maxName);

				if (row.special === "config-missing") {
					let line = `${prefix}${paddedName}`;
					line += `    ${" ".repeat(maxBranch)}`;
					if (hasAnyBase) line += `    ${" ".repeat(maxBase)}`;
					line += `    ${" ".repeat(maxRepos)}`;
					if (showStatus) {
						line += `    ${" ".repeat(lcWidths.total)}`;
						line += `    ${row.statusColored}`;
					}
					return line;
				}

				let line = `${prefix}${paddedName}`;
				line += `    ${row.branch.padEnd(maxBranch)}`;
				if (hasAnyBase) {
					const baseText = row.baseFellBack ? yellow(row.base.padEnd(maxBase)) : row.base.padEnd(maxBase);
					line += `    ${baseText}`;
				}
				line += `    ${row.repos.padEnd(maxRepos)}`;
				if (showStatus) {
					const parts = lastCommitParts(row);
					let commitCell: string;
					if (parts.num || parts.unit) {
						commitCell = formatLastCommitCell(parts, lcWidths, true);
					} else if (row.special === null) {
						commitCell = "...".padEnd(lcWidths.total);
					} else {
						commitCell = " ".repeat(lcWidths.total);
					}
					line += `    ${commitCell}`;
					line += `    ${row.statusColored}`;
				}
				return line;
			};

			// Track summaries for --where filtering
			const summaryByIndex = new Map<number, WorkspaceSummary>();

			// Rows to display (may be filtered by --where after Phase 2)
			let displayRows = rows;

			const renderTable = () => {
				process.stdout.write(`${renderHeader()}\n`);
				for (const row of displayRows) {
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
					summaryByIndex.set(index, summary);
					const row = rows[index];
					if (row) applySummaryToRow(row, summary);
				}

				// Filter by --where
				if (whereFilter) {
					displayRows = rows.filter((_, i) => {
						const summary = summaryByIndex.get(i);
						if (!summary) return false;
						return workspaceMatchesWhere(summary.repos, summary.branch, whereFilter);
					});
				}
				recomputeLastCommitWidth();

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
					summaryByIndex.set(index, summary);
					const row = rows[index];
					if (row) applySummaryToRow(row, summary);
				}

				// Filter by --where
				if (whereFilter) {
					displayRows = rows.filter((_, i) => {
						const summary = summaryByIndex.get(i);
						if (!summary) return false;
						return workspaceMatchesWhere(summary.repos, summary.branch, whereFilter);
					});
				}
				recomputeLastCommitWidth();

				renderTable();
			}
		});
}

function applySummaryToRow(row: ListRow, summary: WorkspaceSummary): void {
	if (summary.statusCounts.length === 0) {
		row.statusColored = "no issues";
	} else {
		row.statusColored = formatStatusCounts(summary.statusCounts, summary.rebasedOnlyCount);
	}
	row.lastCommit = summary.lastCommit;
	row.baseFellBack = summary.repos.some((r) => r.base?.configuredRef != null);
}
