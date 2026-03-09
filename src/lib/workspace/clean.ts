import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { warn } from "../terminal/output";
import { listRepos, listWorkspaces, workspaceRepoDirs } from "./repos";

/**
 * Read a worktree's `.git` file and extract the gitdir path.
 * Returns null if the file doesn't exist or isn't a valid gitdir reference.
 */
export function readGitdirFromWorktree(repoDir: string): string | null {
  const gitPath = join(repoDir, ".git");
  try {
    const content = readFileSync(gitPath, "utf-8").trim();
    if (content.startsWith("gitdir: ")) {
      return content.slice("gitdir: ".length);
    }
  } catch {}
  return null;
}

/**
 * Read the `gitdir` file inside a canonical repo's worktree entry.
 * Returns the absolute path the canonical repo thinks the worktree lives at.
 */
function readGitdirBackRef(worktreeEntryDir: string): string | null {
  const gitdirFile = join(worktreeEntryDir, "gitdir");
  try {
    const content = readFileSync(gitdirFile, "utf-8").trim();
    return content || null;
  } catch {}
  return null;
}

/**
 * Extract the old project root from a gitdir path by finding the `/.arb/repos/`
 * segment. Returns null if the segment is not found.
 */
function extractOldProjectRoot(gitdirPath: string): string | null {
  const marker = "/.arb/repos/";
  const idx = gitdirPath.lastIndexOf(marker);
  if (idx === -1) return null;
  return gitdirPath.slice(0, idx);
}

/**
 * Detect if the project directory has been moved by comparing old project roots
 * (embedded in worktree forward refs) with the current project root.
 * Returns the old root if a move is detected, null otherwise.
 *
 * Safety: only reports a move if the old root does NOT exist on disk, avoiding
 * false positives from symlink setups.
 */
function detectProjectMove(wsDir: string, arbRootDir: string): string | null {
  const repoDirs = workspaceRepoDirs(wsDir);
  for (const repoDir of repoDirs) {
    const gitdirPath = readGitdirFromWorktree(repoDir);
    if (!gitdirPath) continue;

    const oldRoot = extractOldProjectRoot(gitdirPath);
    if (!oldRoot) continue;
    if (oldRoot === arbRootDir) continue;

    if (!existsSync(oldRoot)) {
      return oldRoot;
    }
  }
  return null;
}

/**
 * Repair all worktree references after a project directory move. Iterates every
 * canonical repo's worktree entries, computes the new worktree path by replacing
 * the old root with the current root, and runs `git worktree repair` to fix both
 * forward and backward refs.
 */
