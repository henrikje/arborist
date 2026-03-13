import { existsSync, statSync } from "node:fs";
import { ArbError } from "../core/errors";
import { debugGit, isDebug } from "../terminal/debug";
import { error } from "../terminal/output";
import { type FileChange, type GitVersion, parseDiffShortstat, stagedType, unstagedType } from "./parsing";

export type GitOperation = "rebase" | "merge" | "cherry-pick" | "revert" | "bisect" | "am" | null;

export async function detectOperation(repoDir: string): Promise<GitOperation> {
  const gitDirResult = await git(repoDir, "rev-parse", "--git-dir");
  if (gitDirResult.exitCode !== 0) return null;
  const gitDir = gitDirResult.stdout.trim();
  const absGitDir = gitDir.startsWith("/") ? gitDir : `${repoDir}/${gitDir}`;
  if (existsSync(`${absGitDir}/rebase-merge`)) return "rebase";
  if (existsSync(`${absGitDir}/rebase-apply`)) {
    // Distinguish am (git am) from rebase: am sets an "applying" sentinel
    if (existsSync(`${absGitDir}/rebase-apply/applying`)) return "am";
    return "rebase";
  }
  if (existsSync(`${absGitDir}/MERGE_HEAD`)) return "merge";
  if (existsSync(`${absGitDir}/CHERRY_PICK_HEAD`)) return "cherry-pick";
  if (existsSync(`${absGitDir}/REVERT_HEAD`)) return "revert";
  if (existsSync(`${absGitDir}/BISECT_LOG`)) return "bisect";
  return null;
}

