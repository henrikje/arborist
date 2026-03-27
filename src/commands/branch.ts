import { basename } from "node:path";
import { type Command, Option } from "commander";
import { ArbError, arbAction, readWorkspaceConfig, writeWorkspaceConfig } from "../lib/core";
import type { ArbContext } from "../lib/core";
import { GitCache, branchNameError } from "../lib/git";
import { printSchema } from "../lib/json";
import { type BranchJsonOutput, BranchJsonOutputSchema, type BranchJsonRepo } from "../lib/json";
import { type RenderContext, render } from "../lib/render";
import { cell, suffix } from "../lib/render";
import type { OutputNode } from "../lib/render";
import { runPhasedRender } from "../lib/render";
import {
  type RepoRefs,
  computeFlags,
  gatherRepoRefs,
  gatherWorkspaceSummary,
  baseRef as statusBaseRef,
} from "../lib/status";
import { type FetchResult, fetchSuffix, parallelFetch, reportFetchFailures, resolveDefaultFetch } from "../lib/sync";
import { error, info, isTTY, listenForAbortSignal, shouldColor, stderr } from "../lib/terminal";
import {
  rejectExplicitBaseRemotePrefix,
  requireWorkspace,
  resolveWorkspaceBaseResolution,
  workspaceBranch,
  workspaceRepoDirs,
} from "../lib/workspace";
import { registerBranchRenameSubcommand } from "./branch-rename";

interface RepoBranch {
  name: string;
  branch: string | null;
}

interface VerboseRow {
  name: string;
  branch: string;
  base: string;
  share: string;
  branchNoteworthy: boolean;
}

function deriveWorkspaceSummary(repos: RepoRefs[]): { resolvedBase: string | null; share: string } {
  const first = repos[0];

  // Base: format as remote/ref (or bare branch for local-primary)
  let resolvedBase: string | null = null;
  if (first?.base) {
    resolvedBase = statusBaseRef(first.base);
  }

  // Share: derive from first repo's share state
  let share = "(unknown)";
  if (first) {
    switch (first.share.refMode) {
      case "configured":
      case "implicit":
        share = first.share.ref ?? "(unknown)";
        break;
      case "noRef":
        share = "(not pushed)";
        break;
      case "gone":
        share = "(gone)";
        break;
    }
  }

  return { resolvedBase, share };
}

function buildBranchSummaryNodes(
  branch: string,
  resolvedBase: string | null,
  isDefaultBase: boolean,
  share: string,
  repos: RepoBranch[],
): OutputNode[] {
  const baseCell = resolvedBase ? suffix(cell(resolvedBase), " (default)", "muted") : cell("(unknown)", "muted");
  const nodes: OutputNode[] = [
    {
      kind: "table",
      columns: [
        { header: "BRANCH", key: "branch" },
        { header: "BASE", key: "base" },
        { header: "SHARE", key: "share" },
      ],
      rows: [
        {
          cells: {
            branch: cell(branch),
            base: isDefaultBase ? baseCell : cell(resolvedBase ?? "(unknown)", "default"),
            share: cell(share, share.startsWith("(") ? "muted" : "default"),
          },
        },
      ],
    },
  ];

  // Per-repo deviations
  const deviations = repos.filter((r) => r.branch !== branch);
  if (deviations.length > 0) {
    nodes.push(
      { kind: "gap" },
      {
        kind: "section",
        header: cell("Repos on a different branch:", "attention"),
        items: deviations.map((r) => {
          const label = r.branch === null ? "(detached)" : r.branch;
          return cell(`${r.name}    ${label}`);
        }),
      },
    );
  }

  return nodes;
}

function buildVerboseNodes(
  repos: RepoRefs[],
  branch: string,
  base: string | null,
  resolvedBase: string | null,
  share: string,
): OutputNode[] {
  const isDefaultBase = !base;
  const baseCell = resolvedBase ? suffix(cell(resolvedBase), " (default)", "muted") : cell("(unknown)", "muted");
  const nodes: OutputNode[] = [
    {
      kind: "table",
      columns: [
        { header: "BRANCH", key: "branch" },
        { header: "BASE", key: "base" },
        { header: "SHARE", key: "share" },
      ],
      rows: [
        {
          cells: {
            branch: cell(branch),
            base: isDefaultBase ? baseCell : cell(resolvedBase ?? "(unknown)", "default"),
            share: cell(share, share.startsWith("(") ? "muted" : "default"),
          },
        },
      ],
    },
    { kind: "gap" },
  ];

  // Per-repo table
  const verboseRows = buildVerboseRows(repos, branch);
  nodes.push({
    kind: "table",
    columns: [
      { header: "REPO", key: "repo" },
      { header: "BRANCH", key: "branch" },
      { header: "BASE", key: "base" },
      { header: "SHARE", key: "share" },
    ],
    rows: verboseRows.map((row) => ({
      cells: {
        repo: cell(row.name),
        branch: cell(row.branch, row.branchNoteworthy ? "attention" : "default"),
        base: cell(row.base),
        share: cell(row.share),
      },
    })),
  });

  return nodes;
}

