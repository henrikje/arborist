import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { z } from "zod";
import { ArbError, type RelativeTimeParts, configGet, formatRelativeTimeParts } from "../lib/core";
import type { ArbContext } from "../lib/core";
import { GitCache, assertMinimumGitVersion } from "../lib/git";
import { printSchema } from "../lib/json";
import { type ListJsonEntry, ListJsonEntrySchema } from "../lib/json";
import { type RenderContext, render, runPhasedRender } from "../lib/render";
import type { Cell, OutputNode } from "../lib/render";
import { EMPTY_CELL, cell } from "../lib/render";
import { buildStatusCountsCell } from "../lib/render";
import {
	type WorkspaceSummary,
	gatherWorkspaceSummary,
	resolveWhereFilter,
	workspaceMatchesWhere,
} from "../lib/status";
import { detectTicketFromName } from "../lib/status";
import { type FetchResult, fetchSuffix, parallelFetch, reportFetchFailures } from "../lib/sync";
import { clearScanProgress, dim, error, info, isTTY, listenForAbortKeypress, scanProgress } from "../lib/terminal";
import { listWorkspaces, workspaceBranch, workspaceRepoDirs } from "../lib/workspace";

interface ListRow {
	name: string;
	marker: boolean;
	branch: string;
	base: string;
	baseCell: Cell;
	ticket: string;
	repos: string;
	statusCell: Cell;
	lastCommit: string | null;
	special: "config-missing" | "empty" | null;
}

interface ListMetadata {
	rows: ListRow[];
	toScan: { index: number; wsDir: string }[];
}

