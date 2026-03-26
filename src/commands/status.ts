import { basename, resolve } from "node:path";
import type { Command } from "commander";
import { predictMergeConflict } from "../lib/analysis";
import { ArbError, type CommandContext, arbAction, readOperationRecord, readWorkspaceConfig } from "../lib/core";
import { localTimeout } from "../lib/git/git";
import { printSchema } from "../lib/json";
import { type StatusJsonOutput, StatusJsonOutputSchema } from "../lib/json";
import {
  buildRefParenthetical,
  createRenderContext,
  fitToHeight,
  render,
  renderCell,
  runPhasedRender,
  spans,
} from "../lib/render";
import { buildStatusView } from "../lib/render";
import {
  type RepoStatus,
  type VerboseDetail,
  type WorkspaceSummary,
  baseRef,
  computeFlags,
  computeSummaryAggregates,
  gatherVerboseDetail,
  gatherWorkspaceSummary,
  repoMatchesWhere,
  resolveWhereFilter,
  toJsonVerbose,
} from "../lib/status";
import {
  type FetchResult,
  fetchSuffix,
  getUnchangedRepos,
  parallelFetch,
  reportFetchFailures,
  resolveDefaultFetch,
} from "../lib/sync";
import {
  clearScanProgress,
  error,
  hintsEnabled,
  isTTY,
  listenForAbortSignal,
  scanProgress,
  stderr,
  warn,
} from "../lib/terminal";
import { requireWorkspace, resolveReposFromArgsOrStdin, workspaceRepoDirs } from "../lib/workspace";

export function registerStatusCommand(program: Command): void {
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
    .summary("Show repo branches, sync status, and local changes")
    .description(
      "Examples:\n\n  arb status                               Show all repos\n  arb status --dirty                       Only repos with local changes\n  arb status api web --verbose             File-level detail for specific repos\n\nShow each repo's position relative to the base branch, push status against the share remote, and local changes (staged, modified, untracked). The summary includes the workspace's last commit date (most recent author date across all repos).\n\nRepos are positional arguments — name specific repos to filter, or omit to show all. Reads repo names from stdin when piped (one per line), enabling composition like: arb status -q --where dirty | arb log.\n\nUse --dirty to only show repos with uncommitted changes. Use --where <filter> to filter by status flags. See 'arb help filtering' for filter syntax. Fetches from all remotes by default for fresh data (skip with -N/--no-fetch). Press Ctrl+C during the fetch to cancel and use stale data. Quiet mode (-q) skips fetching by default for scripting speed. Use --verbose for file-level detail. Use --json for machine-readable output. Combine --json --verbose to include commit lists and file-level detail in JSON output.\n\nFor a live dashboard with sync commands, use 'arb watch'.\n\nMerged branches show the detected PR number when available (e.g. 'merged (#123), gone'), extracted from merge or squash commit subjects. JSON output includes detectedPr fields.\n\nSee 'arb help stacked' for stacked workspace status flags. See 'arb help scripting' for output modes and piping.",
    )
    .action(async (repoArgs: string[], options, command) => {
      if (options.schema) {
        if (options.json || options.quiet || options.verbose) {
          error("Cannot combine --schema with --json, --quiet, or --verbose.");
          throw new ArbError("Cannot combine --schema with --json, --quiet, or --verbose.");
        }
        printSchema(StatusJsonOutputSchema);
        return;
      }
      await arbAction(async (ctx, repoArgs: string[], options) => {
        requireWorkspace(ctx);
        await runStatus(ctx, repoArgs, options);
      })(repoArgs, options, command);
    });
}

