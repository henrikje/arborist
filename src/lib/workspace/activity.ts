import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gitLocal } from "../git/git";

/** Result of an activity-date probe: the ISO date and the file that determined it. */
export interface ActivityResult {
  date: string;
  file: string;
}

/** Recursively find the most recent mtime (as ms) under a directory, ignoring .git entries. */
function maxMtimeRecursive(dir: string): { ms: number; file: string | null } {
  let max = 0;
  let maxFile: string | null = null;
  let entries: Dirent[] | undefined;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { ms: max, file: maxFile };
  }
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const fullPath = join(dir, entry.name);
    try {
      const st = statSync(fullPath);
      if (st.mtimeMs > max) {
        max = st.mtimeMs;
        maxFile = fullPath;
      }
      if (entry.isDirectory()) {
        const child = maxMtimeRecursive(fullPath);
        if (child.ms > max) {
          max = child.ms;
          maxFile = child.file;
        }
      }
    } catch {
      // skip unreadable entries
    }
  }
  return { ms: max, file: maxFile };
}

/** Phase B: use `git ls-files` to enumerate tracked + untracked non-ignored files in a repo worktree,
 * then stat each to find the most recent mtime. Returns the date and the file that determined it. */
export async function getRepoActivityDate(repoDir: string): Promise<ActivityResult | null> {
  const result = await gitLocal(repoDir, "ls-files", "--cached", "--others", "--exclude-standard", "-z");
  if (result.exitCode !== 0) return null;

  const files = result.stdout.split("\0").filter(Boolean);
  let maxMs = 0;
  let maxFile: string | null = null;
  for (const file of files) {
    const fullPath = join(repoDir, file);
    try {
      const st = statSync(fullPath);
      if (st.mtimeMs > maxMs) {
        maxMs = st.mtimeMs;
        maxFile = fullPath;
      }
    } catch {
      // skip deleted/unreadable files
    }
  }
  return maxMs > 0 && maxFile ? { date: new Date(maxMs).toISOString(), file: maxFile } : null;
}

/** Compute the most recent file activity date for an entire workspace:
 *   Phase A — non-repo items at <wsDir>/ (e.g. .claude/), excluding .arbws/ (arb infrastructure): full recursive scan
 *   Phase B — repo dirs: git ls-files + stat (respects .gitignore, no artifacts)
 * Returns the date and the file that determined it, or null if no files found. */
export async function getWorkspaceActivityDate(wsDir: string, repoDirs: string[]): Promise<ActivityResult | null> {
  const repoDirSet = new Set(repoDirs);

  // Phase A: non-repo items in wsDir
  let nonRepoMaxMs = 0;
  let nonRepoMaxFile: string | null = null;
  let topEntries: Dirent[] | undefined;
  try {
    topEntries = readdirSync(wsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of topEntries) {
    const fullPath = join(wsDir, entry.name);
    if (repoDirSet.has(fullPath)) continue; // handled by Phase B
    if (entry.name === ".arbws") continue; // arb infrastructure, not user activity
    try {
      const st = statSync(fullPath);
      if (st.mtimeMs > nonRepoMaxMs) {
        nonRepoMaxMs = st.mtimeMs;
        nonRepoMaxFile = fullPath;
      }
      if (entry.isDirectory()) {
        const child = maxMtimeRecursive(fullPath);
        if (child.ms > nonRepoMaxMs) {
          nonRepoMaxMs = child.ms;
          nonRepoMaxFile = child.file;
        }
      }
    } catch {
      // skip
    }
  }
  const nonRepoResult: ActivityResult | null =
    nonRepoMaxMs > 0 && nonRepoMaxFile ? { date: new Date(nonRepoMaxMs).toISOString(), file: nonRepoMaxFile } : null;

  // Phase B: per repo via git ls-files
  const repoResults = await Promise.all(repoDirs.map((dir) => getRepoActivityDate(dir)));

  // Find the overall winner across all results
  let best: ActivityResult | null = nonRepoResult;
  for (const r of repoResults) {
    if (!r) continue;
    if (!best || r.date > best.date) best = r;
  }
  return best;
}