export function registerListCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("list")
		.summary("List all workspaces")
		.description(
			"List all workspaces in the arb root with aggregate status. Shows branch, base, repo count, last commit date, and status for each workspace. The last commit date is the most recent author date across all repos, shown as relative time (e.g. '3 days ago'). The active workspace (the one you're currently inside) is marked with *.\n\nUse --dirty / -d to show only workspaces with dirty repos, or --where <filter> to filter by status flags (any workspace with at least one matching repo is shown). See 'arb help where' for filter syntax. Use --no-status to skip per-repo status gathering for faster output. Fetches workspace repos by default for fresh remote data (skip with -N/--no-fetch). Press Escape during the fetch to cancel and use stale data. Quiet mode (-q) skips fetching by default for scripting speed. Use --json for machine-readable output.\n\nA TICKET column appears when ticket keys (e.g. PROJ-208, ACME-42) are detected from branch names or commit messages.\n\nSee 'arb help scripting' for output modes and piping.",
		)
		.option("--fetch", "Fetch workspace repos before listing (default)")
		.option("-N, --no-fetch", "Skip fetching")
		.option("--no-status", "Skip per-repo status (faster for large setups)")
		.option("-d, --dirty", "Only list dirty workspaces (shorthand for --where dirty)")
		.option("-w, --where <filter>", "Filter workspaces by repo status flags (comma = OR, + = AND, ^ = negate)")
		.option("-q, --quiet", "Output one workspace name per line")
		.option("--json", "Output structured JSON")
		.option("--schema", "Print JSON Schema for this command's --json output and exit")
		.action(
			async (options: {
				fetch?: boolean;
				status?: boolean;
				dirty?: boolean;
				where?: string;
				quiet?: boolean;
				json?: boolean;
				schema?: boolean;
			}) => {
				if (options.schema) {
					if (options.json || options.quiet) {
						error("Cannot combine --schema with --json or --quiet.");
						throw new ArbError("Cannot combine --schema with --json or --quiet.");
					}
					printSchema(z.array(ListJsonEntrySchema));
					return;
				}
				const ctx = getCtx();
				const cache = new GitCache();
				await assertMinimumGitVersion(cache);

				// Conflict checks
				if (options.quiet && options.json) {
					error("Cannot combine --quiet with --json.");
					throw new ArbError("Cannot combine --quiet with --json.");
				}

				const whereFilter = resolveWhereFilter(options);
				if (whereFilter && options.status === false) {
					error("Cannot combine --no-status with --where. --where requires status gathering.");
					throw new ArbError("Cannot combine --no-status with --where. --where requires status gathering.");
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
						...(row.ticket ? { detectedTicket: { key: row.ticket } } : {}),
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
							if (!entry.detectedTicket && summary.detectedTicket) {
								entry.detectedTicket = summary.detectedTicket;
							}
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
					process.stdout.write(formatListTable(metadata.rows, false));
					return;
				}

				const tty = isTTY();
				const canPhase = tty && metadata.toScan.length > 0;

				if (canPhase && shouldFetch) {
					// 3-phase: placeholder + fetching → placeholder + scanning → fresh
					const fetchDirs = repoNames.map((r) => `${ctx.reposDir}/${r}`);
					const remotesMap = await cache.resolveRemotesMap(repoNames, ctx.reposDir);
					const { signal: abortSignal, cleanup: abortCleanup } = listenForAbortKeypress();
					const fetchPromise = parallelFetch(fetchDirs, undefined, remotesMap, {
						silent: true,
						signal: abortSignal,
					});
					fetchPromise.catch(() => {}); // Prevent unhandled rejection on abort
					const state: {
						fetchResults?: Map<string, FetchResult>;
						aborted?: boolean;
					} = {};
					const placeholder = formatListTable(metadata.rows, true);

					try {
						await runPhasedRender([
							{
								render: () => placeholder + fetchSuffix(fetchDirs.length, { abortable: true }),
							},
							{
								render: async () => {
									if (abortSignal.aborted) {
										state.aborted = true;
										return placeholder;
									}
									state.fetchResults = await fetchPromise;
									if (abortSignal.aborted) {
										state.aborted = true;
										return placeholder;
									}
									cache.invalidateAfterFetch();
									return placeholder + dim("Scanning...");
								},
							},
							{
								render: async () => {
									if (state.aborted) return placeholder;
									const statusRows = await gatherListStatus(metadata, ctx, whereFilter, cache, {
										silent: true,
									});
									return formatListTable(statusRows, true);
								},
								write: (o) => process.stdout.write(o),
							},
						]);
					} finally {
						abortCleanup();
					}
					if (!state.aborted) {
						reportFetchFailures(repoNames, state.fetchResults as Map<string, FetchResult>);
					}
				} else if (canPhase) {
					// 2-phase: placeholder + scanning → fresh
					await runPhasedRender([
						{ render: () => formatListTable(metadata.rows, true) + dim("Scanning...") },
						{
							render: async () => {
								const statusRows = await gatherListStatus(metadata, ctx, whereFilter, cache, {
									silent: true,
								});
								return formatListTable(statusRows, true);
							},
							write: (o) => process.stdout.write(o),
						},
					]);
				} else {
					// Non-phased (non-TTY or nothing to scan)
					if (shouldFetch) await blockingFetchRepos(ctx, cache, repoNames);
					const statusRows = await gatherListStatus(metadata, ctx, whereFilter, cache);
					process.stdout.write(formatListTable(statusRows, true));
				}
			},
		);
}

// ── Metadata gathering ──

