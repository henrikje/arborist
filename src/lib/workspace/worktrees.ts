import { existsSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { branchExistsLocally, git, isRepoDirty, remoteBranchExists } from "../git/git";
import { GitCache } from "../git/git-cache";
import type { RepoRemotes } from "../git/remotes";
import { error, inlineResult, inlineStart, warn } from "../terminal/output";
import { parseWorktreeList, readGitdirFromWorktree } from "./clean";
import { listWorkspaces } from "./repos";

export interface AddWorktreesResult {
	created: string[];
	skipped: string[];
	failed: string[];
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
	const result: AddWorktreesResult = { created: [], skipped: [], failed: [] };

	process.stderr.write("Creating worktrees...\n");

	for (const repo of repos) {
		const repoPath = `${reposDir}/${repo}`;

		if (!existsSync(`${repoPath}/.git`)) {
			error(`  [${repo}] not a git repo`);
			result.failed.push(repo);
			continue;
		}

		if (existsSync(`${wsDir}/${repo}`)) {
			if (isWorktreeRefValid(join(wsDir, repo))) {
				warn(`  [${repo}] already exists — skipping`);
				result.skipped.push(repo);
				continue;
			}
			// Stale worktree reference — check if directory has user files
			const entries = readdirSync(`${wsDir}/${repo}`).filter((e) => e !== ".git");
			if (entries.length > 0) {
				error(
					`  [${repo}] directory exists with stale worktree reference and contains files — remove it manually or back up your changes first`,
				);
				result.failed.push(repo);
				continue;
			}
			// Empty directory (or just .git) — safe to remove and recreate
			warn(`  [${repo}] stale worktree reference — recreating`);
			rmSync(`${wsDir}/${repo}`, { recursive: true });
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

		// Remove the specific stale worktree entry at the exact path we're about to
		// use, if one exists. This is more surgical than pruning all stale entries in
		// the workspace — it only removes the single entry that would block the
		// upcoming `git worktree add`.
		await removeStaleEntryAtPath(repoPath, `${wsDir}/${repo}`);

		if (branchExists) {
			inlineStart(repo, `attaching branch ${branch}`);
			const wt = await git(repoPath, "worktree", "add", `${wsDir}/${repo}`, branch);
			if (wt.exitCode !== 0) {
				inlineResult(repo, "failed");
				const errText = wt.stderr.trim();
				if (errText) error(`    ${errText}`);
				result.failed.push(repo);
				continue;
			}
			inlineResult(repo, `branch ${branch} attached`);
		} else if (shareRemote && (await remoteBranchExists(repoPath, branch, shareRemote))) {
			const startPoint = `${shareRemote}/${branch}`;
			inlineStart(repo, `checking out branch ${branch} from ${startPoint}`);
			const wt = await git(repoPath, "worktree", "add", "--track", "-b", branch, `${wsDir}/${repo}`, startPoint);
			if (wt.exitCode !== 0) {
				inlineResult(repo, "failed");
				const errText = wt.stderr.trim();
				if (errText) error(`    ${errText}`);
				result.failed.push(repo);
				continue;
			}
			inlineResult(repo, `branch ${branch} checked out from ${startPoint}`);
		} else {
			const startPoint = baseRemote ? `${baseRemote}/${effectiveBase}` : effectiveBase;
			inlineStart(repo, `creating branch ${branch} from ${startPoint}`);
			// Prevent git from auto-setting tracking config (branch.autoSetupMerge) when
			// branching from a remote ref. We rely on tracking config being absent for fresh
			// branches and present only after `arb push -u`, so we can detect "gone" branches
			// (pushed, merged, remote branch deleted) vs never-pushed branches.
			const wt = await git(repoPath, "worktree", "add", "--no-track", "-b", branch, `${wsDir}/${repo}`, startPoint);
			if (wt.exitCode !== 0) {
				inlineResult(repo, "failed");
				const errText = wt.stderr.trim();
				if (errText) error(`    ${errText}`);
				result.failed.push(repo);
				continue;
			}
			inlineResult(repo, `branch ${branch} created from ${startPoint}`);
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