async function runStatus(
  ctx: CommandContext,
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
  const cache = ctx.cache;
  const aCache = ctx.analysisCache;
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
  const selectedRepos = await resolveReposFromArgsOrStdin(wsDir, repoArgs);
  const selectedSet = new Set(selectedRepos);

  // Shared gather helper: scan + filter.
  // When previousResults is provided, repos in that map are reused instead of re-scanned.
  const gatherFiltered = async (previousResults?: Map<string, RepoStatus>): Promise<WorkspaceSummary> => {
    const summary = await gatherWorkspaceSummary(
      wsDir,
      ctx.reposDir,
      (scanned, total) => {
        scanProgress(scanned, total);
      },
      cache,
      { previousResults, analysisCache: aCache, repoFilter: selectedSet },
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
  const wantsFetch = resolveDefaultFetch(options.fetch) && !options.quiet;
  const allFetchDirs = wantsFetch ? workspaceRepoDirs(wsDir) : [];
  const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
  const repoNamesForFetch = fetchDirs.map((d) => basename(d));
  const shouldFetch = wantsFetch;
  const canPhase = shouldFetch && fetchDirs.length > 0 && !options.json && isTTY();

  if (canPhase) {
    const { signal: abortSignal, cleanup: abortCleanup } = listenForAbortSignal();
    const fetchPromise = cache
      .resolveRemotesMap(repoNamesForFetch, ctx.reposDir)
      .then((remotesMap) => parallelFetch(fetchDirs, undefined, remotesMap, { silent: true, signal: abortSignal }));
    fetchPromise.catch(() => {}); // Prevent unhandled rejection on abort
    const state: {
      fetchResults?: Map<string, FetchResult>;
      aborted?: boolean;
      staleTable?: string;
      staleRepos?: RepoStatus[];
      finalSummary?: WorkspaceSummary;
    } = {};

    try {
      await runPhasedRender(
        [
          {
            render: async () => {
              const data = await gatherFiltered();
              state.staleRepos = data.repos;
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
              // Reuse phase-1 results for repos whose fetch was a no-op
              const unchanged = getUnchangedRepos(state.fetchResults);
              const previousResults = new Map<string, RepoStatus>();
              for (const repo of state.staleRepos ?? []) {
                if (unchanged.has(repo.name)) previousResults.set(repo.name, repo);
              }
              const data = await gatherFiltered(previousResults);
              state.finalSummary = data;
              return await renderStatusTable(data, wsDir, { verbose: options.verbose });
            },
            write: (output) => process.stdout.write(output),
          },
        ],
        { preserveTypeahead: true },
      );
    } finally {
      abortCleanup();
    }
    if (!state.aborted) {
      reportFetchFailures(repoNamesForFetch, state.fetchResults as Map<string, FetchResult>);
    }
    if (state.finalSummary) {
      reportTimeoutHint(state.finalSummary.repos);
      reportWorkspaceHints(state.finalSummary, wsDir);
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
    const { baseConflictRepos, pullConflictRepos } = await predictConflicts(filteredSummary.repos, wsDir);
    const reposWithPredictions = filteredSummary.repos.map((repo) => {
      const baseConflict = baseConflictRepos.has(repo.name);
      const pullConflict = pullConflictRepos.has(repo.name);
      if (!baseConflict && !pullConflict) return repo;
      return { ...repo, predictions: { baseConflict, pullConflict } };
    });
    let output: StatusJsonOutput = {
      ...filteredSummary,
      repos: reposWithPredictions,
      baseConflictCount: baseConflictRepos.size,
      pullConflictCount: pullConflictRepos.size,
      statusCounts: filteredSummary.statusCounts.map(({ label, count }) => ({ label, count })),
    };
    if (options.verbose) {
      const reposWithVerbose = await Promise.all(
        reposWithPredictions.map(async (repo) => {
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
  reportTimeoutHint(filteredSummary.repos);
  reportWorkspaceHints(filteredSummary, wsDir);
}

function reportTimeoutHint(repos: RepoStatus[]): void {
  if (!hintsEnabled()) return;
  const count = repos.filter((r) => r.timedOut).length;
  if (count === 0) return;
  warn(`  hint: ${count} repo(s) timed out (ARB_GIT_TIMEOUT=${localTimeout()})`);
}

function reportWorkspaceHints(summary: WorkspaceSummary, wsDir: string): void {
  if (!hintsEnabled()) return;
  if (summary.repos.length === 0) return;

  const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;

  // Hint 1: base branch was merged
  const baseMergedRepos = summary.repos.filter((r) => r.base?.baseMergedIntoDefault != null);
  if (baseMergedRepos.length > 0) {
    const baseName = baseMergedRepos[0]?.base?.configuredRef ?? baseMergedRepos[0]?.base?.ref ?? "base";
    warn(`  hint: base branch ${baseName} was merged — run 'arb retarget' to rebase onto the default branch`);
    return; // Don't stack multiple hints
  }

  // Hint 2: configured base branch not found
  const baseMissingRepos = summary.repos.filter(
    (r) => r.base?.configuredRef != null && r.base.baseMergedIntoDefault == null,
  );
  if (baseMissingRepos.length > 0 && configBase) {
    warn(
      `  hint: configured base branch '${configBase}' not found — run 'arb branch base --unset' to track the default, or 'arb branch base <branch>' to set a new base`,
    );
  }
}

async function predictConflicts(
  repos: RepoStatus[],
  wsDir: string,
): Promise<{ baseConflictRepos: Set<string>; pullConflictRepos: Set<string> }> {
  const baseConflictRepos = new Set<string>();
  const pullConflictRepos = new Set<string>();
  await Promise.all([
    Promise.all(
      repos
        .filter((r) => r.base !== null && r.base.ahead > 0 && r.base.behind > 0)
        .map(async (r) => {
          const base = r.base;
          if (!base) return;
          const prediction = await predictMergeConflict(`${wsDir}/${r.name}`, baseRef(base));
          if (prediction?.hasConflict) baseConflictRepos.add(r.name);
        }),
    ),
    Promise.all(
      repos
        .filter((r) => (r.share.toPush ?? 0) > 0 && (r.share.toPull ?? 0) > 0 && r.share.ref !== null)
        .map(async (r) => {
          const trackingRef = r.share.ref;
          if (!trackingRef) return;
          const prediction = await predictMergeConflict(`${wsDir}/${r.name}`, trackingRef);
          if (prediction?.hasConflict) pullConflictRepos.add(r.name);
        }),
    ),
  ]);
  return { baseConflictRepos, pullConflictRepos };
}

async function renderStatusTable(
  filteredSummary: WorkspaceSummary,
  wsDir: string,
  options: { verbose?: boolean; maxLines?: number },
): Promise<string> {
  const repos = filteredSummary.repos;

  if (repos.length === 0) {
    return "  (no repos)\n";
  }

  const conflictPredictionsPromise = predictConflicts(repos, wsDir);

  // Gather verbose detail in parallel (when verbose mode is on)
  let verboseData: Map<string, VerboseDetail | undefined> | undefined;
  let baseConflictRepos: Set<string>;
  let pullConflictRepos: Set<string>;
  if (options.verbose) {
    const verbosePromise = Promise.all(
      repos.map(async (repo) => {
        const detail = await gatherVerboseDetail(repo, wsDir);
        return [repo.name, detail] as const;
      }),
    );
    const [conflicts, verboseEntries] = await Promise.all([conflictPredictionsPromise, verbosePromise]);
    baseConflictRepos = conflicts.baseConflictRepos;
    pullConflictRepos = conflicts.pullConflictRepos;
    verboseData = new Map(verboseEntries);
  } else {
    const conflicts = await conflictPredictionsPromise;
    baseConflictRepos = conflicts.baseConflictRepos;
    pullConflictRepos = conflicts.pullConflictRepos;
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
  const { nodes, showBaseRef, showShareRef } = buildStatusView(filteredSummary, {
    expectedBranch: filteredSummary.branch,
    baseConflictRepos,
    pullConflictRepos,
    currentRepo,
    verboseData,
  });

  // Operation banner (prepended before everything else)
  const record = readOperationRecord(wsDir);
  if (record?.status === "in-progress") {
    const repoEntries = Object.values(record.repos);
    const completed = repoEntries.filter((r) => r.status === "completed").length;
    const conflicting = repoEntries.filter((r) => r.status === "conflicting").length;
    const commandLabel = record.command === "branch-rename" ? "arb branch rename" : `arb ${record.command}`;

    const counts: string[] = [];
    if (completed > 0) counts.push(`${completed} completed`);
    if (conflicting > 0) counts.push(`${conflicting} conflicting`);
    const countStr = counts.length > 0 ? ` (${counts.join(", ")})` : "";

    nodes.unshift(
      {
        kind: "message",
        level: "attention",
        text: `${record.command} in progress${countStr} — use '${commandLabel} --continue' to resume or '${commandLabel} --abort' to cancel`,
      },
      { kind: "gap" },
    );
  }

  // Prepend header with ref parenthetical when ref columns are hidden
  const renderCtx = createRenderContext();
  const paren = buildRefParenthetical(filteredSummary, showBaseRef, showShareRef);
  if (paren) {
    const headerCell = spans(
      { text: filteredSummary.workspace, attention: "default" },
      { text: ` (${paren})`, attention: "muted" },
    );
    nodes.unshift({ kind: "rawText", text: `${renderCell(headerCell, renderCtx)}\n` }, { kind: "gap" });
  }

  const fittedNodes = options.maxLines != null ? fitToHeight(nodes, options.maxLines) : nodes;
  return render(fittedNodes, renderCtx);
}