async function gatherListMetadata(ctx: ArbContext, workspaces: string[]): Promise<ListMetadata> {
	const rows: ListRow[] = [];
	const toScan: { index: number; wsDir: string }[] = [];

	for (const name of workspaces) {
		const wsDir = `${ctx.arbRootDir}/${name}`;
		const marker = name === ctx.currentWorkspace;

		const configMissing = !existsSync(`${wsDir}/.arbws/config`);

		if (configMissing) {
			rows.push({
				name,
				marker,
				branch: "",
				base: "",
				baseCell: EMPTY_CELL,
				ticket: "",
				repos: "",
				statusCell: cell("(config missing)", "attention"),
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

		// Detect ticket from branch name (cheap, no git call)
		const ticket = detectTicketFromName(branch) ?? "";

		if (repoDirs.length === 0) {
			rows.push({
				name,
				marker,
				branch,
				base,
				baseCell: cell(base),
				ticket,
				repos: "0",
				statusCell: cell("(empty)", "attention"),
				lastCommit: null,
				special: "empty",
			});
			continue;
		}

		rows.push({
			name,
			marker,
			branch,
			base,
			baseCell: cell(base),
			ticket,
			repos: `${repoDirs.length}`,
			statusCell: cell("...", "muted"),
			lastCommit: null,
			special: null,
		});
		toScan.push({ index: rows.length - 1, wsDir });
	}

	return { rows, toScan };
}

// ── Status gathering ──

async function gatherListStatus(
	metadata: ListMetadata,
	ctx: ArbContext,
	whereFilter: string | undefined,
	cache: GitCache,
	options?: { silent?: boolean },
): Promise<ListRow[]> {
	const rows = metadata.rows.map((r) => ({ ...r }));
	const summaryByIndex = new Map<number, WorkspaceSummary>();

	let totalRepos = 0;
	let scannedRepos = 0;

	const progressCallback = options?.silent
		? undefined
		: (scanned: number, total: number) => {
				if (scanned === 1) totalRepos += total;
				scannedRepos++;
				scanProgress(scannedRepos, totalRepos);
			};

	const results = await Promise.all(
		metadata.toScan.map(async (entry) => {
			try {
				const summary = await gatherWorkspaceSummary(entry.wsDir, ctx.reposDir, progressCallback, cache);
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
			if (row) row.statusCell = cell("(remotes not resolved)", "attention");
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

export function buildListTableNodes(displayRows: ListRow[], showStatus: boolean): OutputNode[] {
	const hasAnyTicket = displayRows.some((row) => row.ticket.length > 0);
	const hasAnyBase = displayRows.some((row) => row.base.length > 0);

	// Compute max number width for right-aligning within the LAST COMMIT column
	let maxNumWidth = 0;
	if (showStatus) {
		for (const row of displayRows) {
			const parts = lastCommitParts(row);
			if (parts.num.length > maxNumWidth) maxNumWidth = parts.num.length;
		}
	}

	const columns = [
		{ header: "WORKSPACE", key: "workspace" },
		{ header: "TICKET", key: "ticket", show: hasAnyTicket },
		{ header: "BRANCH", key: "branch" },
		{ header: "BASE", key: "base", show: hasAnyBase },
		{ header: "REPOS", key: "repos" },
		...(showStatus
			? [
					{ header: "LAST COMMIT", key: "lastCommit" },
					{ header: "STATUS", key: "status" },
				]
			: []),
	];

	const rows = displayRows.map((row) => {
		const parts = lastCommitParts(row);
		let lastCommitCell: Cell;
		if (parts.num && parts.unit) {
			lastCommitCell = cell(`${parts.num.padStart(maxNumWidth)} ${parts.unit}`);
		} else if (row.special === null) {
			lastCommitCell = cell("...", "muted");
		} else {
			lastCommitCell = EMPTY_CELL;
		}

		return {
			cells: {
				workspace: cell(row.name),
				ticket: cell(row.ticket),
				branch: row.special === "config-missing" ? EMPTY_CELL : cell(row.branch),
				base: row.baseCell,
				repos: row.special === "config-missing" ? EMPTY_CELL : cell(row.repos),
				lastCommit: lastCommitCell,
				status: row.statusCell,
			},
			marked: row.marker,
		};
	});

	return [{ kind: "table" as const, columns, rows }];
}

function formatListTable(displayRows: ListRow[], showStatus: boolean): string {
	const nodes = buildListTableNodes(displayRows, showStatus);
	const envCols = Number(process.env.COLUMNS);
	const termCols = process.stdout.columns ?? (Number.isFinite(envCols) ? envCols : 0);
	const ctx: RenderContext = { tty: isTTY(), terminalWidth: termCols > 0 ? termCols : undefined };
	return render(nodes, ctx);
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
		row.statusCell = cell("no issues");
	} else {
		row.statusCell = buildStatusCountsCell(summary.statusCounts, summary.rebasedOnlyCount);
	}
	row.lastCommit = summary.lastCommit;
	const baseFellBack = summary.repos.some((r) => r.base?.configuredRef != null);
	if (baseFellBack) {
		row.baseCell = cell(row.base, "attention");
	}
	// Update ticket from summary if it detected one from commits and branch didn't have one
	if (!row.ticket && summary.detectedTicket) {
		row.ticket = summary.detectedTicket.key;
	}
}
