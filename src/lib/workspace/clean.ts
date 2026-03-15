import { existsSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readWorkspaceConfig, writeWorkspaceConfig } from "../core/config";
import { info, warn } from "../terminal/output";
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
 * This corruption is typically caused by copying a workspace directory (`cp -r ws-a ws-b`).
 * The copy's `.git` files point to the same canonical worktree entries as the original.
 *
 * For each repo in this workspace:
 * - If this workspace owns the entry (back-ref matches) but another workspace also
 *   references it: warn (the other workspace's stale ref will be cleaned up by
 *   `cleanupWorktreeCollisions` on the next attach).
 * - If this workspace is the stale side (back-ref points elsewhere): remove the
 *   stale `.git` file (not the directory — it may contain uncommitted work).
 *
 * After removing stale refs, if ALL repos in the workspace were stale and the workspace
 * directory name differs from the configured branch, this is a copy-and-rename. The
 * function automatically creates new worktrees on a branch matching the workspace name,
 * preserving existing files as uncommitted changes (no manual `arb attach` needed).
 */
export function detectSharedWorktreeEntries(wsDir: string, arbRootDir: string, reposDir: string): void {
  const thisWsRepos = workspaceRepoDirs(wsDir);
  if (thisWsRepos.length === 0) return;

  const thisWsName = basename(wsDir);
  const workspaces = listWorkspaces(arbRootDir);
  const staleRepos: string[] = [];

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
      // uncommitted work.
      unlinkSync(join(repoDir, ".git"));
      staleRepos.push(repoName);
    }
  }

  if (staleRepos.length === 0) return;

  // If ALL repos in the workspace were stale, this is likely a full directory copy.
  // When the workspace name differs from the configured branch, auto-repair by
  // creating worktrees on a new branch matching the workspace name.
  if (staleRepos.length === thisWsRepos.length) {
    const repaired = attemptWorkspaceCopyRepair(wsDir, arbRootDir, reposDir, staleRepos);
    if (repaired) return;
  }

  // Partial stale or repair failed — tell user to re-attach manually
  for (const repoName of staleRepos) {
    warn(
      `  [${repoName}] removed stale worktree reference (entry belongs to another workspace) — run 'arb attach ${repoName}' to re-attach`,
    );
  }
}

/**
 * Attempt automatic repair of a copied workspace. Creates worktrees on a new branch
 * derived from the workspace directory name, preserving existing files as uncommitted
 * changes via the temp-worktree transplant pattern.
 *
 * Returns true if all repos were successfully repaired.
 */
function attemptWorkspaceCopyRepair(
  wsDir: string,
  arbRootDir: string,
  reposDir: string,
  staleRepos: string[],
): boolean {
  const wsName = basename(wsDir);
  const configPath = join(wsDir, ".arbws", "config.json");
  const config = readWorkspaceConfig(configPath);
  if (!config) return false;

  const oldBranch = config.branch;

  // If the workspace name matches the configured branch, we can't derive a new name
  if (wsName === oldBranch) return false;

  // Validate the workspace name is a valid branch name
  const checkResult = Bun.spawnSync(["git", "check-ref-format", "--branch", wsName]);
  if (checkResult.exitCode !== 0) return false;

  const newBranch = wsName;
  const repaired: string[] = [];

  for (const repoName of staleRepos) {
    const repoDir = join(wsDir, repoName);
    const canonicalDir = join(reposDir, repoName);
    if (!existsSync(join(canonicalDir, ".git"))) continue;

    if (repairCopiedRepo(repoDir, canonicalDir, oldBranch, newBranch)) {
      repaired.push(repoName);
    }
  }

  if (repaired.length !== staleRepos.length) {
    // Partial repair — revert by removing .git files from repaired repos so
    // user gets consistent "run arb attach" guidance for all repos
    for (const repoName of repaired) {
      const gitFile = join(wsDir, repoName, ".git");
      try {
        unlinkSync(gitFile);
      } catch {}
    }
    return false;
  }

  // All repos repaired — update the workspace config to the new branch
  writeWorkspaceConfig(configPath, { ...config, branch: newBranch });

  info(`  Detected copied workspace — repaired as '${newBranch}' (branched from '${oldBranch}')`);
  for (const repoName of repaired) {
    info(`  [${repoName}] re-linked on branch ${newBranch}`);
  }

  // Clean up stale .git files in other workspaces that now point to our new entries
  for (const repoName of repaired) {
    cleanupWorktreeCollisionsSync(wsDir, repoName, arbRootDir);
  }

  return true;
}

/**
 * Repair a single repo in a copied workspace by creating a new worktree on the
 * new branch, then transplanting the .git file to the real directory.
 */
function repairCopiedRepo(repoDir: string, canonicalDir: string, oldBranch: string, newBranch: string): boolean {
  const tmpPath = `${repoDir}.__arb_relink__`;

  // Clean up leftover temp dir from a previously interrupted repair
  if (existsSync(tmpPath)) rmSync(tmpPath, { recursive: true });

  // Remove any stale worktree entries that reference the temp path
  removeWorktreeEntriesForPathSync(canonicalDir, tmpPath);

  // Try creating a new branch from the old branch
  let result = Bun.spawnSync(
    ["git", "worktree", "add", "--no-checkout", "--no-track", "-b", newBranch, tmpPath, oldBranch],
    { cwd: canonicalDir, stdout: "ignore", stderr: "pipe" },
  );

  if (result.exitCode !== 0) {
    // Branch may already exist (previous partial repair) — try attaching to it
    result = Bun.spawnSync(["git", "worktree", "add", "--no-checkout", tmpPath, newBranch], {
      cwd: canonicalDir,
      stdout: "ignore",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      if (existsSync(tmpPath)) rmSync(tmpPath, { recursive: true });
      return false;
    }
  }

  // Transplant the .git file from the temp worktree to the real directory
  if (!transplantGitFile(tmpPath, repoDir)) {
    Bun.spawnSync(["git", "worktree", "remove", "--force", tmpPath], {
      cwd: canonicalDir,
      stdout: "ignore",
      stderr: "ignore",
    });
    return false;
  }

  return true;
}

/**
 * Transplant a worktree's `.git` reference from a temporary path to the real
 * directory. Updates the canonical entry's back-reference, writes the `.git` file
 * to the real path, and removes the temp directory.
 */
function transplantGitFile(tmpPath: string, realPath: string): boolean {
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

  // Step 3: Remove the temp directory (best-effort)
  rmSync(tmpPath, { recursive: true, force: true });

  return true;
}

/**
 * Remove worktree entries whose back-reference points to `targetPath/.git`.
 * Sync version for use in repair paths.
 */
function removeWorktreeEntriesForPathSync(repoPath: string, targetPath: string): void {
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
 * Clean up stale `.git` files in other workspaces that point to the same worktree
 * entry as the given repo. Sync version for use in repair paths.
 */
function cleanupWorktreeCollisionsSync(wsDir: string, repoName: string, arbRootDir: string): void {
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
