import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { latestCommitDate } from "../core/time";
import { git } from "../git/git";

/** Recursively find the most recent mtime (as ms) under a directory, ignoring .git entries. */
function maxMtimeRecursive(dir: string): number {
  let max = 0;
  let entries: Dirent[] | undefined;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return max;
  }
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const fullPath = join(dir, entry.name);
    try {
      const st = statSync(fullPath);
      if (st.mtimeMs > max) max = st.mtimeMs;
      if (entry.isDirectory()) {
        const childMax = maxMtimeRecursive(fullPath);
        if (childMax > max) max = childMax;
      }
    } catch {
      // skip unreadable entries
    }
  }
  return max;
}

/** Phase B: use `git ls-files` to enumerate tracked + untracked non-ignored files in a repo worktree,
 * then stat each to find the most recent mtime. Returns an ISO date string or null. */
export async function getRepoActivityDate(repoDir: string): Promise<string | null> {
  const result = await git(repoDir, "ls-files", "--cached", "--others", "--exclude-standard", "-z");
  if (result.exitCode !== 0) return null;

  const files = result.stdout.split("\0").filter(Boolean);
  let maxMs = 0;
  for (const file of files) {
    const fullPath = join(repoDir, file);
    try {
      const st = statSync(fullPath);
      if (st.mtimeMs > maxMs) maxMs = st.mtimeMs;
    } catch {
      // skip deleted/unreadable files
    }
  }
  return maxMs > 0 ? new Date(maxMs).toISOString() : null;
}

/** Compute the most recent file activity date for an entire workspace:
 *   Phase A — non-repo items at <wsDir>/ (e.g. .claude/, .arbws/): full recursive scan
 *   Phase B — repo dirs: git ls-files + stat (respects .gitignore, no artifacts)
 * Returns an ISO date string, or null if no files found. */
export async function getWorkspaceActivityDate(wsDir: string, repoDirs: string[]): Promise<string | null> {
  const repoDirSet = new Set(repoDirs);

  // Phase A: non-repo items in wsDir
  let nonRepoMaxMs = 0;
  let topEntries: Dirent[] | undefined;
  try {
    topEntries = readdirSync(wsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of topEntries) {
    const fullPath = join(wsDir, entry.name);
    if (repoDirSet.has(fullPath)) continue; // handled by Phase B
    try {
      const st = statSync(fullPath);
      if (st.mtimeMs > nonRepoMaxMs) nonRepoMaxMs = st.mtimeMs;
      if (entry.isDirectory()) {
        const childMax = maxMtimeRecursive(fullPath);
        if (childMax > nonRepoMaxMs) nonRepoMaxMs = childMax;
      }
    } catch {
      // skip
    }
  }
  const nonRepoDate = nonRepoMaxMs > 0 ? new Date(nonRepoMaxMs).toISOString() : null;

  // Phase B: per repo via git ls-files
  const repoDates = await Promise.all(repoDirs.map((dir) => getRepoActivityDate(dir)));

  return latestCommitDate([nonRepoDate, ...repoDates]);
}
