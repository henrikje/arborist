import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { z } from "zod";
import { ArbError, type RelativeTimeParts, arbAction, formatRelativeTimeParts, readWorkspaceConfig } from "../lib/core";
import type { ArbContext } from "../lib/core";
import type { GitCache } from "../lib/git";
import { printSchema } from "../lib/json";
import { type ListJsonEntry, ListJsonEntrySchema } from "../lib/json";
import { createRenderContext, render, runPhasedRender } from "../lib/render";
import type { Cell, OutputNode } from "../lib/render";
import { EMPTY_CELL, cell } from "../lib/render";
import { buildStatusCountsCell } from "../lib/render";
import {
  type AgeFilter,
  type AnalysisCache,
  type WorkspaceSummary,
  gatherWorkspaceSummary,
  matchesAge,
  resolveAgeFilter,
  resolveWhereFilter,
  workspaceMatchesWhere,
} from "../lib/status";
import {
  type FetchResult,
  type FetchTimestamps,
  allReposFresh,
  fetchSuffix,
  fetchTtl,
  loadFetchTimestamps,
  parallelFetch,
  recordFetchResults,
  reportFetchFailures,
  saveFetchTimestamps,
} from "../lib/sync";
import {
  analyzeProgress,
  clearScanProgress,
  dim,
  error,
  info,
  isTTY,
  listenForAbortKeypress,
  scanProgress,
} from "../lib/terminal";
import { listWorkspaces, workspaceBranch, workspaceRepoDirs } from "../lib/workspace";

interface ListRow {
  name: string;
  marker: boolean;
  branch: string;
  base: string;
  baseCell: Cell;
  repos: string;
  statusCell: Cell;
  lastCommit: string | null;
  lastActivity: string | null;
  special: "config-missing" | "empty" | null;
}