function repairProjectMove(arbRootDir: string, reposDir: string, oldRoot: string): void {
  for (const repo of listRepos(reposDir)) {
    const repoDir = join(reposDir, repo);
    const worktreesDir = join(repoDir, ".git", "worktrees");
    let entries: string[];
    try {
      entries = readdirSync(worktreesDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryDir = join(worktreesDir, entry);
      const backRef = readGitdirBackRef(entryDir);
      if (!backRef) continue;
      if (!backRef.startsWith(oldRoot)) continue;

      const newGitPath = arbRootDir + backRef.slice(oldRoot.length);
      const gitSuffix = "/.git";
      const worktreeDir = newGitPath.endsWith(gitSuffix) ? newGitPath.slice(0, -gitSuffix.length) : newGitPath;

      if (!existsSync(worktreeDir)) continue;

      Bun.spawnSync(["git", "worktree", "repair", worktreeDir], {
        cwd: repoDir,
        stdout: "ignore",
        stderr: "ignore",
      });
    }
  }
}

/**
 * Detect and repair broken worktree references caused by moving the entire project
 * directory. Must be called BEFORE `repairWorktreeRefs()` since forward refs are
 * also broken in this scenario.
 *
 * Detection: reads a worktree's `.git` file, extracts the old project root from the
 * `/.arb/repos/` segment, and compares with the current root. Only acts if the old
 * root does not exist on disk (safety constraint for symlink setups).
 *
 * Repair: iterates all canonical repo worktree entries, computes new paths, and runs
 * `git worktree repair` to fix both forward and backward refs.
 */
export function detectAndRepairProjectMove(wsDir: string, arbRootDir: string, reposDir: string): void {
  const oldRoot = detectProjectMove(wsDir, arbRootDir);
  if (!oldRoot) return;
  repairProjectMove(arbRootDir, reposDir, oldRoot);
}

/**
 * Check if a workspace's worktree references are stale (e.g. after manual `mv`)
 * and repair them silently. Pure filesystem reads for detection; only spawns
 * `git worktree repair` when a mismatch is found.
 *
 * After a manual `mv`, the forward reference (worktree `.git` → canonical) survives
 * but the backward reference (canonical `gitdir` → worktree) still points to the old
 * path. This function detects the mismatch and repairs it.
 */
export function repairWorktreeRefs(wsDir: string, reposDir: string): void {
  const repoDirs = workspaceRepoDirs(wsDir);
  for (const repoDir of repoDirs) {
    const gitdirPath = readGitdirFromWorktree(repoDir);
    if (!gitdirPath) continue;

    const backRef = readGitdirBackRef(gitdirPath);
    if (!backRef) continue;

    const expectedGitPath = join(repoDir, ".git");
    if (backRef === expectedGitPath) continue;

    // The back-ref doesn't match this workspace repo. If the back-ref target
    // still exists on disk, another workspace legitimately owns this worktree
    // entry — do NOT repair (repairing would steal the entry from the other
    // workspace). This is a shared-entry corruption, not a moved workspace.
    if (existsSync(backRef)) continue;

    // Mismatch and the original location is gone — workspace was moved. Repair it.
    const repoName = basename(repoDir);
    const canonicalRepoDir = join(reposDir, repoName);
    if (existsSync(canonicalRepoDir)) {
      Bun.spawnSync(["git", "worktree", "repair", repoDir], {
        cwd: canonicalRepoDir,
        stdout: "ignore",
        stderr: "ignore",
      });
    }
  }
}

/**
 * Detect when multiple workspace repos reference the same canonical worktree entry,
 * and auto-repair when the current workspace is the stale side.
 *
 * This corruption is typically caused by a worktree entry being pruned and its name
 * reused while another workspace still holds a stale `.git` reference.
 *
 * For each repo in this workspace:
 * - If this workspace owns the entry (back-ref matches) but another workspace also
 *   references it: warn (the other workspace's stale ref will be cleaned up by
 *   `cleanupWorktreeCollisions` on the next attach).
 * - If this workspace is the stale side (back-ref points elsewhere): remove the
 *   stale `.git` file (not the directory — it may contain uncommitted work) so
 *   it can be re-attached cleanly.
 */
export function detectSharedWorktreeEntries(wsDir: string, arbRootDir: string): void {
  const thisWsRepos = workspaceRepoDirs(wsDir);
  if (thisWsRepos.length === 0) return;

  const thisWsName = basename(wsDir);
  const workspaces = listWorkspaces(arbRootDir);

  for (const repoDir of thisWsRepos) {
    const gitdirPath = readGitdirFromWorktree(repoDir);
    if (!gitdirPath) continue;

    const backRef = readGitdirBackRef(gitdirPath);
    if (!backRef) continue;

    const expectedGitPath = join(repoDir, ".git");
    const repoName = basename(repoDir);

    if (backRef === expectedGitPath) {
      // This workspace owns the entry. Check if another workspace also
      // points to it (the other workspace has a stale forward-ref).
      for (const ws of workspaces) {
        if (ws === thisWsName) continue;
        const otherRepoDir = join(arbRootDir, ws, repoName);
        const otherGitdir = readGitdirFromWorktree(otherRepoDir);
        if (otherGitdir && otherGitdir === gitdirPath) {
          warn(
            `  [${repoName}] worktree entry shared with ${ws}/${repoName} — stale reference will be cleaned on next attach`,
          );
        }
      }
    } else if (existsSync(backRef)) {
      // The back-ref points to another workspace that still exists on disk.
      // This workspace is the stale side — remove only the `.git` file to
      // break the shared link. Keep the directory intact in case it contains
      // uncommitted work. The repo can be re-attached with `arb attach`.
      unlinkSync(join(repoDir, ".git"));
      warn(
        `  [${repoName}] removed stale worktree reference (entry belongs to another workspace) — run 'arb attach ${repoName}' to re-attach`,
      );
    }
  }
}

/** Parse `git worktree list --porcelain` stdout into an array of worktree paths. */
export function parseWorktreeList(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.push(line.slice("worktree ".length));
    }
  }
  return paths;
}