export async function isShallowRepo(repoDir: string): Promise<boolean> {
  const result = await git(repoDir, "rev-parse", "--is-shallow-repository");
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

export function isLinkedWorktree(repoDir: string): boolean {
  try {
    const stat = statSync(`${repoDir}/.git`);
    // Linked worktrees have a .git file (not directory) pointing to the main repo's worktrees dir
    return !stat.isDirectory();
  } catch {
    // .git doesn't exist — not a valid git repo at all
    return false;
  }
}

export async function git(
  repoDir: string,
  ...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const start = isDebug() ? performance.now() : 0;
  const proc = Bun.spawn(["git", "-C", repoDir, ...args], {
    cwd: repoDir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  const exitCode = proc.exitCode ?? 1;
  if (isDebug()) {
    debugGit(`git -C ${repoDir} ${args.join(" ")}`, performance.now() - start, exitCode);
  }
  return { exitCode, stdout, stderr };
}

export interface GitWithTimeoutOptions {
  signal?: AbortSignal;
  cwd?: string;
}

/**
 * Run a git command with a timeout. Returns exit code 124 on timeout (matching Unix `timeout`).
 * Accepts an optional AbortSignal for external cancellation (e.g. a shared deadline across fetches).
 * Use `cwd` for commands that don't support `-C` (e.g. `git clone`).
 */
export async function gitWithTimeout(
  repoDir: string,
  timeoutSeconds: number,
  args: string[],
  options?: GitWithTimeoutOptions,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const start = isDebug() ? performance.now() : 0;
  const cmdLabel = options?.cwd ? `git ${args.join(" ")}` : `git -C ${repoDir} ${args.join(" ")}`;

  const spawnArgs = options?.cwd ? ["git", ...args] : ["git", "-C", repoDir, ...args];
  const proc = Bun.spawn(spawnArgs, {
    cwd: options?.cwd ?? repoDir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  // If an external signal is already aborted, kill immediately and bail
  if (options?.signal?.aborted) {
    proc.kill();
    await proc.exited;
    if (isDebug()) {
      debugGit(cmdLabel, performance.now() - start, 124);
    }
    return { exitCode: 124, stdout: "", stderr: `timed out after ${timeoutSeconds}s` };
  }

  const controller = new AbortController();

  const timeoutId = timeoutSeconds > 0 ? setTimeout(() => controller.abort(), timeoutSeconds * 1000) : undefined;

  // If an external signal is provided, propagate it
  if (options?.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const abortPromise = new Promise<"aborted">((resolve) => {
    controller.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });

  const raceResult = await Promise.race([proc.exited, abortPromise]);

  if (raceResult === "aborted") {
    proc.kill();
    await proc.exited;
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (isDebug()) {
      debugGit(cmdLabel, performance.now() - start, 124);
    }
    return { exitCode: 124, stdout: "", stderr: `timed out after ${timeoutSeconds}s` };
  }

  if (timeoutId !== undefined) clearTimeout(timeoutId);

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = proc.exitCode ?? 1;
  if (isDebug()) {
    debugGit(cmdLabel, performance.now() - start, exitCode);
  }
  return { exitCode, stdout, stderr };
}

/** Resolve a network timeout: specific env var → ARB_NETWORK_TIMEOUT → default. */
export function networkTimeout(specificVar: string, defaultSeconds: number): number {
  return Number(process.env[specificVar]) || Number(process.env.ARB_NETWORK_TIMEOUT) || defaultSeconds;
}

export async function getShortHead(repoDir: string): Promise<string> {
  const result = await git(repoDir, "rev-parse", "--short", "HEAD");
  return result.exitCode === 0 ? result.stdout.trim() : "";
}

export async function getMergeBase(repoDir: string, ref1: string, ref2: string): Promise<string | null> {
  const result = await git(repoDir, "merge-base", ref1, ref2);
  if (result.exitCode !== 0) return null;
  const full = result.stdout.trim();
  if (!full) return null;
  const short = await git(repoDir, "rev-parse", "--short", full);
  return short.exitCode === 0 ? short.stdout.trim() : full.slice(0, 7);
}

export async function getDefaultBranch(repoDir: string, remote: string): Promise<string | null> {
  // Try remote HEAD first
  const symRef = await git(repoDir, "symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`);
  if (symRef.exitCode === 0) {
    return symRef.stdout.trim().replace(new RegExp(`^${remote}/`), "");
  }
  // No remote HEAD — use the repo's own HEAD branch
  const headRef = await git(repoDir, "symbolic-ref", "--short", "HEAD");
  if (headRef.exitCode === 0) {
    return headRef.stdout.trim();
  }
  return null;
}

export function validateBranchName(name: string): boolean {
  const start = isDebug() ? performance.now() : 0;
  const result = Bun.spawnSync(["git", "check-ref-format", "--branch", name]);
  if (isDebug()) {
    debugGit(`git check-ref-format --branch ${name}`, performance.now() - start, result.exitCode);
  }
  return result.exitCode === 0;
}

export async function checkBranchMatch(
  repoDir: string,
  expected: string,
): Promise<{ matches: boolean; actual: string }> {
  const result = await git(repoDir, "symbolic-ref", "--short", "HEAD");
  const actual = result.exitCode === 0 ? result.stdout.trim() : "?";
  return { matches: actual === expected, actual };
}

export async function branchExistsLocally(repoDir: string, branch: string): Promise<boolean> {
  const result = await git(repoDir, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
  return result.exitCode === 0;
}

export async function branchIsInWorktree(repoDir: string, branch: string): Promise<boolean> {
  const result = await git(repoDir, "worktree", "list", "--porcelain");
  if (result.exitCode !== 0) return false;
  const target = `branch refs/heads/${branch}`;
  return result.stdout.split("\n").some((line) => line === target);
}

export async function remoteBranchExists(repoDir: string, branch: string, remote: string): Promise<boolean> {
  const result = await git(repoDir, "show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`);
  return result.exitCode === 0;
}

/** List all branch names on a given remote (from locally cached refs). */
export async function listRemoteBranches(repoDir: string, remote: string): Promise<string[]> {
  const prefix = `refs/remotes/${remote}/`;
  const result = await git(repoDir, "for-each-ref", "--format=%(refname)", prefix);
  if (result.exitCode !== 0 || !result.stdout.trim()) return [];
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((ref) => ref.slice(prefix.length))
    .filter((name) => name !== "HEAD");
}

export async function isRepoDirty(repoDir: string): Promise<boolean> {
  const result = await git(repoDir, "status", "--porcelain");
  return result.exitCode !== 0 || !!result.stdout.trim();
}

export async function parseGitStatus(
  repoDir: string,
): Promise<{ staged: number; modified: number; untracked: number; conflicts: number }> {
  const result = await git(repoDir, "status", "--porcelain");
  if (result.exitCode !== 0) return { staged: 0, modified: 0, untracked: 0, conflicts: 0 };
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .reduce(
      (acc, line) => {
        const x = line[0];
        const y = line[1];
        if (x === "?") acc.untracked++;
        else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
          acc.conflicts++;
        } else {
          if (x !== " " && x !== "?") acc.staged++;
          if (y !== " " && y !== "?") acc.modified++;
        }
        return acc;
      },
      { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
    );
}

export async function parseGitStatusFiles(
  repoDir: string,
): Promise<{ staged: FileChange[]; unstaged: FileChange[]; untracked: string[] }> {
  const result = await git(repoDir, "status", "--porcelain");
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const untracked: string[] = [];
  if (result.exitCode !== 0) return { staged, unstaged, untracked };
  for (const line of result.stdout.split("\n").filter(Boolean)) {
    const x = line[0];
    const y = line[1];
    const file = line.slice(3);
    if (x === "?") {
      untracked.push(file);
    } else {
      if (x && x !== " " && x !== "?") staged.push({ file, type: stagedType(x) });
      if (y && y !== " " && y !== "?") unstaged.push({ file, type: unstagedType(y) });
    }
  }
  return { staged, unstaged, untracked };
}

export async function getHeadCommitDate(repoDir: string): Promise<string | null> {
  const result = await git(repoDir, "log", "-1", "--format=%aI", "HEAD");
  if (result.exitCode !== 0) return null;
  const date = result.stdout.trim();
  return date || null;
}

export async function getCommitsBetween(
  repoDir: string,
  ref1: string,
  ref2: string,
): Promise<{ hash: string; subject: string }[]> {
  const result = await git(repoDir, "log", "--oneline", `${ref1}..${ref2}`);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const spaceIdx = line.indexOf(" ");
      return {
        hash: line.slice(0, spaceIdx),
        subject: line.slice(spaceIdx + 1),
      };
    });
}

export async function getCommitsBetweenFull(
  repoDir: string,
  ref1: string,
  ref2: string,
): Promise<{ shortHash: string; fullHash: string; subject: string }[]> {
  const result = await git(repoDir, "log", "--format=%h %H %s", `${ref1}..${ref2}`);
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

export async function getDiffShortstat(
  repoDir: string,
  ref1: string,
  ref2: string,
): Promise<{ files: number; insertions: number; deletions: number } | null> {
  const result = await git(repoDir, "diff", "--shortstat", `${ref1}...${ref2}`);
  if (result.exitCode !== 0) return null;
  return parseDiffShortstat(result.stdout);
}

export async function assertMinimumGitVersion(cache: { getGitVersion(): Promise<GitVersion> }): Promise<void> {
  const version = await cache.getGitVersion();
  if (version.major < 2 || (version.major === 2 && version.minor < 17)) {
    const msg = `Arborist requires Git 2.17 or later (you have ${version.major}.${version.minor}.${version.patch}).`;
    error(msg);
    throw new ArbError(msg);
  }
}