interface ListMetadata {
  rows: ListRow[];
  toScan: { index: number; wsDir: string }[];
}

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .summary("List all workspaces")
    .description(
      "List all workspaces in the project with aggregate status. Shows branch, base, repo count, last commit date, and status for each workspace. The last commit date is the most recent author date across all repos, shown as relative time (e.g. '3 days ago'). The active workspace (the one you're currently inside) is marked with *.\n\nUse --dirty / -d to show only workspaces with dirty repos, or --where <filter> to filter by status flags (any workspace with at least one matching repo is shown). See 'arb help where' for filter syntax. Use --no-status to skip per-repo status gathering for faster output.\n\nFetches workspace repos by default for fresh remote data (skip with -N/--no-fetch). Press Escape during the fetch to cancel and use stale data. Quiet mode (-q) skips fetching by default for scripting speed.\n\nUse --json for machine-readable output. See 'arb help scripting' for output modes and piping.",
    )
    .option("--fetch", "Fetch workspace repos before listing (default)")
    .option("-N, --no-fetch", "Skip fetching")
    .option("--no-status", "Skip per-repo status (faster for large setups)")
    .option("-d, --dirty", "Only list dirty workspaces (shorthand for --where dirty)")
    .option("-w, --where <filter>", "Filter workspaces by repo status flags (comma = OR, + = AND, ^ = negate)")
    .option("--older-than <duration>", "Only list workspaces not touched in the given duration (e.g. 30d, 2w, 3m, 1y)")
    .option("--newer-than <duration>", "Only list workspaces touched within the given duration (e.g. 7d, 2w)")
    .option("-q, --quiet", "Output one workspace name per line")
    .option("--json", "Output structured JSON")
    .option("--schema", "Print JSON Schema for this command's --json output and exit")
    .action(async (options, command) => {
      if (options.schema) {
        if (options.json || options.quiet) {
          error("Cannot combine --schema with --json or --quiet.");
          throw new ArbError("Cannot combine --schema with --json or --quiet.");
        }
        printSchema(z.array(ListJsonEntrySchema));
        return;
      }
      await arbAction(async (ctx, options) => {
        const cache = ctx.cache;
        const aCache = ctx.analysisCache;
        {
          // Conflict checks
          if (options.quiet && options.json) {
            error("Cannot combine --quiet with --json.");
            throw new ArbError("Cannot combine --quiet with --json.");
          }

          const whereFilter = resolveWhereFilter(options);
          const ageFilter = resolveAgeFilter(options);
          if ((whereFilter || ageFilter) && options.status === false) {
            error(
              "Cannot combine --no-status with --where or --older-than/--newer-than. Status gathering is required.",
            );
            throw new ArbError("Cannot combine --no-status with filters that require status gathering.");
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

          const fetchTimestamps = loadFetchTimestamps(ctx.arbRootDir);
          const repoNames = workspaceRepoNames(metadata);
          const wantsFetch = options.fetch !== false && !options.quiet;
          const shouldFetch =
            wantsFetch && (options.fetch === true || !allReposFresh(repoNames, fetchTimestamps, fetchTtl()));

          // ── Quiet output path ──
          if (options.quiet) {
            if (options.fetch) await blockingFetchRepos(ctx, cache, repoNames, fetchTimestamps); // only if explicitly requested
            if (whereFilter || ageFilter) {
              const gatherActivityOpts = ageFilter
                ? { gatherActivity: true, analysisCache: aCache }
                : { analysisCache: aCache };
              const results = await Promise.all(
                metadata.toScan.map(async (entry) => {
                  try {
                    const summary = await gatherWorkspaceSummary(
                      entry.wsDir,
                      ctx.reposDir,
                      undefined,
                      cache,
                      gatherActivityOpts,
                    );
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
                if (!row) continue;
                if (whereFilter && !workspaceMatchesWhere(summary.repos, summary.branch, whereFilter)) continue;
                if (ageFilter && !matchesAge(summary.lastActivity, ageFilter)) continue;
                process.stdout.write(`${row.name}\n`);
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
            if (shouldFetch) await blockingFetchRepos(ctx, cache, repoNames, fetchTimestamps);

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

            const gatherActivityOptsJson = ageFilter
              ? { gatherActivity: true, analysisCache: aCache }
              : { analysisCache: aCache };
            const results = await Promise.all(
              metadata.toScan.map(async (entry) => {
                try {
                  const summary = await gatherWorkspaceSummary(
                    entry.wsDir,
                    ctx.reposDir,
                    undefined,
                    cache,
                    gatherActivityOptsJson,
                  );
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
                entry.statusCounts = summary.statusCounts.map(({ label, count }) => ({ label, count }));
                entry.lastCommit = summary.lastCommit;
                if (summary.lastActivity) entry.lastActivity = summary.lastActivity;
                if (summary.lastActivityFile) entry.lastActivityFile = summary.lastActivityFile;
              }
            }

            let filtered = jsonEntries;
            if (whereFilter || ageFilter) {
              filtered = jsonEntries.filter((_entry, i) => {
                const summary = summaryMap.get(i);
                if (!summary) return false;
                if (whereFilter && !workspaceMatchesWhere(summary.repos, summary.branch, whereFilter)) return false;
                if (ageFilter && !matchesAge(summary.lastActivity, ageFilter)) return false;
                return true;
              });
            }

            process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
            return;
          }

          // ── Table output path ──

          if (!showStatus) {
            if (shouldFetch) await blockingFetchRepos(ctx, cache, repoNames, fetchTimestamps);
            process.stdout.write(formatListTable(metadata.rows, false));
            return;
          }

          const tty = isTTY();
          const hasFilter = !!(whereFilter || ageFilter);
          const canPhase = tty && metadata.toScan.length > 0 && !hasFilter;

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
                    const total = metadata.toScan.length;
                    let analyzed = 0;
                    const statusRows = await gatherListStatus(metadata, ctx, whereFilter, cache, {
                      analysisCache: aCache,
                      silent: true,
                      ageFilter,
                      onWorkspace: () => analyzeProgress(++analyzed, total),
                    });
                    clearScanProgress();
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
              recordFetchResults(fetchTimestamps, state.fetchResults as Map<string, FetchResult>);
              saveFetchTimestamps(ctx.arbRootDir, fetchTimestamps);
            }
          } else if (canPhase) {
            // 2-phase: placeholder + scanning → fresh
            const total = metadata.toScan.length;
            let analyzed = 0;
            await runPhasedRender([
              { render: () => formatListTable(metadata.rows, true) + dim("Scanning...") },
              {
                render: async () => {
                  const statusRows = await gatherListStatus(metadata, ctx, whereFilter, cache, {
                    analysisCache: aCache,
                    silent: true,
                    ageFilter,
                    onWorkspace: () => analyzeProgress(++analyzed, total),
                  });
                  clearScanProgress();
                  return formatListTable(statusRows, true);
                },
                write: (o) => process.stdout.write(o),
              },
            ]);
          } else if (hasFilter && metadata.toScan.length > 0) {
            if (shouldFetch) await blockingFetchRepos(ctx, cache, repoNames, fetchTimestamps);
            // Workspace-level progress, suppress repo-level scanProgress
            const total = metadata.toScan.length;
            let analyzed = 0;
            const statusRows = await gatherListStatus(metadata, ctx, whereFilter, cache, {
              analysisCache: aCache,
              silent: true,
              ageFilter,
              onWorkspace: () => analyzeProgress(++analyzed, total),
            });
            clearScanProgress(); // clear the "Analyzing workspaces N/N" line
            process.stdout.write(formatListTable(statusRows, true));
          } else {
            // Non-phased (non-TTY or nothing to scan)
            if (shouldFetch) await blockingFetchRepos(ctx, cache, repoNames, fetchTimestamps);
            const statusRows = await gatherListStatus(metadata, ctx, whereFilter, cache, {
              analysisCache: aCache,
              ageFilter,
            });
            process.stdout.write(formatListTable(statusRows, true));
          }
        }
      })(options, command);
    });
}

// ── Metadata gathering ──

async function gatherListMetadata(ctx: ArbContext, workspaces: string[]): Promise<ListMetadata> {
  const rows: ListRow[] = [];
  const toScan: { index: number; wsDir: string }[] = [];

  for (const name of workspaces) {
    const wsDir = `${ctx.arbRootDir}/${name}`;
    const marker = name === ctx.currentWorkspace;

    const configMissing = !existsSync(`${wsDir}/.arbws/config.json`) && !existsSync(`${wsDir}/.arbws/config`);

    if (configMissing) {
      rows.push({
        name,
        marker,
        branch: "",
        base: "",
        baseCell: EMPTY_CELL,
        repos: "",
        statusCell: cell("(config missing)", "attention"),
        lastCommit: null,
        lastActivity: null,
        special: "config-missing",
      });
      continue;
    }

    const repoDirs = workspaceRepoDirs(wsDir);
    const wb = await workspaceBranch(wsDir);
    const branch = wb?.branch ?? name.toLowerCase();
    const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;
    const base = configBase ?? "";

    if (repoDirs.length === 0) {
      rows.push({
        name,
        marker,
        branch,
        base,
        baseCell: cell(base),
        repos: "0",
        statusCell: cell("(empty)", "attention"),
        lastCommit: null,
        lastActivity: null,
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
      repos: `${repoDirs.length}`,
      statusCell: cell("...", "muted"),
      lastCommit: null,
      lastActivity: null,
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
  options?: { silent?: boolean; ageFilter?: AgeFilter; onWorkspace?: () => void; analysisCache?: AnalysisCache },
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

  const gatherActivityOpts = options?.ageFilter
    ? { gatherActivity: true, analysisCache: options?.analysisCache }
    : { analysisCache: options?.analysisCache };

  const results = await Promise.all(
    metadata.toScan.map(async (entry) => {
      try {
        const summary = await gatherWorkspaceSummary(
          entry.wsDir,
          ctx.reposDir,
          progressCallback,
          cache,
          gatherActivityOpts,
        );
        options?.onWorkspace?.();
        return { index: entry.index, summary };
      } catch {
        options?.onWorkspace?.();
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

  const ageFilter = options?.ageFilter;
  if (whereFilter || ageFilter) {
    return rows.filter((_, i) => {
      const summary = summaryByIndex.get(i);
      if (!summary) return false;
      if (whereFilter && !workspaceMatchesWhere(summary.repos, summary.branch, whereFilter)) return false;
      if (ageFilter && !matchesAge(summary.lastActivity, ageFilter)) return false;
      return true;
    });
  }

  return rows;
}

// ── Rendering ──

function timeColumnDate(row: ListRow): string | null {
  return row.lastActivity ?? row.lastCommit;
}

function timeColumnParts(row: ListRow): RelativeTimeParts {
  const date = timeColumnDate(row);
  if (!date) return { num: "", unit: "" };
  return formatRelativeTimeParts(date);
}

export function buildListTableNodes(displayRows: ListRow[], showStatus: boolean): OutputNode[] {
  // Compute max number width for right-aligning within the time column
  let maxNumWidth = 0;
  if (showStatus) {
    for (const row of displayRows) {
      const parts = timeColumnParts(row);
      if (parts.num.length > maxNumWidth) maxNumWidth = parts.num.length;
    }
  }

  // Use "LAST ACTIVITY" header when any row has activity data
  const hasActivity = displayRows.some((row) => row.lastActivity != null);
  const timeHeader = hasActivity ? "LAST ACTIVITY" : "LAST COMMIT";

  const columns = [
    { header: "WORKSPACE", key: "workspace" },
    { header: "BRANCH", key: "branch" },
    { header: "BASE", key: "base", show: "auto" as const },
    { header: "REPOS", key: "repos" },
    ...(showStatus
      ? [
          { header: timeHeader, key: "lastCommit" },
          { header: "STATUS", key: "status" },
        ]
      : []),
  ];

  const rows = displayRows.map((row) => {
    const parts = timeColumnParts(row);
    let lastCommitCell: Cell;
    if (parts.num && parts.unit) {
      lastCommitCell = cell(`${parts.num.padStart(maxNumWidth)} ${parts.unit}`);
    } else if (parts.unit) {
      lastCommitCell = cell(parts.unit);
    } else if (row.special === null) {
      lastCommitCell = cell("...", "muted");
    } else {
      lastCommitCell = EMPTY_CELL;
    }

    return {
      cells: {
        workspace: cell(row.name),
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
  const ctx = createRenderContext();
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

async function blockingFetchRepos(
  ctx: ArbContext,
  cache: GitCache,
  repoNames: string[],
  fetchTimestamps?: FetchTimestamps,
): Promise<void> {
  if (repoNames.length === 0) return;
  const fetchDirs = repoNames.map((r) => `${ctx.reposDir}/${r}`);
  const remotesMap = await cache.resolveRemotesMap(repoNames, ctx.reposDir);
  const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
  reportFetchFailures(repoNames, fetchResults);
  cache.invalidateAfterFetch();
  if (fetchTimestamps) {
    recordFetchResults(fetchTimestamps, fetchResults);
    saveFetchTimestamps(ctx.arbRootDir, fetchTimestamps);
  }
}

function applySummaryToRow(row: ListRow, summary: WorkspaceSummary): void {
  row.base = summary.base ?? "";
  row.baseCell = cell(row.base);
  if (summary.statusCounts.length === 0) {
    row.statusCell = cell("no issues");
  } else {
    row.statusCell = buildStatusCountsCell(summary.statusCounts, summary.outdatedOnlyCount);
  }
  row.lastCommit = summary.lastCommit;
  row.lastActivity = summary.lastActivity;
  const baseMissing = summary.repos.some((r) => r.base?.configuredRef != null && r.base?.baseMergedIntoDefault == null);
  if (baseMissing) {
    row.baseCell = cell(row.base, "attention");
  }
}
