import { basename, resolve } from "node:path";
import type { Command } from "commander";
import { ArbError } from "../lib/core";
import type { ArbContext } from "../lib/core";
import { GitCache, assertMinimumGitVersion, predictMergeConflict } from "../lib/git";
import { printSchema } from "../lib/json";
import { type StatusJsonOutput, StatusJsonOutputSchema } from "../lib/json";
import { type RenderContext, render, runPhasedRender } from "../lib/render";
import { type VerboseDetail, buildStatusView, gatherVerboseDetail, toJsonVerbose } from "../lib/render";
import {
	type WorkspaceSummary,
	baseRef,
	computeFlags,
	computeSummaryAggregates,
	gatherWorkspaceSummary,
	repoMatchesWhere,
	resolveWhereFilter,
} from "../lib/status";
import { type FetchResult, fetchSuffix, parallelFetch, reportFetchFailures } from "../lib/sync";
import {
	clearScanProgress,
	error,
	isTTY,
	listenForAbortKeypress,
	readNamesFromStdin,
	scanProgress,
	stderr,
} from "../lib/terminal";
import { requireWorkspace, resolveRepoSelection, workspaceRepoDirs } from "../lib/workspace";

export function registerStatusCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("status [repos...]")
		.option("-d, --dirty", "Only show repos with local changes (shorthand for --where dirty)")
		.option("-w, --where <filter>", "Filter repos by status flags (comma = OR, + = AND, ^ = negate)")
		.option("--fetch", "Fetch from all remotes before showing status (default)")
		.option("-N, --no-fetch", "Skip fetching")
		.option("-v, --verbose", "Show file-level detail for each repo")
		.option("-q, --quiet", "Output one repo name per line")
		.option("--json", "Output structured JSON (combine with --verbose for commit and file detail)")
		.option("--schema", "Print JSON Schema for this command's --json output and exit")
		.summary("Show workspace status")
		.description(
			"Show each repo's position relative to the base branch, push status against the share remote, and local changes (staged, modified, untracked). The summary includes the workspace's last commit date (most recent author date across all repos).\n\nRepos are positional arguments — name specific repos to filter, or omit to show all. Reads repo names from stdin when piped (one per line), enabling composition like: arb status -q --where dirty | arb diff.\n\nUse --dirty to only show repos with uncommitted changes. Use --where <filter> to filter by status flags. See 'arb help where' for filter syntax. Fetches from all remotes by default for fresh data (skip with -N/--no-fetch). Press Escape during the fetch to cancel and use stale data. Quiet mode (-q) skips fetching by default for scripting speed. Use --verbose for file-level detail. Use --json for machine-readable output. Combine --json --verbose to include commit lists and file-level detail in JSON output.\n\nMerged branches show the detected PR number when available (e.g. 'merged (#123), gone'), extracted from merge or squash commit subjects. JSON output includes detectedPr and detectedTicket fields.\n\nSee 'arb help stacked' for stacked workspace status flags. See 'arb help scripting' for output modes and piping.",
		)
		.action(
			async (
				repoArgs: string[],
				options: {
					dirty?: boolean;
					where?: string;
					fetch?: boolean;
					verbose?: boolean;
					quiet?: boolean;
					json?: boolean;
					schema?: boolean;
				},
			) => {
				if (options.schema) {
					if (options.json || options.quiet || options.verbose) {
						error("Cannot combine --schema with --json, --quiet, or --verbose.");
						throw new ArbError("Cannot combine --schema with --json, --quiet, or --verbose.");
					}
					printSchema(StatusJsonOutputSchema);
					return;
				}
				const ctx = getCtx();
				requireWorkspace(ctx);
				await runStatus(ctx, repoArgs, options);
			},
		);
}