export function registerBranchCommand(program: Command): void {
  const branch = program
    .command("branch")
    .summary("Show workspace branch, base, and remote tracking")
    .description(
      "Examples:\n\n  arb branch                               Show workspace branch (default)\n  arb branch show -v                       Per-repo tracking detail\n  arb branch base main                     Set base branch\n\nInspect or manage the workspace branch. When invoked without a subcommand, defaults to 'show'.\n\nUse 'arb branch base' to view, change, or remove the base branch that rebase, merge, and status operate against. To change the base and rebase in one step, use 'arb retarget <branch>'.",
    );

  branch
    .command("show", { isDefault: true })
    .addOption(new Option("-q, --quiet", "Output just the branch name").conflicts(["json", "verbose"]))
    .addOption(new Option("-v, --verbose", "Show per-repo branch and remote tracking detail").conflicts("quiet"))
    .option("--fetch", "Fetch remotes before displaying (default in verbose mode)")
    .option("-N, --no-fetch", "Skip fetching")
    .addOption(new Option("--json", "Output structured JSON").conflicts("quiet"))
    .addOption(
      new Option("--schema", "Print JSON Schema for this command's --json output and exit").conflicts([
        "json",
        "quiet",
        "verbose",
      ]),
    )
    .summary("Show the workspace branch (default)")
    .description(
      "Examples:\n\n  arb branch show                          Show branch, base, and share\n  arb branch show -v                       Per-repo tracking detail\n  arb branch show -q                       Just the branch name\n\nShow the workspace branch, base branch, share (remote tracking) branch, and any per-repo deviations. Use --verbose to show a per-repo table with branch and remote tracking info (fetches by default; use -N to skip). Press Ctrl+C during the fetch to cancel and use stale data. Use --quiet to output just the branch name (useful for scripting). Use --json for machine-readable output.\n\nSee 'arb help scripting' for output modes and piping.",
    )
    .action(async (options, command) => {
      if (options.schema) {
        printSchema(BranchJsonOutputSchema);
        return;
      }
      await arbAction(async (ctx, options) => {
        requireWorkspace(ctx);
        await runBranch(ctx, options);
      })(options, command);
    });

  registerBranchRenameSubcommand(branch);
  registerBranchBaseSubcommand(branch);
}

