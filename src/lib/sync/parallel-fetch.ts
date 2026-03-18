import { basename } from "node:path";
import { gitLocal, gitNetwork, networkTimeout } from "../git/git";
import type { RepoRemotes } from "../git/remotes";
import { dim, plural, warn } from "../terminal/output";
import { isTTY } from "../terminal/tty";
import { classifyNetworkError, isNetworkError, networkErrorHint } from "./network-errors";

export interface FetchResult {
  repo: string;
  exitCode: number;
  output: string;
}

/** Resolve whether to auto-fetch: explicit flag wins, then ARB_NO_FETCH env var, then default (fetch). */
export function resolveDefaultFetch(fetchOption: boolean | undefined): boolean {
  if (fetchOption !== undefined) return fetchOption;
  return !process.env.ARB_NO_FETCH;
}

export async function parallelFetch(
  repoDirs: string[],
  timeout?: number,
  remotesMap?: Map<string, RepoRemotes>,
  options?: { silent?: boolean; signal?: AbortSignal },
): Promise<Map<string, FetchResult>> {
  const fetchTimeout = timeout ?? networkTimeout("ARB_FETCH_TIMEOUT", 120);
  const results = new Map<string, FetchResult>();
  const total = repoDirs.length;

  if (total === 0) return results;

  const startTime = performance.now();
  let completed = 0;
  const tty = isTTY();
  const silent = options?.silent === true;
  const label = plural(total, "repo");

  const updateProgress = () => {
    if (tty && !silent) {
      const counter = completed > 0 ? ` ${completed}/${total}` : "";
      process.stderr.write(`\r\x1B[2KFetching ${label}...${counter}`);
    }
  };

  // Global deadline: one AbortController shared across all fetches
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (options?.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  if (fetchTimeout > 0) {
    timeoutId = setTimeout(() => controller.abort(), fetchTimeout * 1000);
  }

  const fetchOne = async (repoDir: string): Promise<void> => {
    const repo = basename(repoDir);
    try {
      const repoRemotes = remotesMap?.get(repo);
      const remotesToFetch = new Set<string>();
      if (repoRemotes) {
        remotesToFetch.add(repoRemotes.base);
        remotesToFetch.add(repoRemotes.share);
      }
      const baseRemote = repoRemotes?.base;

      let allOutput = "";
      let lastExitCode = 0;

      if (remotesToFetch.size > 0) {
        for (const remote of remotesToFetch) {
          const result = await gitNetwork(repoDir, 0, ["fetch", "--prune", remote], {
            signal: controller.signal,
          });

          if (result.exitCode === 124) {
            results.set(repo, { repo, exitCode: 124, output: `fetch timed out after ${fetchTimeout}s` });
            completed++;
            updateProgress();
            return;
          }

          if (result.stderr.trim()) {
            allOutput += (allOutput ? "\n" : "") + result.stderr.trim();
          }
          if (result.exitCode !== 0) {
            lastExitCode = result.exitCode;
          }
        }
      } else {
        // No resolved remotes — fetch all
        const result = await gitNetwork(repoDir, 0, ["fetch", "--all", "--prune"], {
          signal: controller.signal,
        });

        if (result.exitCode === 124) {
          results.set(repo, { repo, exitCode: 124, output: `fetch timed out after ${fetchTimeout}s` });
          completed++;
          updateProgress();
          return;
        }

        if (result.stderr.trim()) {
          allOutput += result.stderr.trim();
        }
        if (result.exitCode !== 0) {
          lastExitCode = result.exitCode;
        }
      }

      // Auto-detect remote HEAD on the base remote (only when we know which remote is base).
      // Track whether set-head changed the remote HEAD pointer so callers can detect
      // default-branch renames even when no branch refs were updated by the fetch itself.
      if (baseRemote && lastExitCode === 0) {
        try {
          const prevHead = await gitLocal(repoDir, "symbolic-ref", "--short", `refs/remotes/${baseRemote}/HEAD`);
          await gitNetwork(repoDir, 0, ["remote", "set-head", baseRemote, "--auto"], {
            signal: controller.signal,
          });
          const newHead = await gitLocal(repoDir, "symbolic-ref", "--short", `refs/remotes/${baseRemote}/HEAD`);
          if (prevHead.exitCode === 0 && newHead.exitCode === 0 && prevHead.stdout.trim() !== newHead.stdout.trim()) {
            allOutput += `${allOutput ? "\n" : ""}remote HEAD changed: ${prevHead.stdout.trim()} -> ${newHead.stdout.trim()}`;
          }
        } catch {
          // set-head failure is non-fatal — the fetch itself succeeded
        }
      }

      results.set(repo, { repo, exitCode: lastExitCode, output: allOutput });
    } catch {
      results.set(repo, { repo, exitCode: 1, output: "fetch failed" });
    }
    completed++;
    updateProgress();
  };

  updateProgress();
  await Promise.all(repoDirs.map(fetchOne));

  if (timeoutId !== undefined) clearTimeout(timeoutId);

  if (!silent) {
    if (tty) {
      process.stderr.write("\r\x1B[2K"); // clear the "Fetching..." progress line
    } else {
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      process.stderr.write(`Fetched ${label} in ${elapsed}s\n`);
    }
  }

  return results;
}

export function reportFetchFailures(
  repos: string[],
  results: Map<string, { exitCode: number; output: string }>,
): string[] {
  const failed = getFetchFailedRepos(repos, results);
  let allOffline = failed.length > 0;

  for (const repo of failed) {
    const fr = results.get(repo);
    if (fr?.exitCode === 124) {
      warn(`  [${repo}] fetch timed out`);
      allOffline = false;
    } else {
      const hint = fr?.output ? networkErrorHint(classifyNetworkError(fr.output)) : null;
      const suffix = hint ? ` (${hint})` : "";
      warn(`  [${repo}] fetch failed${suffix}`);
      if (!fr?.output || !isNetworkError(fr.output)) {
        allOffline = false;
      }
    }
    if (fr?.output) {
      for (const line of fr.output.split("\n").filter(Boolean)) {
        warn(`    ${line}`);
      }
    }
  }

  if (allOffline && failed.length > 1) {
    warn("  hint: all repos failed to fetch \u2014 you may be offline. Use -N/--no-fetch to skip fetching.");
  }

  return failed;
}

export function fetchSuffix(count: number, options?: { abortable?: boolean }): string {
  const hint = options?.abortable && isTTY() && process.stdin.isTTY ? " <Ctrl+C to cancel>" : "";
  return dim(`Fetching ${plural(count, "repo")}...${hint}`);
}

/** Repos where the fetch was a no-op: exitCode 0 and no output (no refs changed). */
export function getUnchangedRepos(results: Map<string, FetchResult>): Set<string> {
  const unchanged = new Set<string>();
  for (const [repo, result] of results) {
    if (result.exitCode === 0 && result.output === "") {
      unchanged.add(repo);
    }
  }
  return unchanged;
}

export function getFetchFailedRepos(
  repos: string[],
  results: Map<string, { exitCode: number; output: string }>,
): string[] {
  return repos.filter((repo) => {
    const fr = results.get(repo);
    return !fr || fr.exitCode !== 0;
  });
}
