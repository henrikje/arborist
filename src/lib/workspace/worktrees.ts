import { existsSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  branchExistsLocally,
  branchInWorktreeCaseInsensitive,
  git,
  isCaseInsensitiveFS,
  isRepoDirty,
  remoteBranchExists,
} from "../git/git";
import { GitCache } from "../git/git-cache";
import type { RepoRemotes } from "../git/remotes";
import { error, inlineResult, inlineStart, warn } from "../terminal/output";
import { parseWorktreeList, readGitdirFromWorktree } from "./clean";
import { listWorkspaces } from "./repos";

export interface AddWorktreesResult {
  created: string[];
  skipped: string[];
  failed: string[];
  createdBranches: string[];
}

export async function addWorktrees(
  name: string,
  branch: string,
  repos: string[],
  reposDir: string,
  arbRootDir: string,
  baseBranch?: string,
  remotesMap?: Map<string, RepoRemotes>,
  cache?: GitCache,
): Promise<AddWorktreesResult> {
  const c = cache ?? new GitCache();
  const wsDir = `${arbRootDir}/${name}`;
  const result: AddWorktreesResult = { created: [], skipped: [], failed: [], createdBranches: [] };

  process.stderr.write("Creating worktrees...\n");

  for (const repo of repos) {
    const repoPath = `${reposDir}/${repo}`;

    if (!existsSync(`${repoPath}/.git`)) {
      error(`  [${repo}] not a git repo`);
      result.failed.push(repo);
      continue;
    }

    let needsRelink = false;
    if (existsSync(`${wsDir}/${repo}`)) {
      if (isWorktreeRefValid(join(wsDir, repo))) {
        warn(`  [${repo}] already exists — skipping`);
        result.skipped.push(repo);
        continue;
      }
      // Stale worktree reference — check if directory has user files
      const entries = readdirSync(`${wsDir}/${repo}`).filter((e) => e !== ".git");
      if (entries.length > 0) {
        // Directory has user files — will re-link in place using a temp worktree
        warn(`  [${repo}] re-linking stale worktree in place — existing files will appear as uncommitted changes`);
        const staleGitFile = join(wsDir, repo, ".git");
        if (existsSync(staleGitFile)) unlinkSync(staleGitFile);
        removeWorktreeEntriesForPath(repoPath, `${wsDir}/${repo}`);
        // Clean up leftover temp dir from a previously interrupted re-link
        const tmpPath = `${wsDir}/${repo}.__arb_relink__`;
        if (existsSync(tmpPath)) rmSync(tmpPath, { recursive: true });
        needsRelink = true;
      } else {
        // Empty directory (or just .git) — safe to remove and recreate
        warn(`  [${repo}] stale worktree reference — recreating`);
        rmSync(`${wsDir}/${repo}`, { recursive: true });
      }
    }

    if (await isRepoDirty(repoPath)) {
      warn(`  [${repo}] canonical repo has uncommitted changes`);
    }

    // Resolve remote names for this repo
    const repoRemotes = remotesMap?.get(repo);
    const baseRemote = repoRemotes?.base;
    const shareRemote = repoRemotes?.share;

    let effectiveBase: string | null;
    if (baseBranch) {
      const baseExists = baseRemote ? await remoteBranchExists(repoPath, baseBranch, baseRemote) : false;
      if (baseExists) {
        effectiveBase = baseBranch;
      } else if (baseRemote) {
        effectiveBase = await c.getDefaultBranch(repoPath, baseRemote);
        if (effectiveBase) {
          warn(`  [${repo}] base branch '${baseBranch}' not found — using '${effectiveBase}'`);
        } else {
          error(`  [${repo}] base branch '${baseBranch}' not found and could not determine default branch`);
          result.failed.push(repo);
          continue;
        }
      } else {
        error(`  [${repo}] could not determine base remote`);
        result.failed.push(repo);
        continue;
      }
    } else if (baseRemote) {
      effectiveBase = await c.getDefaultBranch(repoPath, baseRemote);
      if (!effectiveBase) {
        error(`  [${repo}] could not determine default branch`);
        result.failed.push(repo);
        continue;
      }
    } else {
      error(`  [${repo}] could not determine base remote`);
      result.failed.push(repo);
      continue;
    }

    const branchExists = await branchExistsLocally(repoPath, branch);

    // When re-linking, create the worktree at a temp path so we can transplant
    // the .git file back to the real directory without touching user files.
    const wtTarget = needsRelink ? `${wsDir}/${repo}.__arb_relink__` : `${wsDir}/${repo}`;

    // Remove the specific stale worktree entry at the exact path we're about to
    // use, if one exists. This is more surgical than pruning all stale entries in
    // the workspace — it only removes the single entry that would block the
    // upcoming `git worktree add`.
    await removeStaleEntryAtPath(repoPath, wtTarget);

    // When re-linking, skip checkout — we only need the worktree entry and .git
    // file, not a full working tree (the real directory already has files).
    const noCheckout = needsRelink ? ["--no-checkout"] : [];

    if (branchExists) {
      // On case-insensitive FS, git may not detect case-variant branch collisions.
      // Check if a case-variant of this branch is already in a worktree.
      if (await isCaseInsensitiveFS(repoPath)) {
        const conflicting = await branchInWorktreeCaseInsensitive(repoPath, branch);
        if (conflicting && conflicting.branch !== branch) {
          inlineStart(repo, `attaching branch ${branch}`);
          inlineResult(repo, "failed");
          const msg = `fatal: '${branch}' is already checked out at '${conflicting.worktreePath}'`;
          error(`    ${formatWorktreeError(msg, arbRootDir)}`);
          result.failed.push(repo);
          continue;
        }
      }
      inlineStart(repo, `attaching branch ${branch}`);
      const wt = await git(repoPath, "worktree", "add", ...noCheckout, wtTarget, branch);
      if (wt.exitCode !== 0) {
        inlineResult(repo, "failed");
        const errText = wt.stderr.trim();
        if (errText) error(`    ${formatWorktreeError(errText, arbRootDir)}`);
        result.failed.push(repo);
        continue;
      }
      inlineResult(repo, `branch ${branch} attached`);
    } else if (shareRemote && (await remoteBranchExists(repoPath, branch, shareRemote))) {
      const startPoint = `${shareRemote}/${branch}`;
      inlineStart(repo, `checking out branch ${branch} from ${startPoint}`);
      const wt = await git(repoPath, "worktree", "add", ...noCheckout, "--track", "-b", branch, wtTarget, startPoint);
      if (wt.exitCode !== 0) {
        inlineResult(repo, "failed");
        const errText = wt.stderr.trim();
        if (errText) error(`    ${formatWorktreeError(errText, arbRootDir)}`);
        result.failed.push(repo);
        continue;
      }
      inlineResult(repo, `branch ${branch} checked out from ${startPoint}`);
      result.createdBranches.push(repo);
    } else {
      const startPoint = baseRemote ? `${baseRemote}/${effectiveBase}` : effectiveBase;
      inlineStart(repo, `creating branch ${branch} from ${startPoint}`);
      // Prevent git from auto-setting tracking config (branch.autoSetupMerge) when
      // branching from a remote ref. We rely on tracking config being absent for fresh
      // branches and present only after `arb push -u`, so we can detect "gone" branches
      // (pushed, merged, remote branch deleted) vs never-pushed branches.
      const wt = await git(
        repoPath,
        "worktree",
        "add",
        ...noCheckout,
        "--no-track",
        "-b",
        branch,
        wtTarget,
        startPoint,
      );
      if (wt.exitCode !== 0) {
        inlineResult(repo, "failed");
        const errText = wt.stderr.trim();
        if (errText) error(`    ${formatWorktreeError(errText, arbRootDir)}`);
        result.failed.push(repo);
        continue;
      }
      inlineResult(repo, `branch ${branch} created from ${startPoint}`);
      result.createdBranches.push(repo);
    }

    // Transplant the .git file from the temp worktree to the real directory
    if (needsRelink) {
      if (!relinkWorktreeInPlace(wtTarget, `${wsDir}/${repo}`)) {
        error(`  [${repo}] failed to re-link worktree in place`);
        await git(repoPath, "worktree", "remove", "--force", wtTarget);
        result.failed.push(repo);
        continue;
      }
    }

    // After creating the worktree, clean up stale `.git` files in other workspaces
    // that now accidentally point to the same entry due to git reusing entry names.
    cleanupWorktreeCollisions(wsDir, repo, arbRootDir);

    result.created.push(repo);
  }

  return result;
}

