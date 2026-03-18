import { basename } from "node:path";
import type { Command } from "commander";
import { ArbError, arbAction } from "../lib/core";
import { getCommitsBetweenFull, gitLocal } from "../lib/git";
import { printSchema } from "../lib/json";
import { type LogJsonOutput, LogJsonOutputSchema, type LogJsonRepo } from "../lib/json";
import { type RenderContext, render } from "../lib/render";
import { buildRepoSkipHeader, repoHeaderNode } from "../lib/render";
import {
  type RepoStatus,
  baseRef,
  computeFlags,
  gatherWorkspaceSummary,
  repoMatchesWhere,
  resolveWhereFilter,
} from "../lib/status";
import { parallelFetch, reportFetchFailures } from "../lib/sync";
import { error, isTTY, plural, shouldColor, stdout, success } from "../lib/terminal";
import { requireBranch, requireWorkspace, resolveReposFromArgsOrStdin, workspaceRepoDirs } from "../lib/workspace";

interface LogCommit {
  shortHash: string;
  fullHash: string;
  subject: string;
  body?: string;
  files?: string[];
}

type RepoLogStatus = "ok" | "detached" | "wrong-branch" | "no-base" | "fallback-base";

interface ReplayPlanSummary {
  totalLocal: number;
  alreadyOnTarget: number;
  toReplay: number;
  contiguous: boolean;
}

interface RepoLogResult {
  name: string;
  status: RepoLogStatus;
  reason?: string;
  shallow?: boolean;
  annotation: string;
  commits: LogCommit[];
  replayPlan?: ReplayPlanSummary;
}

const NO_BASE_FALLBACK_LIMIT = 10;

export function registerLogCommand(program: Command): void {
  program
    .command("log [repos...]")
    .option("--fetch", "Fetch from all remotes before showing log")
    .option("-N, --no-fetch", "Skip fetching (default)")
    .option("-n, --max-count <count>", "Limit commits shown per repo")
    .option("-d, --dirty", "Only log dirty repos (shorthand for --where dirty)")
    .option("-w, --where <filter>", "Only log repos matching status filter (comma = OR, + = AND, ^ = negate)")
    .option("-v, --verbose", "Show commit bodies and changed files")
    .option("--json", "Output structured JSON to stdout")
    .option("--schema", "Print JSON Schema for this command's --json output and exit")
    .summary("Show feature branch commits across repos")
    .description(
      "Examples:\n\n  arb log                                  Show feature commits across repos\n  arb log api --verbose                    Include commit bodies and files\n  arb log -n 5 --where dirty               Limit commits, filter repos\n\nShow commits on the feature branch since diverging from the base branch across all repos in the workspace. Answers 'what have I done in this workspace?' by showing only the commits that belong to the current feature.\n\nShows commits in the range base..HEAD for each repo. Use --fetch to fetch before showing log (default is no fetch). Use -n to limit how many commits are shown per repo. Use -v/--verbose to also show commit bodies and changed files. Use --json for machine-readable output.\n\nRepos are positional arguments — name specific repos to filter, or omit to show all. Reads repo names from stdin when piped (one per line). Use --where to filter by status flags. See 'arb help where' for filter syntax. Skipped repos (detached HEAD, wrong branch) are explained in the output, never silently omitted.\n\nSee 'arb help scripting' for output modes and piping.",
    )
    .action(async (repoArgs: string[], options, command) => {
      if (options.schema) {
        if (options.json) {
          error("Cannot combine --schema with --json.");
          throw new ArbError("Cannot combine --schema with --json.");
        }
        printSchema(LogJsonOutputSchema);
        return;
      }
      await arbAction(async (ctx, repoArgs: string[], options) => {
        const { wsDir, workspace } = requireWorkspace(ctx);
        const branch = await requireBranch(wsDir, workspace);

        const selectedRepos = await resolveReposFromArgsOrStdin(wsDir, repoArgs);
        const cache = ctx.cache;

        if (options.fetch) {
          const allFetchDirs = workspaceRepoDirs(wsDir);
          const selectedSet = new Set(selectedRepos);
          const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
          const repos = fetchDirs.map((d) => basename(d));
          const remotesMap = await cache.resolveRemotesMap(repos, ctx.reposDir);
          const results = await parallelFetch(fetchDirs, undefined, remotesMap);
          cache.invalidateAfterFetch();
          const failed = reportFetchFailures(repos, results);
          if (failed.length > 0) {
            error("Aborting due to fetch failures.");
            throw new ArbError("Aborting due to fetch failures.");
          }
        }
        const maxCount = options.maxCount ? Number.parseInt(options.maxCount, 10) : undefined;

        if (maxCount !== undefined && (Number.isNaN(maxCount) || maxCount < 1)) {
          error("--max-count must be a positive integer");
          throw new ArbError("--max-count must be a positive integer");
        }

        const where = resolveWhereFilter(options);

        const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache, {
          analysisCache: ctx.analysisCache,
        });
        const selectedSet = new Set(selectedRepos);
        let repos = summary.repos.filter((r) => selectedSet.has(r.name));

        // Apply --where filter
        if (where) {
          repos = repos.filter((repo) => {
            const flags = computeFlags(repo, branch);
            return repoMatchesWhere(flags, where);
          });
        }

        if (!options.json && isTTY()) {
          await outputTTY(repos, wsDir, branch, maxCount, options.verbose);
        } else {
          const results = await Promise.all(
            repos.map((repo) => gatherRepoLog(repo, wsDir, branch, maxCount, options.verbose)),
          );
          if (options.json) {
            outputJson(summary.workspace, summary.branch, summary.base, results);
          } else {
            outputPipe(results);
          }
        }
      })(repoArgs, options, command);
    });
}

