import { basename, dirname, resolve } from "node:path";
import type { Command } from "commander";
import { predictMergeConflict } from "../lib/analysis";
import { ArbError, type CommandContext, arbAction } from "../lib/core";
import { gitLocal } from "../lib/git/git";
import { createRenderContext, fitToHeight, render } from "../lib/render";
import { buildStatusView } from "../lib/render";
import {
  type RepoStatus,
  type VerboseDetail,
  type WorkspaceSummary,
  baseRef,
  computeSummaryAggregates,
  gatherVerboseDetail,
  gatherWorkspaceSummary,
} from "../lib/status";
import { parallelFetch } from "../lib/sync";
import { integrate } from "../lib/sync";
import { type WatchCommand, type WatchEntry, bold, dim, error, isTTY, runWatchLoop } from "../lib/terminal";
import { readGitdirFromWorktree, requireWorkspace, workspaceRepoDirs } from "../lib/workspace";
import { runPull } from "./pull";
import { runPush } from "./push";

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .option("-v, --verbose", "Show file-level detail for each repo")
    .summary("Live workspace dashboard with sync commands")
    .description(
      "Examples:\n\n  arb watch                                Live dashboard for the workspace\n  arb watch --verbose                      Include file-level detail\n\nLaunches an interactive live dashboard that auto-refreshes on filesystem changes. The dashboard shows workspace status and provides keyboard shortcuts for common sync operations.\n\nKeys:\n  f  fetch all remotes\n  v  toggle verbose mode\n  r  rebase onto base branch\n  m  merge base branch\n  l  pull from share remote\n  p  push to share remote\n  q  quit (also Escape)\n\nSync commands (r, m, p, u) temporarily leave the dashboard to run the full interactive flow (fetch, plan, confirm, execute). After the command completes, press any key to return to the dashboard.\n\nRequires a terminal (TTY). Use --verbose for file-level detail in the status display.",
    )
    .action(
      arbAction(async (ctx, options) => {
        if (!isTTY() || !process.stdin.isTTY) {
          error("arb watch requires a terminal (TTY). Watch mode cannot run in pipes or non-interactive sessions.");
          throw new ArbError("arb watch requires a terminal.");
        }

        const { wsDir } = requireWorkspace(ctx);
        const allRepos = workspaceRepoDirs(wsDir).map((d) => basename(d));

        await runWatch(ctx, wsDir, allRepos, { verbose: options.verbose });
      }),
    );
}

/** Number of terminal lines the watch header occupies (header + blank line). */
const WATCH_HEADER_LINES = 2;
/** Number of terminal lines the watch footer occupies (blank line + hint bar). */
const WATCH_FOOTER_LINES = 2;

function watchHeader(project: string, workspace: string, command?: string, lastChanged?: string): string {
  const commandPart = command ? ` ${dim("\u2022")} ${command}` : "";
  const debugPart = lastChanged ? ` ${dim(`[last changed: ${lastChanged}]`)}` : "";
  return `  ${bold(project)} ${dim("\u2022")} ${workspace}${commandPart}${debugPart}\n`;
}

/** Number of extra terminal lines the debug footer occupies (blank line + event line). */
const WATCH_DEBUG_LINES = 2;

function watchDebugFooter(event: { timestamp: string; detail: string } | null): string {
  if (!event) return `\n  ${dim("[debug] no events yet")}\n`;
  return `\n  ${dim(`[debug] ${event.detail}`)}\n`;
}

function watchFooter(verbose: boolean, commands: Map<string, WatchCommand>): string {
  const bullet = dim(" \u2022 ");
  const hints: string[] = [];
  hints.push(`${bold("f")} ${dim("fetch")}`);
  hints.push(`${bold("v")} ${dim(verbose ? "compact" : "verbose")}`);
  for (const [key, cmd] of commands) {
    hints.push(`${bold(key)} ${dim(cmd.label)}`);
  }
  hints.push(`${bold("q")} ${dim("quit")}`);
  return `\n  ${hints.join(bullet)}\n`;
}