/**
 * Check if a worktree directory's `.git` file points to a valid worktree entry
 * that points back to this directory. Returns false if:
 * - The `.git` file is missing or malformed
 * - The worktree entry it references doesn't exist
 * - The worktree entry's back-reference (`gitdir` file) doesn't match
 */
export function isWorktreeRefValid(repoDir: string): boolean {
  const gitPath = join(repoDir, ".git");
  try {
    const content = readFileSync(gitPath, "utf-8").trim();
    if (!content.startsWith("gitdir: ")) return false;
    const gitdirPath = content.slice("gitdir: ".length);

    // Check that the worktree entry exists and points back to us
    const backRefPath = join(gitdirPath, "gitdir");
    const backRef = readFileSync(backRefPath, "utf-8").trim();
    return backRef === gitPath;
  } catch {
    return false;
  }
}

/**
 * Prune only stale worktree entries whose target paths fall inside `targetDir`.
 * Unlike `git worktree prune` (which removes ALL stale entries globally), this
 * limits pruning to entries belonging to a specific workspace directory. This
 * prevents accidentally destroying entries for other workspaces whose directories
 * may be temporarily missing.
 */
export async function pruneWorktreeEntriesForDir(repoPath: string, targetDir: string): Promise<void> {
  const listResult = await git(repoPath, "worktree", "list", "--porcelain");
  if (listResult.exitCode !== 0) return;

  const paths = parseWorktreeList(listResult.stdout);
  for (const wtPath of paths) {
    // Skip the main worktree (the canonical repo itself)
    if (wtPath === repoPath) continue;
    // Only consider entries targeting this workspace directory
    if (!wtPath.startsWith(`${targetDir}/`)) continue;
    // If the target still exists on disk, it's not stale
    if (existsSync(wtPath)) continue;
    // Stale entry for this workspace — remove it
    await git(repoPath, "worktree", "remove", "--force", wtPath);
  }
}