async function runBranch(
  ctx: ArbContext,
  options: { quiet?: boolean; verbose?: boolean; json?: boolean; fetch?: boolean },
): Promise<void> {
  const wsDir = `${ctx.arbRootDir}/${ctx.currentWorkspace}`;
  const configFile = `${wsDir}/.arbws/config.json`;

  const wb = await workspaceBranch(wsDir);
  const branch = wb?.branch ?? (ctx.currentWorkspace as string);
  const base = readWorkspaceConfig(configFile)?.base ?? null;

  if (options.verbose) {
    await runVerboseBranch(ctx, wsDir, branch, base, options);
    return;
  }

  if (options.quiet) {
    process.stdout.write(`${branch}\n`);
    return;
  }

  // Gather per-repo refs (base + share topology)
  const cache = await GitCache.create();
  const repoDirs = workspaceRepoDirs(wsDir);
  const repoRefs = await Promise.all(repoDirs.map((dir) => gatherRepoRefs(dir, ctx.reposDir, base, undefined, cache)));

  const repos: RepoBranch[] = repoRefs.map((r) => {
    const b = r.identity.headMode.kind === "attached" ? r.identity.headMode.branch : null;
    return { name: r.name, branch: b };
  });

  if (options.json) {
    const output: BranchJsonOutput = {
      branch,
      base: base ?? null,
      repos: repos.map((r) => ({ name: r.name, branch: r.branch })),
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  // Derive workspace-level base and share from first repo
  const { resolvedBase, share } = deriveWorkspaceSummary(repoRefs);

  // Default table output
  const nodes = buildBranchSummaryNodes(branch, resolvedBase, !base, share, repos);
  const rCtx: RenderContext = { tty: shouldColor() };
  process.stdout.write(render(nodes, rCtx));
}

// ── Verbose mode ──────────────────────────────────────────────────

async function runVerboseBranch(
  ctx: ArbContext,
  wsDir: string,
  branch: string,
  base: string | null,
  options: { json?: boolean; fetch?: boolean },
): Promise<void> {
  const cache = await GitCache.create();
  const repoDirs = workspaceRepoDirs(wsDir);

  const gatherRefs = () =>
    Promise.all(repoDirs.map((dir) => gatherRepoRefs(dir, ctx.reposDir, base, undefined, cache)));

  const repoNamesForFetch = repoDirs.map((d) => basename(d));
  const shouldFetchVerbose = resolveDefaultFetch(options.fetch);

  if (shouldFetchVerbose && !options.json && isTTY()) {
    // Phased rendering: stale → fetch → fresh
    const repoNames = repoNamesForFetch;
    const { signal: abortSignal, cleanup: abortCleanup } = listenForAbortSignal();
    const fetchPromise = cache
      .resolveRemotesMap(repoNames, ctx.reposDir)
      .then((remotesMap) => parallelFetch(repoDirs, undefined, remotesMap, { silent: true, signal: abortSignal }));
    fetchPromise.catch(() => {}); // Prevent unhandled rejection on abort

    const state: {
      fetchResults?: Map<string, FetchResult>;
      aborted?: boolean;
      staleOutput?: string;
    } = {};

    try {
      await runPhasedRender(
        [
          {
            render: async () => {
              const repos = await gatherRefs();
              state.staleOutput = formatVerboseOutput(repos, branch, base);
              return state.staleOutput + fetchSuffix(repoNames.length, { abortable: true });
            },
            write: stderr,
          },
          {
            render: async () => {
              if (abortSignal.aborted) {
                state.aborted = true;
                return state.staleOutput as string;
              }
              state.fetchResults = await fetchPromise;
              if (abortSignal.aborted) {
                state.aborted = true;
                return state.staleOutput as string;
              }
              cache.invalidateAfterFetch();
              const repos = await gatherRefs();
              return formatVerboseOutput(repos, branch, base);
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
      reportFetchFailures(repoNames, state.fetchResults as Map<string, FetchResult>);
    }
    return;
  }

  if (shouldFetchVerbose) {
    // Non-TTY: blocking fetch then render
    const repoNames = repoNamesForFetch;
    const remotesMap = await cache.resolveRemotesMap(repoNames, ctx.reposDir);
    const results = await parallelFetch(repoDirs, undefined, remotesMap, options.json ? { silent: true } : undefined);
    cache.invalidateAfterFetch();
    reportFetchFailures(repoNames, results);
  }

  const repos = await gatherRefs();

  if (options.json) {
    process.stdout.write(formatVerboseJson(repos, branch, base));
    return;
  }

  process.stdout.write(formatVerboseOutput(repos, branch, base));
}

function buildVerboseRows(repos: RepoRefs[], branch: string): VerboseRow[] {
  return repos.map((repo) => {
    const { headMode } = repo.identity;
    const detached = headMode.kind === "detached";
    const actualBranch = headMode.kind === "attached" ? headMode.branch : "(detached)";
    const isWrongBranch = headMode.kind === "attached" && headMode.branch !== branch;

    // Base column: show the resolved base ref (e.g. "origin/main" or bare branch for local)
    let base = "";
    if (!detached && repo.base) {
      base = statusBaseRef(repo.base);
    }

    // Share column: show the share tracking ref or status
    let share = "";
    if (!detached) {
      switch (repo.share.refMode) {
        case "configured":
        case "implicit":
          share = repo.share.ref ?? "";
          break;
        case "noRef":
          share = "(local only)";
          break;
        case "gone":
          share = "(gone)";
          break;
      }
    }

    const branchNoteworthy = detached || isWrongBranch;

    return { name: repo.name, branch: actualBranch, base, share, branchNoteworthy };
  });
}

function formatVerboseOutput(repos: RepoRefs[], branch: string, base: string | null): string {
  const { resolvedBase, share } = deriveWorkspaceSummary(repos);
  const nodes = buildVerboseNodes(repos, branch, base, resolvedBase, share);
  const rCtx: RenderContext = { tty: shouldColor() };
  return render(nodes, rCtx);
}

function formatVerboseJson(repos: RepoRefs[], branch: string, base: string | null): string {
  const jsonRepos: BranchJsonRepo[] = repos.map((repo) => {
    const { headMode } = repo.identity;
    const repoBranch = headMode.kind === "attached" ? headMode.branch : null;

    // Base ref
    let baseRefStr: string | null = null;
    if (headMode.kind === "attached" && repo.base) {
      baseRefStr = statusBaseRef(repo.base);
    }

    // Share ref
    let share: string | null = null;
    if (headMode.kind === "attached") {
      switch (repo.share.refMode) {
        case "configured":
        case "implicit":
          share = repo.share.ref ?? null;
          break;
      }
    }

    return {
      name: repo.name,
      branch: repoBranch,
      base: baseRefStr,
      share,
      refMode: repo.share.refMode,
    };
  });

  const output: BranchJsonOutput = { branch, base: base ?? null, repos: jsonRepos };
  return `${JSON.stringify(output, null, 2)}\n`;
}

// ── Base subcommand ──────────────────────────────────────────────

function registerBranchBaseSubcommand(parent: Command): void {
  parent
    .command("base [branch]")
    .option("--unset", "Remove the base branch (track repo default)")
    .option("-f, --force", "Bypass merged-base safety check")
    .summary("Show, set, or remove the base branch")
    .description(
      "Examples:\n\n  arb branch base                          Show current base\n  arb branch base main                     Set base to main\n  arb branch base --unset                  Track repo default branch\n\nView, change, or remove the workspace's base branch. This is a config-only command — it does not rebase.\n\nWith no arguments, shows the current base branch. With a branch name, sets the base. With --unset, removes the base so the workspace tracks each repo's default branch.\n\nTo change the base and rebase in one step, use 'arb retarget <branch>' instead.\n\nWhen setting a new base, checks whether the current base was merged into the default branch (squash or regular merge). If so, blocks the config change and guides you toward 'arb retarget', which rebases safely. Use --force to change the config anyway.\n\nSee 'arb help stacked' for stacked workspace workflows.",
    )
    .action(
      arbAction(async (ctx, branchArg: string | undefined, options) => {
        const { wsDir } = requireWorkspace(ctx);
        const configFile = `${wsDir}/.arbws/config.json`;
        const config = readWorkspaceConfig(configFile);
        const currentBase = config?.base ?? null;
        const wsBranch = config?.branch ?? (ctx.currentWorkspace as string);

        // Unset mode
        if (options.unset) {
          if (branchArg) {
            error("Cannot combine a branch argument with --unset.");
            throw new ArbError("Cannot combine a branch argument with --unset.");
          }
          if (!currentBase) {
            info("No base branch configured — already tracking repo default");
            return;
          }
          writeWorkspaceConfig(configFile, { branch: wsBranch });
          info("Base branch removed (now tracking repo default)");
          return;
        }

        // Show mode
        if (!branchArg) {
          if (currentBase) {
            process.stdout.write(`${currentBase}\n`);
          } else {
            info("No base branch configured — tracking repo default");
          }
          return;
        }

        const cache = ctx.cache;
        const resolution = await resolveWorkspaceBaseResolution(wsDir, ctx.reposDir, cache);
        const normalizedBranchArg = rejectExplicitBaseRemotePrefix(branchArg, resolution) ?? branchArg;

        // Set mode
        const branchErr = branchNameError(normalizedBranchArg);
        if (branchErr) {
          error(`Invalid branch name: ${branchErr}`);
          throw new ArbError(`Invalid branch name: ${normalizedBranchArg}`);
        }

        if (normalizedBranchArg === wsBranch) {
          error(`Cannot set base to ${normalizedBranchArg} — that is the workspace branch.`);
          throw new ArbError(`Cannot set base to ${normalizedBranchArg} — that is the workspace branch.`);
        }

        // Merged-base safety check
        if (!options.force && currentBase) {
          const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache, {
            analysisCache: ctx.analysisCache,
          });
          const hasMergedBase = summary.repos.some((repo) => {
            const flags = computeFlags(repo, wsBranch);
            return flags.isBaseMerged;
          });
          if (hasMergedBase) {
            error(`Base branch ${currentBase} was merged into the default branch.`);
            error("Use 'arb retarget' to rebase onto the new base safely.");
            error("'arb branch base' only changes the config — it does not rebase.");
            error("Use --force to change the config anyway.");
            throw new ArbError(`Base branch ${currentBase} was merged — use 'arb retarget' or --force.`);
          }
        }

        writeWorkspaceConfig(configFile, { branch: wsBranch, base: normalizedBranchArg });
        if (currentBase) {
          info(`Base branch changed from ${currentBase} to ${normalizedBranchArg}`);
        } else {
          info(`Base branch set to ${normalizedBranchArg}`);
        }
      }),
    );
}
