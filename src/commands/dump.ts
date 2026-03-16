import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Command } from "commander";
import type { ArbContext } from "../lib/core";
import { readWorkspaceConfig } from "../lib/core";
import { GitCache, getRemoteNames, getRemoteUrl } from "../lib/git";
import { AnalysisCache, computeFlags, gatherWorkspaceSummary } from "../lib/status";
import { fetchTtl, loadFetchTimestamps } from "../lib/sync";
import { listRepos, listWorkspaces, readGitdirFromWorktree, workspaceRepoDirs } from "../lib/workspace";
import { ARB_VERSION } from "../version";

export function registerDumpCommand(program: Command, getCtx: () => ArbContext): void {
  program
    .command("dump", { hidden: true })
    .summary("Dump full workspace state for debugging")
    .description(
      "Collect all arb and git state and print it as JSON. Run this when you encounter a weird workspace state or unexpected sync plan — capture the output, then analyze or share it to diagnose the issue.\n\nOutputs to stdout. Does not fetch, so the dump reflects current local state only.",
    )
    .action(async () => {
      const ctx = getCtx();
      await runDump(ctx);
    });
}

interface WorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: string | null;
  prunable: string | null;
}

function parseWorktreePorcelain(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of stdout.split(/\n\n+/)) {
    const lines = block.split("\n").filter(Boolean);
    const first = lines[0];
    if (!first?.startsWith("worktree ")) continue;

    const entry: WorktreeEntry = {
      path: first.slice("worktree ".length),
      head: null,
      branch: null,
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    };

    for (const line of lines.slice(1)) {
      if (line.startsWith("HEAD ")) entry.head = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) entry.branch = line.slice("branch ".length);
      else if (line === "bare") entry.bare = true;
      else if (line === "detached") entry.detached = true;
      else if (line.startsWith("locked"))
        entry.locked = line.length > "locked".length ? line.slice("locked ".length) : "";
      else if (line.startsWith("prunable ")) entry.prunable = line.slice("prunable ".length);
    }

    entries.push(entry);
  }
  return entries;
}

function readBackRef(gitdirPath: string): string | null {
  try {
    return readFileSync(join(gitdirPath, "gitdir"), "utf-8").trim() || null;
  } catch {
    return null;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Per-command git timeout for the dump. All operations are local (no network),
// so 5 s is generous — a hung git process (e.g. credential prompt, lock wait)
// should not prevent the rest of the dump from completing.
const DUMP_GIT_TIMEOUT_MS = 5000;

type GitTimedResult = { exitCode: number; stdout: string; stderr: string; timedOut: boolean };

async function gitTimed(repoDir: string, ...args: string[]): Promise<GitTimedResult> {
  const proc = (() => {
    try {
      return Bun.spawn(["git", "-C", repoDir, ...args], {
        cwd: repoDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch {
      return null;
    }
  })();
  if (!proc) return { exitCode: 1, stdout: "", stderr: "", timedOut: false };

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timed-out">((resolve) => {
    timeoutId = setTimeout(() => resolve("timed-out"), DUMP_GIT_TIMEOUT_MS);
  });

  const completionPromise = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode: exitCode ?? 1 }));

  const winner = await Promise.race([completionPromise, timeoutPromise]);
  clearTimeout(timeoutId);

  if (winner === "timed-out") {
    proc.kill();
    // completionPromise is still in flight; silence any rejection that could arise
    // from the killed process closing its pipes unexpectedly.
    completionPromise.catch(() => {});
    return { exitCode: 124, stdout: "", stderr: "", timedOut: true };
  }

  return { ...winner, timedOut: false };
}