/**
 * Remove the specific stale worktree entry at an exact target path, if one exists.
 * Unlike `pruneWorktreeEntriesForDir` (which scans all entries in a workspace dir),
 * this only checks for and removes the single entry at the given path.
 *
 * Returns true if a stale entry was found and removed.
 */
async function removeStaleEntryAtPath(repoPath: string, targetPath: string): Promise<boolean> {
  if (existsSync(targetPath)) return false;

  const listResult = await git(repoPath, "worktree", "list", "--porcelain");
  if (listResult.exitCode !== 0) return false;

  const paths = parseWorktreeList(listResult.stdout);
  for (const wtPath of paths) {
    if (wtPath === repoPath) continue;
    if (wtPath === targetPath) {
      await git(repoPath, "worktree", "remove", "--force", wtPath);
      return true;
    }
  }
  return false;
}

/**
 * Remove worktree entries in the canonical repo whose `gitdir` back-reference
 * points to `targetPath/.git`. Unlike `removeStaleEntryAtPath` (which bails when
 * the target directory exists on disk), this operates on the entry's content and
 * works even when the target directory is present but has a missing/stale `.git`.
 */
function removeWorktreeEntriesForPath(repoPath: string, targetPath: string): void {
  const worktreesDir = join(repoPath, ".git", "worktrees");
  let entries: string[];
  try {
    entries = readdirSync(worktreesDir);
  } catch {
    return;
  }

  const targetGitPath = join(targetPath, ".git");
  for (const entry of entries) {
    const entryDir = join(worktreesDir, entry);
    const gitdirFile = join(entryDir, "gitdir");
    try {
      const content = readFileSync(gitdirFile, "utf-8").trim();
      if (content === targetGitPath) {
        rmSync(entryDir, { recursive: true });
      }
    } catch {}
  }
}

/**
 * Transplant a worktree's `.git` reference from a temporary path to the real
 * directory. Updates the canonical repo's back-reference first (safe ordering:
 * the temp worktree remains functional if the second write fails), then writes
 * the `.git` file into the real directory, and finally removes the temp directory.
 */