async function buildIgnoreFilter(repoDir: string): Promise<((filename: string) => boolean) | undefined> {
  const result = await gitLocal(repoDir, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory");
  if (result.exitCode !== 0) return undefined;

  const ignoredDirs = result.stdout
    .split("\n")
    .filter((line) => line.endsWith("/"))
    .map((line) => line.slice(0, -1));

  if (ignoredDirs.length === 0) return undefined;

  return (filename: string): boolean => {
    for (const dir of ignoredDirs) {
      if (filename === dir || filename.startsWith(`${dir}/`)) return true;
    }
    return false;
  };
}

/**
 * Build a shouldIgnore filter for the canonical .git/ directory watcher.
 * Uses a whitelist: only ref changes, packed-refs, and this worktree's own
 * entry dir pass through. Everything else (objects/, logs/, other worktrees)
 * is ignored to avoid cross-workspace noise.
 */
export function buildCanonicalGitDirFilter(worktreeEntryName: string): (filename: string) => boolean {
  const worktreeEntry = `worktrees/${worktreeEntryName}/`;
  return (filename: string): boolean => {
    if (filename.endsWith(".lock")) return true;
    // Ref changes (branch updates, fetch results)
    if (filename.startsWith("refs/")) return false;
    if (filename === "packed-refs") return false;
    // This worktree's state (HEAD, index, rebase/merge state)
    if (filename.startsWith(worktreeEntry)) return false;
    // Ignore everything else (objects/, logs/, etc.) — these are noisy
    // and shared across all worktrees, causing cross-workspace chatter.
    return true;
  };
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

  const cwd = resolve(process.cwd());
  let currentRepo: string | null = null;
  for (const repo of repos) {
    const repoDir = resolve(`${wsDir}/${repo.name}`);
    if (cwd === repoDir || cwd.startsWith(`${repoDir}/`)) {
      currentRepo = repo.name;
      break;
    }
  }

  const { nodes } = buildStatusView(filteredSummary, {
    expectedBranch: filteredSummary.branch,
    baseConflictRepos,
    pullConflictRepos,
    currentRepo,
    verboseData,
  });

  const fittedNodes = options.maxLines != null ? fitToHeight(nodes, options.maxLines) : nodes;
  const renderCtx = createRenderContext();
  return render(fittedNodes, renderCtx);
}

async function runWatch(
  ctx: CommandContext,
  wsDir: string,
  selectedRepos: string[],
  options: { verbose?: boolean },
): Promise<void> {
  const cache = ctx.cache;
  let activity: string | null = null;
  let debugMode = false;
  let lastEvent: { timestamp: string; detail: string } | null = null;

  const recordEvent = (detail: string): void => {
    lastEvent = { timestamp: new Date().toISOString(), detail };
  };

  const gatherFiltered = async (): Promise<WorkspaceSummary> => {
    const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache, {
      analysisCache: ctx.analysisCache,
    });
    const aggregates = computeSummaryAggregates(summary.repos, summary.branch);
    return { ...summary, ...aggregates };
  };

  // Build watch entries: worktree dirs (with gitignore filter) + canonical .git/ dirs
  const watchEntries: WatchEntry[] = [];

  await Promise.all(
    selectedRepos.map(async (repoName) => {
      const repoDir = `${wsDir}/${repoName}`;

      const ignoreFilter = await buildIgnoreFilter(repoDir);
      watchEntries.push({
        path: repoDir,
        shouldIgnore: ignoreFilter,
      });

      const gitdirPath = readGitdirFromWorktree(repoDir);
      if (gitdirPath) {
        const canonicalGitDir = dirname(dirname(gitdirPath));
        watchEntries.push({
          path: canonicalGitDir,
          shouldIgnore: buildCanonicalGitDirFilter(basename(gitdirPath)),
        });
      }
    }),
  );

  const commands = new Map<string, WatchCommand>([
    ["r", { label: "rebase", run: () => integrate(ctx, "rebase", {}, selectedRepos) }],
    ["m", { label: "merge", run: () => integrate(ctx, "merge", {}, selectedRepos) }],
    ["l", { label: "pull", run: () => runPull(ctx, selectedRepos, {}) }],
    ["p", { label: "push", run: () => runPush(ctx, selectedRepos, {}) }],
  ]);

  const project = basename(ctx.arbRootDir);
  const workspace = ctx.currentWorkspace ?? basename(wsDir);
  let verbose = options.verbose ?? false;

  const statusLabel = (): string => (verbose ? "status --verbose" : "status");

  const formatHeader = (label: string): string => {
    const debugTimestamp = debugMode ? lastEvent?.timestamp : undefined;
    return watchHeader(project, workspace, label, debugTimestamp);
  };

  const renderScreen = async (): Promise<string> => {
    const terminalHeight = process.stderr.rows ?? 24;
    const debugLines = debugMode ? WATCH_DEBUG_LINES : 0;
    const maxLines = Math.max(1, terminalHeight - WATCH_HEADER_LINES - WATCH_FOOTER_LINES - debugLines);
    const debugTimestamp = debugMode ? lastEvent?.timestamp : undefined;
    const header = watchHeader(project, workspace, activity ?? statusLabel(), debugTimestamp);
    const table = await renderStatusTable(await gatherFiltered(), wsDir, {
      verbose,
      maxLines,
    });
    const footer = watchFooter(verbose, commands);
    const debugSection = debugMode ? watchDebugFooter(lastEvent) : "";
    return `${header}\n${table}${footer}${debugSection}`;
  };

  const fetchDirs = selectedRepos.map((name) => `${wsDir}/${name}`);

  await runWatchLoop({
    render: renderScreen,
    watchers: watchEntries,
    commands,
    onKey: (key) => {
      if (key === "v") {
        verbose = !verbose;
        recordEvent("key: v (verbose toggle)");
        return true;
      }
      if (key === "D") {
        debugMode = !debugMode;
        return true;
      }
      return false;
    },
    onFsEvent: (_event, fullPath) => {
      recordEvent(`fs ${_event}: ${fullPath}`);
    },
    suspendHeader: formatHeader,
    activityHeader: formatHeader,
    onFetch: async () => {
      activity = "Fetching...";
      recordEvent("key: f (fetch)");
      try {
        const remotesMap = await cache.resolveRemotesMap(selectedRepos, ctx.reposDir);
        await parallelFetch(fetchDirs, undefined, remotesMap, { silent: true });
        cache.invalidateAfterFetch();
      } finally {
        activity = null;
      }
    },
    onPostCommand: () => cache.invalidateAfterFetch(),
  });
}
