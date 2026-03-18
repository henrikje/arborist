import { basename, dirname, resolve } from "node:path";
import type { Command } from "commander";
import { predictMergeConflict } from "../lib/analysis";
import { ArbError, type CommandContext, arbAction } from "../lib/core";
import { gitLocal, localTimeout } from "../lib/git/git";
import { printSchema } from "../lib/json";
import { type StatusJsonOutput, StatusJsonOutputSchema } from "../lib/json";
import { createRenderContext, fitToHeight, render, runPhasedRender } from "../lib/render";
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
import { type FetchResult, fetchSuffix, getUnchangedRepos, parallelFetch, reportFetchFailures } from "../lib/sync";
import {
  type WatchEntry,
  bold,
  clearScanProgress,
  dim,
  error,
  isTTY,
  listenForAbortSignal,
  runWatchLoop,
  scanProgress,
  stderr,
  warn,
} from "../lib/terminal";
import {
  readGitdirFromWorktree,
  requireWorkspace,
  resolveReposFromArgsOrStdin,
  workspaceRepoDirs,
} from "../lib/workspace";

export function registerStatusCommand(program: Command): void {
  program
    .command("status [repos...]")
    .option("-d, --dirty", "Only show repos with local changes (shorthand for --where dirty)")
    .option("-w, --where <filter>", "Filter repos by status flags (comma = OR, + = AND, ^ = negate)")
    .option("--fetch", "Fetch from all remotes before showing status (default)")
    .option("-N, --no-fetch", "Skip fetching")
    .option("-v, --verbose", "Show file-level detail for each repo")
    .option("-q, --quiet", "Output one repo name per line")
    .option("--watch", "Continuously refresh status on filesystem changes")
    .option("--json", "Output structured JSON (combine with --verbose for commit and file detail)")
    .option("--schema", "Print JSON Schema for this command's --json output and exit")
    .summary("Show workspace status")
    .description(
      "Show each repo's position relative to the base branch, push status against the share remote, and local changes (staged, modified, untracked). The summary includes the workspace's last commit date (most recent author date across all repos).\n\nRepos are positional arguments — name specific repos to filter, or omit to show all. Reads repo names from stdin when piped (one per line), enabling composition like: arb status -q --where dirty | arb diff.\n\nUse --dirty to only show repos with uncommitted changes. Use --where <filter> to filter by status flags. See 'arb help where' for filter syntax. Fetches from all remotes by default for fresh data (skip with -N/--no-fetch). Press Ctrl+C during the fetch to cancel and use stale data. Quiet mode (-q) skips fetching by default for scripting speed. Use --verbose for file-level detail. Use --json for machine-readable output. Combine --json --verbose to include commit lists and file-level detail in JSON output.\n\nUse --watch to enter a live dashboard that auto-refreshes on filesystem changes. Useful in a split terminal while AI agents work. Press f to fetch remote state on demand, q or Escape to quit. Combines with --verbose, --dirty, --where, and [repos...] filtering.\n\nMerged branches show the detected PR number when available (e.g. 'merged (#123), gone'), extracted from merge or squash commit subjects. JSON output includes detectedPr fields.\n\nSee 'arb help stacked' for stacked workspace status flags. See 'arb help scripting' for output modes and piping.",
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
    watch?: boolean;
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
  if (options.watch && options.json) {
    error("Cannot combine --watch with --json.");
    throw new ArbError("Cannot combine --watch with --json.");
  }
  if (options.watch && options.quiet) {
    error("Cannot combine --watch with --quiet.");
    throw new ArbError("Cannot combine --watch with --quiet.");
  }
  if (options.watch && options.fetch === true) {
    error("Cannot combine --watch with --fetch. Press f during watch mode to fetch on demand.");
    throw new ArbError("Cannot combine --watch with --fetch.");
  }
  if (options.watch && (!isTTY() || !process.stdin.isTTY)) {
    error("--watch requires a terminal (TTY). Watch mode cannot run in pipes or non-interactive sessions.");
    throw new ArbError("--watch requires a terminal.");
  }

  // Resolve repo selection: positional args > stdin > all
  const selectedRepos = await resolveReposFromArgsOrStdin(wsDir, repoArgs);
  const selectedSet = new Set(selectedRepos);

  // Shared gather helper: scan + filter.
  // When previousResults is provided, repos in that map are reused instead of re-scanned.
  // showProgress controls whether scan progress is written to stderr (disabled in watch mode
  // to avoid flickering on the alternate screen).
  const gatherFiltered = async (
    previousResults?: Map<string, RepoStatus>,
    showProgress = true,
  ): Promise<WorkspaceSummary> => {
    const summary = await gatherWorkspaceSummary(
      wsDir,
      ctx.reposDir,
      showProgress
        ? (scanned, total) => {
            scanProgress(scanned, total);
          }
        : undefined,
      cache,
      { previousResults, analysisCache: aCache },
    );
    if (showProgress) clearScanProgress();

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

  // Watch mode: live dashboard with filesystem watching
  if (options.watch) {
    await runWatchMode(ctx, wsDir, selectedRepos, gatherFiltered, {
      verbose: options.verbose,
    });
    return;
  }

  // Phased rendering: show stale table immediately, refresh after fetch
  const wantsFetch = options.fetch !== false && !options.quiet;
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
      finalRepos?: RepoStatus[];
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
              state.finalRepos = data.repos;
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
    if (state.finalRepos) reportTimeoutHint(state.finalRepos);
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
}

function reportTimeoutHint(repos: RepoStatus[]): void {
  const count = repos.filter((r) => r.timedOut).length;
  if (count === 0) return;
  warn(`  hint: ${count} repo(s) timed out (ARB_GIT_TIMEOUT=${localTimeout()})`);
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
  const nodes = buildStatusView(filteredSummary, {
    expectedBranch: filteredSummary.branch,
    baseConflictRepos,
    pullConflictRepos,
    currentRepo,
    verboseData,
  });

  // Fit to terminal height when maxLines is specified (watch mode)
  const fittedNodes = options.maxLines != null ? fitToHeight(nodes, options.maxLines) : nodes;

  // Resolve render context
  const renderCtx = createRenderContext();

  return render(fittedNodes, renderCtx);
}

// --- Watch mode ---

/** Number of terminal lines the watch footer occupies (blank line + hint bar). */
const WATCH_FOOTER_LINES = 2;

/**
 * Build a footer hint bar in Inquirer style: bold key + dim action, dim bullet separators.
 */
function watchFooter(fetching: boolean): string {
  const bullet = dim(" \u2022 ");
  const fetchHint = fetching ? dim("Fetching...") : `${bold("f")} ${dim("fetch")}`;
  const quitHint = `${bold("q")} ${dim("quit")}`;
  return `\n  ${fetchHint}${bullet}${quitHint}\n`;
}

/**
 * Build a gitignore-aware filter for a worktree directory.
 * Runs `git ls-files --others --ignored --exclude-standard --directory` once at setup
 * and returns a function that checks if a filename starts with any ignored directory prefix.
 */
async function buildIgnoreFilter(repoDir: string): Promise<((filename: string) => boolean) | undefined> {
  const result = await gitLocal(repoDir, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory");
  if (result.exitCode !== 0) return undefined;

  const ignoredDirs = result.stdout
    .split("\n")
    .filter((line) => line.endsWith("/"))
    .map((line) => line.slice(0, -1)); // remove trailing slash for prefix matching

  if (ignoredDirs.length === 0) return undefined;

  return (filename: string): boolean => {
    for (const dir of ignoredDirs) {
      if (filename === dir || filename.startsWith(`${dir}/`)) return true;
    }
    return false;
  };
}

/**
 * Resolve the canonical .git/ directory for a linked worktree.
 * Reads the .git file to find the worktree entry dir, then goes two levels up
 * to reach the canonical .git/ directory.
 */
function resolveCanonicalGitDir(repoDir: string): string | null {
  const gitdirPath = readGitdirFromWorktree(repoDir);
  if (!gitdirPath) return null;
  // gitdirPath is like: .../arb/repos/<repo>/.git/worktrees/<name>
  // Go two levels up to get .../arb/repos/<repo>/.git/
  return dirname(dirname(gitdirPath));
}

async function runWatchMode(
  ctx: CommandContext,
  wsDir: string,
  selectedRepos: string[],
  gatherFiltered: (previousResults?: Map<string, RepoStatus>, showProgress?: boolean) => Promise<WorkspaceSummary>,
  options: { verbose?: boolean },
): Promise<void> {
  const cache = ctx.cache;
  let fetching = false;

  // Build watch entries: worktree dirs (with gitignore filter) + canonical .git/ dirs
  const watchEntries: WatchEntry[] = [];

  await Promise.all(
    selectedRepos.map(async (repoName) => {
      const repoDir = `${wsDir}/${repoName}`;

      // Watch worktree directory with gitignore filter
      const ignoreFilter = await buildIgnoreFilter(repoDir);
      watchEntries.push({
        path: repoDir,
        shouldIgnore: ignoreFilter,
      });

      // Watch canonical .git/ directory, ignoring transient lock files that git
      // creates during read operations (e.g. git status touches index.lock).
      const canonicalGitDir = resolveCanonicalGitDir(repoDir);
      if (canonicalGitDir) {
        watchEntries.push({
          path: canonicalGitDir,
          shouldIgnore: (filename) => filename.endsWith(".lock"),
        });
      }
    }),
  );

  const renderScreen = async (): Promise<string> => {
    const terminalHeight = process.stderr.rows ?? 24;
    const maxLines = terminalHeight - WATCH_FOOTER_LINES;
    const table = await renderStatusTable(await gatherFiltered(undefined, false), wsDir, {
      verbose: options.verbose,
      maxLines,
    });
    return table + watchFooter(fetching);
  };

  const fetchDirs = selectedRepos.map((name) => `${wsDir}/${name}`);

  await runWatchLoop({
    render: renderScreen,
    watchers: watchEntries,
    onFetch: async () => {
      fetching = true;
      try {
        const repoNames = selectedRepos;
        const remotesMap = await cache.resolveRemotesMap(repoNames, ctx.reposDir);
        await parallelFetch(fetchDirs, undefined, remotesMap, { silent: true });
        cache.invalidateAfterFetch();
      } finally {
        fetching = false;
      }
    },
  });
}