function relinkWorktreeInPlace(tmpPath: string, realPath: string): boolean {
  const tmpGitFile = join(tmpPath, ".git");
  const realGitFile = join(realPath, ".git");

  let gitdirContent: string;
  try {
    gitdirContent = readFileSync(tmpGitFile, "utf-8").trim();
  } catch {
    return false;
  }
  if (!gitdirContent.startsWith("gitdir: ")) return false;

  const entryDir = gitdirContent.slice("gitdir: ".length);
  const gitdirBackRef = join(entryDir, "gitdir");

  // Step 1: Update the canonical entry's back-reference to point to the real path.
  // Safe to do first — the temp worktree still has its .git file.
  try {
    writeFileSync(gitdirBackRef, `${realGitFile}\n`);
  } catch {
    return false;
  }

  // Step 2: Write the .git file into the real directory.
  try {
    writeFileSync(realGitFile, `${gitdirContent}\n`);
  } catch {
    // Revert step 1 so the temp worktree stays functional
    try {
      writeFileSync(gitdirBackRef, `${tmpGitFile}\n`);
    } catch {}
    return false;
  }

  // Step 3: Remove the temp directory (best-effort — the re-link is already done)
  rmSync(tmpPath, { recursive: true, force: true });

  return true;
}

/**
 * After creating a worktree, check all other workspaces for stale `.git` files
 * that now accidentally point to the same worktree entry (due to git reusing
 * the entry name after a previous entry was pruned). Remove any such stale
 * references to prevent shared-entry corruption.
 */
function cleanupWorktreeCollisions(wsDir: string, repoName: string, arbRootDir: string): void {
  const myRepoDir = join(wsDir, repoName);
  const myGitdir = readGitdirFromWorktree(myRepoDir);
  if (!myGitdir) return;

  const thisWsName = basename(wsDir);
  for (const ws of listWorkspaces(arbRootDir)) {
    if (ws === thisWsName) continue;
    const otherRepoDir = join(arbRootDir, ws, repoName);
    if (otherRepoDir === myRepoDir) continue;
    const otherGitdir = readGitdirFromWorktree(otherRepoDir);
    if (otherGitdir && otherGitdir === myGitdir) {
      unlinkSync(join(otherRepoDir, ".git"));
      warn(`  [${repoName}] removed stale reference in ${ws}/${repoName}`);
    }
  }
}

/**
 * Parse a git worktree error and return a user-friendly message.
 * If the error matches a known pattern (branch already checked out),
 * returns a message with the workspace name. Otherwise returns the
 * original error text unchanged.
 */
export function formatWorktreeError(stderr: string, arbRootDir: string): string {
  // git uses "is already used by worktree at" (older) or "is already checked out at" (newer)
  const match = stderr.match(/fatal: '([^']+)' is already (?:used by worktree|checked out) at '([^']+)'/);
  if (!match?.[1] || !match[2]) return stderr;

  const branch = match[1];
  const worktreePath = match[2];
  const prefix = `${arbRootDir}/`;
  if (!worktreePath.startsWith(prefix)) {
    return `Branch '${branch}' is already checked out at ${worktreePath}`;
  }

  // Path is <arbRootDir>/<workspace>/<repo> — extract workspace name
  const relative = worktreePath.slice(prefix.length);
  const workspace = relative.split("/")[0];
  if (workspace) {
    return `Branch '${branch}' is already checked out in workspace '${workspace}'`;
  }
  return stderr;
}

/**
 * Roll back worktrees created by `addWorktrees()`. Removes each successfully
 * created worktree, deletes newly created local branches, and removes the
 * workspace directory. Resilient — logs warnings on individual cleanup failures.
 */
export async function rollbackWorktrees(
  result: AddWorktreesResult,
  branch: string,
  reposDir: string,
  wsDir: string,
): Promise<void> {
  const createdSet = new Set(result.createdBranches);

  for (const repo of result.created) {
    const repoPath = `${reposDir}/${repo}`;
    try {
      await git(repoPath, "worktree", "remove", "--force", `${wsDir}/${repo}`);
    } catch {
      warn(`  [${repo}] failed to remove worktree during rollback`);
    }

    if (createdSet.has(repo)) {
      try {
        await git(repoPath, "branch", "-D", branch);
      } catch {
        warn(`  [${repo}] failed to delete branch '${branch}' during rollback`);
      }
    }

    try {
      await git(repoPath, "worktree", "prune");
    } catch {
      // Pruning is best-effort
    }
  }

  rmSync(wsDir, { recursive: true, force: true });
}