async function runDump(ctx: ArbContext): Promise<void> {
  const cache = await GitCache.create();
  const aCache = AnalysisCache.load(ctx.arbRootDir);

  // Errors encountered while producing the dump — always included in output.
  const dumpErrors: string[] = [];

  // Git version
  let gitVersion: string | null = null;
  try {
    const v = await cache.getGitVersion();
    gitVersion = `${v.major}.${v.minor}.${v.patch}`;
  } catch (err) {
    dumpErrors.push(`getGitVersion: ${errMsg(err)}`);
  }

  // All workspace configs + per-repo gitdir wiring and working tree status
  let allWorkspaceNames: string[] = [];
  try {
    allWorkspaceNames = listWorkspaces(ctx.arbRootDir);
  } catch (err) {
    dumpErrors.push(`listWorkspaces: ${errMsg(err)}`);
  }

  const workspaceResults = await Promise.allSettled(
    allWorkspaceNames.map(async (ws) => {
      const configFile = `${ctx.arbRootDir}/${ws}/.arbws/config.json`;
      const wsDir = `${ctx.arbRootDir}/${ws}`;

      let repoDirs: string[] = [];
      try {
        repoDirs = workspaceRepoDirs(wsDir);
      } catch (err) {
        dumpErrors.push(`workspace ${ws} repoDirs: ${errMsg(err)}`);
      }

      const repos: Record<
        string,
        | { gitdir: string | null; backRef: string | null; valid: boolean; gitStatus: string[] | null }
        | { error: string }
      > = {};
      await Promise.all(
        repoDirs.map(async (repoDir) => {
          const repoName = basename(repoDir);
          try {
            const gitdir = readGitdirFromWorktree(repoDir);
            const backRef = gitdir ? readBackRef(gitdir) : null;

            // --branch adds a "## <branch>...<upstream> [ahead N, behind M]" header line,
            // which is useful context when currentWorkspaceStatus is unavailable.
            let gitStatus: string[] | null = null;
            const statusResult = await gitTimed(repoDir, "status", "--porcelain", "--branch");
            if (statusResult.timedOut) {
              dumpErrors.push(`workspace ${ws} repo ${repoName}: git status timed out`);
            } else if (statusResult.exitCode === 0) {
              gitStatus = statusResult.stdout.split("\n").filter(Boolean);
            }

            repos[repoName] = {
              gitdir,
              backRef,
              valid: gitdir !== null && backRef === join(repoDir, ".git"),
              gitStatus,
            };
          } catch (err) {
            const msg = errMsg(err);
            repos[repoName] = { error: msg };
            dumpErrors.push(`workspace ${ws} repo ${repoName}: ${msg}`);
          }
        }),
      );

      let branch: string | null = null;
      let base: string | null = null;
      let branchRenameFrom: string | null = null;
      try {
        const config = readWorkspaceConfig(configFile);
        branch = config?.branch ?? null;
        base = config?.base ?? null;
        branchRenameFrom = config?.branch_rename_from ?? null;
      } catch (err) {
        dumpErrors.push(`workspace ${ws} config: ${errMsg(err)}`);
      }

      return { branch, base, branchRenameFrom, repos };
    }),
  );

  const workspaces: Record<string, object> = {};
  for (const [i, ws] of allWorkspaceNames.entries()) {
    const result = workspaceResults[i];
    if (result === undefined) continue;
    if (result.status === "fulfilled") {
      workspaces[ws] = result.value;
    } else {
      const msg = errMsg(result.reason);
      workspaces[ws] = { error: msg };
      dumpErrors.push(`workspace ${ws}: ${msg}`);
    }
  }

  // Canonical repos: HEAD SHA, remote config, worktree entry graph, and local branches
  let repoNames: string[] = [];
  try {
    repoNames = listRepos(ctx.reposDir);
  } catch (err) {
    dumpErrors.push(`listRepos: ${errMsg(err)}`);
  }

  const canonicalRepos = await Promise.all(
    repoNames.map(async (name) => {
      try {
        const repoPath = `${ctx.reposDir}/${name}`;

        const [headResult, abbrevResult] = await Promise.all([
          gitTimed(repoPath, "rev-parse", "HEAD"),
          gitTimed(repoPath, "rev-parse", "--abbrev-ref", "HEAD"),
        ]);
        if (headResult.timedOut || abbrevResult.timedOut) {
          dumpErrors.push(`canonical repo ${name}: git rev-parse timed out`);
        }
        const headSha = !headResult.timedOut && headResult.exitCode === 0 ? headResult.stdout.trim() : null;
        const headDetached =
          !abbrevResult.timedOut && abbrevResult.exitCode === 0 ? abbrevResult.stdout.trim() === "HEAD" : null;

        let remoteRoles: { base: string; share: string } | null = null;
        let remoteUrls: Record<string, string | null> = {};
        let remoteError: string | undefined;
        try {
          const names = await getRemoteNames(repoPath);
          const urlEntries = await Promise.all(
            names.map(async (remote) => [remote, await getRemoteUrl(repoPath, remote)] as const),
          );
          remoteUrls = Object.fromEntries(urlEntries);
          try {
            remoteRoles = await cache.resolveRemotes(repoPath);
          } catch (err) {
            remoteError = errMsg(err);
          }
        } catch (err) {
          remoteError = errMsg(err);
        }

        const remotes: {
          roles: { base: string; share: string } | null;
          urls: Record<string, string | null>;
          error?: string;
        } = { roles: remoteRoles, urls: remoteUrls };
        if (remoteError) remotes.error = remoteError;

        let worktrees: WorktreeEntry[] | null = null;
        const worktreeResult = await gitTimed(repoPath, "worktree", "list", "--porcelain");
        if (worktreeResult.timedOut) {
          dumpErrors.push(`canonical repo ${name}: git worktree list timed out`);
        } else if (worktreeResult.exitCode === 0) {
          worktrees = parseWorktreePorcelain(worktreeResult.stdout);
        }

        // Build a branch→worktreePath index from the worktrees list (works on all git ≥ 2.17).
        // worktree entries use full refs like "refs/heads/feature/foo".
        const branchToWorktreePath = new Map<string, string>();
        for (const wt of worktrees ?? []) {
          if (wt.branch) branchToWorktreePath.set(wt.branch, wt.path);
        }

        // %(upstream:short) is the configured tracking remote ref, e.g. "origin/feature/foo".
        // Empty string when no upstream is configured.
        let localBranches: Array<{ name: string; upstream: string | null; worktreePath: string | null }> | null = null;
        const refsResult = await gitTimed(
          repoPath,
          "for-each-ref",
          "refs/heads/",
          "--format=%(refname:short)%09%(upstream:short)",
        );
        if (refsResult.timedOut) {
          dumpErrors.push(`canonical repo ${name}: git for-each-ref timed out`);
        } else if (refsResult.exitCode === 0) {
          localBranches = refsResult.stdout
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const tab = line.indexOf("\t");
              const branchName = tab >= 0 ? line.slice(0, tab) : line;
              const upstream = tab >= 0 ? line.slice(tab + 1).trim() : "";
              return {
                name: branchName,
                upstream: upstream || null,
                worktreePath: branchToWorktreePath.get(`refs/heads/${branchName}`) ?? null,
              };
            });
        }

        return { name, headSha, headDetached, remotes, worktrees, localBranches };
      } catch (err) {
        const msg = errMsg(err);
        dumpErrors.push(`canonical repo ${name}: ${msg}`);
        return { name, error: msg };
      }
    }),
  );

  // Current workspace: full status with flags.
  // gatherWorkspaceSummary calls git() internally (no per-call timeout), so we
  // race the whole thing against a generous wall-clock timeout so a stuck repo
  // cannot prevent the rest of the dump from being output.
  const GATHER_TIMEOUT_MS = 15_000;
  let currentWorkspaceStatus: object | null = null;
  if (ctx.currentWorkspace) {
    const wsDir = `${ctx.arbRootDir}/${ctx.currentWorkspace}`;
    try {
      const gatherPromise = gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache, {
        gatherActivity: true,
        analysisCache: aCache,
      });
      let gatherTimeoutId: ReturnType<typeof setTimeout> | undefined;
      const gatherTimeout = new Promise<"timed-out">((resolve) => {
        gatherTimeoutId = setTimeout(() => resolve("timed-out"), GATHER_TIMEOUT_MS);
      });
      const gatherResult = await Promise.race([gatherPromise, gatherTimeout]);
      clearTimeout(gatherTimeoutId);
      if (gatherResult === "timed-out") {
        currentWorkspaceStatus = { name: ctx.currentWorkspace, error: "timed out" };
        dumpErrors.push(`currentWorkspaceStatus: timed out after ${GATHER_TIMEOUT_MS / 1000}s`);
        // suppress background rejection
        gatherPromise.catch(() => {});
      } else {
        const repos = gatherResult.repos.map((repo) => ({
          name: repo.name,
          status: repo,
          flags: computeFlags(repo, gatherResult.branch),
        }));
        currentWorkspaceStatus = {
          name: gatherResult.workspace,
          branch: gatherResult.branch,
          base: gatherResult.base,
          lastCommit: gatherResult.lastCommit,
          lastActivity: gatherResult.lastActivity,
          lastActivityFile: gatherResult.lastActivityFile,
          repos,
        };
      }
    } catch (err) {
      const msg = errMsg(err);
      currentWorkspaceStatus = { name: ctx.currentWorkspace, error: msg };
      dumpErrors.push(`currentWorkspaceStatus: ${msg}`);
    }
  }

  const versions = process.versions as Record<string, string | undefined>;

  // Capture env vars relevant to arb and terminal rendering.
  const envKeys = ["TERM", "NO_COLOR", "FORCE_COLOR", "CI", "GITHUB_ACTIONS", "GITHUB_WORKFLOW", "GITHUB_RUN_ID"];
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val !== undefined && (key.startsWith("ARB_") || envKeys.includes(key))) {
      env[key] = val;
    }
  }

  // Fetch cache summary
  const fetchTimestamps = loadFetchTimestamps(ctx.arbRootDir);
  const fetchEntries = Object.entries(fetchTimestamps);
  const fetchCacheSummary = {
    path: join(ctx.arbRootDir, ".arb", "cache", "fetch.json"),
    ttlSeconds: fetchTtl(),
    entryCount: fetchEntries.length,
    entries: Object.fromEntries(fetchEntries.map(([repo, ts]) => [repo, new Date(ts).toISOString()])),
  };

  // Analysis cache summary
  const analysisCacheSummary = {
    path: aCache.path,
    schemaVersion: AnalysisCache.schemaVersion,
    entryCount: aCache.size,
    oldestTimestamp: aCache.oldestTimestamp ? new Date(aCache.oldestTimestamp * 1000).toISOString() : null,
    newestTimestamp: aCache.newestTimestamp ? new Date(aCache.newestTimestamp * 1000).toISOString() : null,
  };

  const output = {
    timestamp: new Date().toISOString(),
    arb: {
      version: ARB_VERSION,
      rootDir: ctx.arbRootDir,
      reposDir: ctx.reposDir,
      currentWorkspace: ctx.currentWorkspace,
    },
    system: {
      argv: process.argv,
      cwd: process.cwd(),
      platform: process.platform,
      git: gitVersion,
      bun: versions.bun ?? null,
      node: versions.node ?? null,
      env,
      stdin: { isTTY: process.stdin.isTTY ?? false },
      stdout: { isTTY: process.stdout.isTTY ?? false, columns: process.stdout.columns ?? null },
      stderr: { isTTY: process.stderr.isTTY ?? false, columns: process.stderr.columns ?? null },
    },
    errors: dumpErrors,
    fetchCache: fetchCacheSummary,
    analysisCache: analysisCacheSummary,
    workspaces,
    canonicalRepos,
    currentWorkspaceStatus,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
