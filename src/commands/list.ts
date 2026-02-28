import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { ArbError } from "../lib/errors";
import { GitCache } from "../lib/git-cache";
import type { ListJsonEntry } from "../lib/json-types";
import { clearScanProgress, dim, error, info, scanProgress, stripAnsi, yellow } from "../lib/output";
import { type FetchResult, fetchSuffix, parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { runPhasedRender } from "../lib/phased-render";
import { listWorkspaces, workspaceRepoDirs } from "../lib/repos";
import {
	type WorkspaceSummary,
	formatStatusCounts,
	gatherWorkspaceSummary,
	validateWhere,
	workspaceMatchesWhere,
} from "../lib/status";
import { type Column, renderTable } from "../lib/table";
import {
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

interface ListColumnWidths {
	maxName: number;
	maxBranch: number;
	maxBase: number;
	maxRepos: number;
	hasAnyBase: boolean;
}

interface ListMetadata {
	rows: ListRow[];
	toScan: { index: number; wsDir: string }[];
	cols: ListColumnWidths;
}

export function registerListCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("list")
		.summary("List all workspaces")
		.description(
			"List all workspaces in the arb root with aggregate status. Shows branch, base, repo count, last commit date, and status for each workspace. The last commit date is the most recent author date across all repos, shown as relative time (e.g. '3 days ago'). The active workspace (the one you're currently inside) is marked with *.\n\nUse --dirty / -d to show only workspaces with dirty repos, or --where <filter> for other status flags (any workspace with at least one matching repo is shown): dirty, unpushed, behind-share, behind-base, diverged, drifted, detached, operation, gone, shallow, merged, base-merged, base-missing, at-risk, stale. Positive/healthy terms: clean, pushed, synced-base, synced-share, synced, safe. Prefix any term with ^ to negate (e.g. --where ^dirty is equivalent to --where clean). Comma-separated values use OR logic; use + for AND (e.g. --where dirty+unpushed). + binds tighter than comma: dirty+unpushed,gone = (dirty AND unpushed) OR gone. Use --no-status to skip per-repo status gathering for faster output. Fetches workspace repos by default for fresh remote data (skip with -N/--no-fetch). Quiet mode (-q) skips fetching by default for scripting speed. Use --json for machine-readable output.",
		)
		.option("--fetch", "Fetch workspace repos before listing (default)")
		.option("-N, --no-fetch", "Skip fetching")
		.option("--no-status", "Skip per-repo status (faster for large setups)")
		.option("-d, --dirty", "Only list dirty workspaces (shorthand for --where dirty)")
		.option("-w, --where <filter>", "Filter workspaces by repo status flags (comma = OR, + = AND, ^ = negate)")
		.option("-q, --quiet", "Output one workspace name per line")
		.option("--json", "Output structured JSON")
		.action(
			async (options: {
				fetch?: boolean;
				status?: boolean;
				dirty?: boolean;
				where?: string;
				quiet?: boolean;
				json?: boolean;
			}) => {
				const ctx = getCtx();
				const cache = new GitCache();

				// Conflict checks
				if (options.quiet && options.json) {
					error("Cannot combine --quiet with --json.");
					throw new ArbError("Cannot combine --quiet with --json.");
				}

				// Resolve --dirty as shorthand for --where dirty
				if (options.dirty && options.where) {
					error("Cannot combine --dirty with --where. Use --where dirty,... instead.");
					throw new ArbError("Cannot combine --dirty with --where. Use --where dirty,... instead.");
				}
				const whereFilter = options.dirty ? "dirty" : options.where;
				if (whereFilter) {
					const validationErr = validateWhere(whereFilter);
					if (validationErr) {
						error(validationErr);
						throw new ArbError(validationErr);
					}
					if (options.status === false) {
						error("Cannot combine --no-status with --where. --where requires status gathering.");
						throw new ArbError("Cannot combine --no-status with --where. --where requires status gathering.");
					}
				}

				const workspaces = listWorkspaces(ctx.arbRootDir);
				const metadata = await gatherListMetadata(ctx, workspaces);

				if (metadata.rows.length === 0) {
					if (options.json) {
						process.stdout.write("[]\n");
						return;
					}
					info("No workspaces yet. Create one with: arb create <name>");
					return;
				}

				const showStatus = options.status !== false;

				const shouldFetch = options.fetch !== false && !options.quiet;
				const repoNames = workspaceRepoNames(metadata);

				// ── Quiet output path ──
				if (options.quiet) {
					if (options.fetch) await blockingFetchRepos(ctx, cache, repoNames); // only if explicitly requested
					if (whereFilter) {
						const results = await Promise.all(
							metadata.toScan.map(async (entry) => {
								try {
									const summary = await gatherWorkspaceSummary(entry.wsDir, ctx.reposDir, undefined, cache);
									return { index: entry.index, summary };
								} catch {
									return { index: entry.index, summary: null };
								}
							}),
						);
						const summaryMap = new Map<number, WorkspaceSummary>();
						for (const { index, summary } of results) {
							if (summary) summaryMap.set(index, summary);
						}
						for (let i = 0; i < metadata.rows.length; i++) {
							const summary = summaryMap.get(i);
							if (!summary) continue;
							const row = metadata.rows[i];
							if (row && workspaceMatchesWhere(summary.repos, summary.branch, whereFilter)) {
								process.stdout.write(`${row.name}\n`);
							}
						}
					} else {
						for (const row of metadata.rows) {
							process.stdout.write(`${row.name}\n`);
						}
					}
					return;
				}

				// ── JSON output path ──
				if (options.json) {
					if (shouldFetch) await blockingFetchRepos(ctx, cache, repoNames);

					const jsonEntries: ListJsonEntry[] = metadata.rows.map((row) => ({
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

					const results = await Promise.all(
						metadata.toScan.map(async (entry) => {
							try {
								const summary = await gatherWorkspaceSummary(entry.wsDir, ctx.reposDir, undefined, cache);
								return { index: entry.index, summary };
							} catch {
								return { index: entry.index, summary: null };
							}
						}),
					);

					const summaryMap = new Map<number, WorkspaceSummary>();
					for (const { index, summary } of results) {
						if (!summary) {
							const entry = jsonEntries[index];
							if (entry) entry.status = "error";
							continue;
						}
						summaryMap.set(index, summary);
						const entry = jsonEntries[index];
						if (entry && entry.status === null) {
							entry.atRiskCount = summary.atRiskCount;
							entry.statusLabels = summary.statusLabels;
							entry.statusCounts = summary.statusCounts.map(({ label, count }) => ({ label, count }));
							entry.lastCommit = summary.lastCommit;
						}
					}

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

				if (!showStatus) {
					if (shouldFetch) await blockingFetchRepos(ctx, cache, repoNames);
					process.stdout.write(formatListTable(metadata.rows, metadata.cols, false));
					return;
				}

				const tty = isTTY();
				const canPhase = tty && metadata.toScan.length > 0;

				if (canPhase && shouldFetch) {
					// 3-phase: placeholder → stale + fetching → fresh
					const fetchDirs = repoNames.map((r) => `${ctx.reposDir}/${r}`);
					const remotesMap = await cache.resolveRemotesMap(repoNames, ctx.reposDir);
					const fetchPromise = parallelFetch(fetchDirs, undefined, remotesMap, { silent: true });
					const state: { fetchResults?: Map<string, FetchResult> } = {};

					await runPhasedRender([
						{ render: () => formatListTable(metadata.rows, metadata.cols, true) },
						{
							render: async () => {
								const statusRows = await gatherListStatus(metadata, ctx, whereFilter, cache);
								return formatListTable(statusRows, metadata.cols, true) + fetchSuffix(fetchDirs.length);
							},
						},
						{
							render: async () => {
								state.fetchResults = await fetchPromise;
								cache.invalidateAfterFetch();
								const statusRows = await gatherListStatus(metadata, ctx, whereFilter, cache);
								return formatListTable(statusRows, metadata.cols, true);
							},
							write: (o) => process.stdout.write(o),
						},
					]);
					reportFetchFailures(repoNames, state.fetchResults as Map<string, FetchResult>);
				} else if (canPhase) {
					// 2-phase: placeholder → status
					await runPhasedRender([
						{ render: () => formatListTable(metadata.rows, metadata.cols, true) },
						{
							render: async () => {
								const statusRows = await gatherListStatus(metadata, ctx, whereFilter, cache);
								return formatListTable(statusRows, metadata.cols, true);
							},
							write: (o) => process.stdout.write(o),
						},
					]);
				} else {
					// Non-phased (non-TTY or nothing to scan)
					if (shouldFetch) await blockingFetchRepos(ctx, cache, repoNames);
					const statusRows = await gatherListStatus(metadata, ctx, whereFilter, cache);
					process.stdout.write(formatListTable(statusRows, metadata.cols, true));
				}
			},
		);
}

// ── Metadata gathering ──

async function gatherListMetadata(ctx: ArbContext, workspaces: string[]): Promise<ListMetadata> {
	const rows: ListRow[] = [];
	const toScan: { index: number; wsDir: string }[] = [];
	let maxName = 0;
	let maxBranch = 0;
	let maxBase = 0;
	let maxRepos = 0;
	let hasAnyBase = false;

	for (const name of workspaces) {
		const wsDir = `${ctx.arbRootDir}/${name}`;
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
				statusColored: yellow("(config missing)"),
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

	if (maxName < 9) maxName = 9;
	if (maxBranch < 6) maxBranch = 6;
	if (hasAnyBase && maxBase < 4) maxBase = 4;
	if (maxRepos < 5) maxRepos = 5;

	return {
		rows,
		toScan,
		cols: { maxName, maxBranch, maxBase, maxRepos, hasAnyBase },
	};
}

// ── Status gathering ──

async function gatherListStatus(
	metadata: ListMetadata,
	ctx: ArbContext,
	whereFilter: string | undefined,
	cache: GitCache,
): Promise<ListRow[]> {
	const rows = metadata.rows.map((r) => ({ ...r }));
	const summaryByIndex = new Map<number, WorkspaceSummary>();

	let totalRepos = 0;
	let scannedRepos = 0;

	const results = await Promise.all(
		metadata.toScan.map(async (entry) => {
			try {
				const summary = await gatherWorkspaceSummary(
					entry.wsDir,
					ctx.reposDir,
					(scanned, total) => {
						if (scanned === 1) totalRepos += total;
						scannedRepos++;
						scanProgress(scannedRepos, totalRepos);
					},
					cache,
				);
				return { index: entry.index, summary };
			} catch {
				return { index: entry.index, summary: null };
			}
		}),
	);

	if (scannedRepos > 0) clearScanProgress();

	for (const { index, summary } of results) {
		if (!summary) {
			const row = rows[index];
			if (row) row.statusColored = yellow("(remotes not resolved)");
			continue;
		}
		summaryByIndex.set(index, summary);
		const row = rows[index];
		if (row) applySummaryToRow(row, summary);
	}

	if (whereFilter) {
		return rows.filter((_, i) => {
			const summary = summaryByIndex.get(i);
			if (!summary) return false;
			return workspaceMatchesWhere(summary.repos, summary.branch, whereFilter);
		});
	}

	return rows;
}

// ── Rendering ──

function lastCommitParts(row: ListRow): RelativeTimeParts {
	if (!row.lastCommit) return { num: "", unit: "" };
	return formatRelativeTimeParts(row.lastCommit);
}

function formatListTable(displayRows: ListRow[], cols: ListColumnWidths, showStatus: boolean): string {
	const lcWidths = computeLastCommitWidths(displayRows.map(lastCommitParts));

	const statusPlain: string[] = displayRows.map((row) => stripAnsi(row.statusColored));

	const columns: Column<ListRow>[] = [
		{
			header: "WORKSPACE",
			value: (row) => row.name,
		},
		{
			header: "BRANCH",
			value: (row) => (row.special === "config-missing" ? " ".repeat(cols.maxBranch) : row.branch),
		},
	];

	if (cols.hasAnyBase) {
		columns.push({
			header: "BASE",
			value: (row) => (row.special === "config-missing" ? " ".repeat(cols.maxBase) : row.base),
			render: (row) => {
				if (row.special === "config-missing") return " ".repeat(cols.maxBase);
				return row.baseFellBack ? yellow(row.base) : row.base;
			},
		});
	}

	columns.push({
		header: "REPOS",
		value: (row) => (row.special === "config-missing" ? " ".repeat(cols.maxRepos) : row.repos),
	});

	if (showStatus) {
		columns.push({
			header: "LAST COMMIT",
			value: (row) => {
				const parts = lastCommitParts(row);
				if (parts.num || parts.unit) return formatLastCommitCell(parts, lcWidths, true);
				if (row.special === null) return "...".padEnd(lcWidths.total);
				return " ".repeat(lcWidths.total);
			},
		});
		columns.push({
			header: "STATUS",
			value: (_row, i) => statusPlain[i] ?? "",
			render: (row) => row.statusColored,
		});
	}

	return renderTable(columns, displayRows, { marker: (row) => row.marker });
}

// ── Helpers ──

function workspaceRepoNames(metadata: ListMetadata): string[] {
	const names = new Set<string>();
	for (const { wsDir } of metadata.toScan) {
		for (const dir of workspaceRepoDirs(wsDir)) {
			names.add(basename(dir));
		}
	}
	return [...names].sort();
}

async function blockingFetchRepos(ctx: ArbContext, cache: GitCache, repoNames: string[]): Promise<void> {
	if (repoNames.length === 0) return;
	const fetchDirs = repoNames.map((r) => `${ctx.reposDir}/${r}`);
	const remotesMap = await cache.resolveRemotesMap(repoNames, ctx.reposDir);
	const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
	reportFetchFailures(repoNames, fetchResults);
	cache.invalidateAfterFetch();
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