// ── TTY output: delegate to git for commit rendering ─────────────

async function outputTTY(
  repos: RepoStatus[],
  wsDir: string,
  branch: string,
  maxCount?: number,
  verbose?: boolean,
): Promise<void> {
  let totalCommits = 0;
  const ctx: RenderContext = { tty: shouldColor() };

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    if (!repo) continue;

    const repoDir = `${wsDir}/${repo.name}`;
    const flags = computeFlags(repo, branch);

    const skipNodes = buildRepoSkipHeader(repo, branch, flags, i >= repos.length - 1);
    if (skipNodes) {
      process.stderr.write(render(skipNodes, ctx));
      continue;
    }

    // Build git log args
    const gitArgs: string[] = [];
    let note = "";

    if (!repo.base) {
      gitArgs.push("-n", `${maxCount ?? NO_BASE_FALLBACK_LIMIT}`, "HEAD");
      note = "no base branch, showing recent";
    } else {
      const baseMissing = repo.base.configuredRef != null && repo.base.baseMergedIntoDefault == null;
      const ref = baseRef(repo.base);
      gitArgs.push(`${ref}..HEAD`);
      if (maxCount !== undefined) {
        gitArgs.push("-n", `${maxCount}`);
      }
      if (baseMissing) {
        note = `base ${repo.base.configuredRef} not found, showing against ${repo.base.ref}`;
      }
    }

    if (repo.base?.replayPlan && repo.base.replayPlan.alreadyOnTarget > 0) {
      const rp = repo.base.replayPlan;
      const replayNote = `${rp.alreadyOnTarget} already on base, ${rp.toReplay} to replay`;
      note = note ? `${note}, ${replayNote}` : replayNote;
    }

    if (repo.operation) {
      note = note ? `${note}, ${repo.operation} in progress` : `${repo.operation} in progress`;
    }

    if (repo.identity.shallow) {
      const shallowNote = "shallow clone, history may be incomplete";
      note = note ? `${note}, ${shallowNote}` : shallowNote;
    }

    // Header
    process.stderr.write(render([repoHeaderNode(repo.name, note || undefined)], ctx));

    // Let git render the commits
    const colorFlag = shouldColor() ? "--color=always" : "--color=never";
    const logArgs = verbose ? ["--no-decorate", colorFlag, "--stat"] : ["--oneline", "--no-decorate", colorFlag];
    const result = await gitLocal(repoDir, "log", ...logArgs, ...gitArgs);
    if (result.exitCode === 0 && result.stdout.trim()) {
      stdout(result.stdout);
      // Count commits: in verbose mode match "commit <hash>" (ANSI codes may precede it); in oneline mode each line is one commit
      totalCommits += verbose
        ? (result.stdout.match(/commit [0-9a-f]{7,}/g) ?? []).length
        : result.stdout.trim().split("\n").length;
    }

    if (i < repos.length - 1) {
      process.stderr.write("\n");
    }
  }

  process.stderr.write("\n");
  success(`Logged ${plural(repos.length, "repo")} (${plural(totalCommits, "commit")})`);
}

// ── Structured gathering for pipe / JSON modes ───────────────────