async function runStatus(
	ctx: ArbContext,
	repoArgs: string[],
	options: {
		dirty?: boolean;
		where?: string;
		fetch?: boolean;
		verbose?: boolean;
		quiet?: boolean;
		json?: boolean;
	},
): Promise<void> {
	const wsDir = `${ctx.arbRootDir}/${ctx.currentWorkspace}`;
	const cache = new GitCache();
	await assertMinimumGitVersion(cache);

	const where = resolveWhereFilter(options);

	// Conflict checks
	if (options.quiet && options.json) {
		error("Cannot combine --quiet with --json.");
		throw new ArbError("Cannot combine --quiet with --json.");
	}
	if (options.quiet && options.verbose) {
		error("Cannot combine --quiet with --verbose.");
		throw new ArbError("Cannot combine --quiet with --verbose.");
	}

	// Resolve repo selection: positional args > stdin > all
	let repoNames = repoArgs;
	if (repoNames.length === 0) {
		const stdinNames = await readNamesFromStdin();
		if (stdinNames.length > 0) repoNames = stdinNames;
	}
	const selectedRepos = resolveRepoSelection(wsDir, repoNames);
	const selectedSet = new Set(selectedRepos);

	// Shared gather helper: scan + filter
	const gatherFiltered = async (): Promise<WorkspaceSummary> => {
		const summary = await gatherWorkspaceSummary(
			wsDir,
			ctx.reposDir,
			(scanned, total) => {
				scanProgress(scanned, total);
			},
			cache,
		);
		clearScanProgress();

		let repos = summary.repos.filter((r) => selectedSet.has(r.name));
		if (where) {
			repos = repos.filter((r) => {
				const flags = computeFlags(r, summary.branch);
				return repoMatchesWhere(flags, where);
			});
		}
		const aggregates = computeSummaryAggregates(repos, summary.branch);
		return { ...summary, repos, total: repos.length, ...aggregates };
	};

	// Phased rendering: show stale table immediately, refresh after fetch
	const shouldFetch = options.fetch !== false && !options.quiet;
	const allFetchDirs = shouldFetch ? workspaceRepoDirs(wsDir) : [];
	const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
	const canPhase = shouldFetch && fetchDirs.length > 0 && !options.json && isTTY();

	if (canPhase) {
		const repoNamesForFetch = fetchDirs.map((d) => basename(d));
		const { signal: abortSignal, cleanup: abortCleanup } = listenForAbortKeypress();
		const fetchPromise = cache
			.resolveRemotesMap(repoNamesForFetch, ctx.reposDir)
			.then((remotesMap) => parallelFetch(fetchDirs, undefined, remotesMap, { silent: true, signal: abortSignal }));
		fetchPromise.catch(() => {}); // Prevent unhandled rejection on abort
		const state: { fetchResults?: Map<string, FetchResult>; aborted?: boolean; staleTable?: string } = {};

		try {
			await runPhasedRender([
				{
					render: async () => {
						const data = await gatherFiltered();
						state.staleTable = await renderStatusTable(data, wsDir, { verbose: options.verbose });
						return state.staleTable + fetchSuffix(fetchDirs.length, { abortable: true });
					},
					write: stderr,
				},
				{
					render: async () => {
						if (abortSignal.aborted) {
							state.aborted = true;
							return state.staleTable as string;
						}
						state.fetchResults = await fetchPromise;
						if (abortSignal.aborted) {
							state.aborted = true;
							return state.staleTable as string;
						}
						cache.invalidateAfterFetch();
						const data = await gatherFiltered();
						return await renderStatusTable(data, wsDir, { verbose: options.verbose });
					},
					write: (output) => process.stdout.write(output),
				},
			]);
		} finally {
			abortCleanup();
		}
		if (!state.aborted) {
			reportFetchFailures(repoNamesForFetch, state.fetchResults as Map<string, FetchResult>);
		}
		return;
	}

	// Non-two-phase fetch (non-TTY / CI): warn and continue on failure
	if (shouldFetch && fetchDirs.length > 0) {
		const repos = fetchDirs.map((d) => basename(d));
		const remotesMap = await cache.resolveRemotesMap(repos, ctx.reposDir);
		const results = await parallelFetch(fetchDirs, undefined, remotesMap);
		reportFetchFailures(repos, results);
		cache.invalidateAfterFetch();
	}

	const filteredSummary = await gatherFiltered();

	// Quiet output — one repo name per line
	if (options.quiet) {
		for (const repo of filteredSummary.repos) {
			process.stdout.write(`${repo.name}\n`);
		}
		return;
	}

	// JSON output
	if (options.json) {
		let output: StatusJsonOutput = {
			...filteredSummary,
			statusCounts: filteredSummary.statusCounts.map(({ label, count }) => ({ label, count })),
		};
		if (options.verbose) {
			const reposWithVerbose = await Promise.all(
				filteredSummary.repos.map(async (repo) => {
					const detail = await gatherVerboseDetail(repo, wsDir);
					if (!detail) return repo;
					return { ...repo, verbose: toJsonVerbose(detail, repo.base) };
				}),
			);
			output = { ...output, repos: reposWithVerbose };
		}
		process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		return;
	}

	// Table output
	const tableOutput = await renderStatusTable(filteredSummary, wsDir, { verbose: options.verbose });
	process.stdout.write(tableOutput);
}

async function renderStatusTable(
	filteredSummary: WorkspaceSummary,
	wsDir: string,
	options: { verbose?: boolean },
): Promise<string> {
	const repos = filteredSummary.repos;

	if (repos.length === 0) {
		return "  (no repos)\n";
	}

	// Predict conflicts for diverged repos (both ahead and behind base)
	const conflictRepos = new Set<string>();
	const conflictPromise = Promise.all(
		repos
			.filter((r) => r.base !== null && r.base.ahead > 0 && r.base.behind > 0)
			.map(async (r) => {
				const repoDir = `${wsDir}/${r.name}`;
				const base = r.base;
				if (!base) return;
				const ref = baseRef(base);
				const prediction = await predictMergeConflict(repoDir, ref);
				if (prediction?.hasConflict) {
					conflictRepos.add(r.name);
				}
			}),
	);

	// Gather verbose detail in parallel (when verbose mode is on)
	let verboseData: Map<string, VerboseDetail | undefined> | undefined;
	if (options.verbose) {
		const verbosePromise = Promise.all(
			repos.map(async (repo) => {
				const detail = await gatherVerboseDetail(repo, wsDir);
				return [repo.name, detail] as const;
			}),
		);
		const [, verboseEntries] = await Promise.all([conflictPromise, verbosePromise]);
		verboseData = new Map(verboseEntries);
	} else {
		await conflictPromise;
	}

	// Detect current repo from cwd
	const cwd = resolve(process.cwd());
	let currentRepo: string | null = null;
	for (const repo of repos) {
		const repoDir = resolve(`${wsDir}/${repo.name}`);
		if (cwd === repoDir || cwd.startsWith(`${repoDir}/`)) {
			currentRepo = repo.name;
			break;
		}
	}

	// Build declarative view
	const nodes = buildStatusView(filteredSummary, {
		expectedBranch: filteredSummary.branch,
		conflictRepos,
		currentRepo,
		verboseData,
	});

	// Resolve render context
	const envCols = Number(process.env.COLUMNS);
	const termCols = process.stdout.columns ?? (Number.isFinite(envCols) ? envCols : 0);
	const renderCtx: RenderContext = {
		tty: isTTY(),
		terminalWidth: termCols > 0 ? termCols : undefined,
	};

	return render(nodes, renderCtx);
}