async function gatherRepoLog(
  repo: RepoStatus,
  wsDir: string,
  branch: string,
  maxCount?: number,
  verbose?: boolean,
): Promise<RepoLogResult> {
  const repoDir = `${wsDir}/${repo.name}`;
  const flags = computeFlags(repo, branch);

  if (flags.isDetached) {
    return {
      name: repo.name,
      status: "detached",
      reason: "HEAD is detached",
      annotation: "detached \u2014 skipping",
      commits: [],
    };
  }

  if (flags.isWrongBranch && repo.identity.headMode.kind === "attached") {
    const actual = repo.identity.headMode.branch;
    return {
      name: repo.name,
      status: "wrong-branch",
      reason: `on ${actual}, expected ${branch}`,
      annotation: `on ${actual}, expected ${branch} \u2014 skipping`,
      commits: [],
    };
  }

  if (!repo.base) {
    const limit = maxCount ?? NO_BASE_FALLBACK_LIMIT;
    let commits = await getRecentCommits(repoDir, limit);
    if (verbose) {
      commits = await enrichWithVerboseDetail(repoDir, commits);
    }
    let annotation = `no base branch, showing ${commits.length} recent`;
    if (repo.identity.shallow) {
      annotation += ", shallow clone";
    }
    return {
      name: repo.name,
      status: "no-base",
      reason: "no base branch resolved",
      shallow: repo.identity.shallow || undefined,
      annotation,
      commits,
    };
  }

  const baseMissing = repo.base.configuredRef != null && repo.base.baseMergedIntoDefault == null;
  const ref = baseRef(repo.base);
  let commits = await getCommitsBetweenFull(repoDir, ref, "HEAD");

  if (maxCount !== undefined && commits.length > maxCount) {
    commits = commits.slice(0, maxCount);
  }

  if (verbose) {
    commits = await enrichWithVerboseDetail(repoDir, commits);
  }

  let annotation: string;
  if (baseMissing) {
    annotation = `base ${repo.base.configuredRef ?? ""} not found, showing against ${repo.base.ref}`;
  } else if (commits.length === 0) {
    annotation = "no commits ahead of base";
  } else {
    annotation = plural(commits.length, "commit");
  }

  if (repo.base.replayPlan && repo.base.replayPlan.alreadyOnTarget > 0) {
    const rp = repo.base.replayPlan;
    annotation += ` (${rp.alreadyOnTarget} already on base, ${rp.toReplay} to replay)`;
  }

  if (repo.operation) {
    annotation += `, ${repo.operation} in progress`;
  }

  if (repo.identity.shallow) {
    annotation += ", shallow clone";
  }

  const replayPlan =
    repo.base.replayPlan && repo.base.replayPlan.alreadyOnTarget > 0
      ? {
          totalLocal: repo.base.replayPlan.totalLocal,
          alreadyOnTarget: repo.base.replayPlan.alreadyOnTarget,
          toReplay: repo.base.replayPlan.toReplay,
          contiguous: repo.base.replayPlan.contiguous,
        }
      : undefined;

  return {
    name: repo.name,
    status: baseMissing ? "fallback-base" : "ok",
    reason: baseMissing ? `base ${repo.base.configuredRef} not found, using ${repo.base.ref}` : undefined,
    shallow: repo.identity.shallow || undefined,
    annotation,
    commits,
    replayPlan,
  };
}

async function getRecentCommits(repoDir: string, limit: number): Promise<LogCommit[]> {
  const result = await gitLocal(repoDir, "log", "--format=%h %H %s", "-n", `${limit}`, "HEAD");
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const first = line.indexOf(" ");
      const second = line.indexOf(" ", first + 1);
      return {
        shortHash: line.slice(0, first),
        fullHash: line.slice(first + 1, second),
        subject: line.slice(second + 1),
      };
    });
}

async function getCommitVerboseDetail(repoDir: string, fullHash: string): Promise<{ body: string; files: string[] }> {
  const result = await gitLocal(repoDir, "show", "--format=%b%x00", "--name-only", fullHash);
  if (result.exitCode !== 0) return { body: "", files: [] };
  const [bodyPart, filesPart] = result.stdout.split("\0", 2);
  const body = (bodyPart ?? "").trim();
  const files = (filesPart ?? "")
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  return { body, files };
}

async function enrichWithVerboseDetail(repoDir: string, commits: LogCommit[]): Promise<LogCommit[]> {
  return Promise.all(
    commits.map(async (c) => {
      const detail = await getCommitVerboseDetail(repoDir, c.fullHash);
      return { ...c, body: detail.body, files: detail.files };
    }),
  );
}

// ── Pipe output ──────────────────────────────────────────────────

function outputPipe(results: RepoLogResult[]): void {
  for (const r of results) {
    if (r.status === "detached" || r.status === "wrong-branch") {
      process.stderr.write(`${r.name}: skipped \u2014 ${r.reason}\n`);
    }
  }

  for (const r of results) {
    if (r.shallow) {
      process.stderr.write(`${r.name}: shallow clone, history may be incomplete\n`);
    }
  }

  for (const r of results) {
    if (r.status === "detached" || r.status === "wrong-branch") continue;
    for (const c of r.commits) {
      stdout(`${r.name}\t${c.shortHash}\t${c.subject}\n`);
    }
  }
}

// ── JSON output ──────────────────────────────────────────────────

function outputJson(workspace: string, branch: string, base: string | null, results: RepoLogResult[]): void {
  let totalCommits = 0;
  const repos: LogJsonRepo[] = results.map((r) => {
    totalCommits += r.commits.length;
    const entry: LogJsonRepo = {
      name: r.name,
      status: r.status,
      commits: r.commits.map((c) => ({
        hash: c.fullHash,
        shortHash: c.shortHash,
        subject: c.subject,
        ...(c.body !== undefined ? { body: c.body } : {}),
        ...(c.files !== undefined ? { files: c.files } : {}),
      })),
    };
    if (r.reason) {
      entry.reason = r.reason;
    }
    if (r.shallow) {
      entry.shallow = true;
    }
    if (r.replayPlan) {
      entry.replayPlan = r.replayPlan;
    }
    return entry;
  });

  const output: LogJsonOutput = { workspace, branch, base, repos, totalCommits };
  stdout(`${JSON.stringify(output, null, 2)}\n`);
}
