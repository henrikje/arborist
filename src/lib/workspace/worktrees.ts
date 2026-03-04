import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { branchExistsLocally, git, isRepoDirty, remoteBranchExists } from "../git/git";
import { GitCache } from "../git/git-cache";
import type { RepoRemotes } from "../git/remotes";
import { type FetchResult, parallelFetch } from "../sync/parallel-fetch";
import { error, inlineResult, inlineStart, warn } from "../terminal/output";
import { parseWorktreeList } from "./clean";

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

	// Phase 1: parallel fetch
	const fetchResults = new Map<string, FetchResult>();
	const reposDirsToFetch: string[] = [];

	for (const repo of repos) {
		const repoPath = `${reposDir}/${repo}`;
		if (!existsSync(`${repoPath}/.git`)) {
			fetchResults.set(repo, { repo, exitCode: 1, output: "" });
			continue;
		}
		reposDirsToFetch.push(repoPath);
	}

	if (reposDirsToFetch.length > 0) {
		const fetched = await parallelFetch(reposDirsToFetch, undefined, remotesMap);
		for (const [repo, fr] of fetched) {
			fetchResults.set(repo, fr);
		}
	}

	// Phase 2: sequential worktree creation
	process.stderr.write("Creating worktrees...\n");

	for (const repo of repos) {
		const repoPath = `${reposDir}/${repo}`;
		const fr = fetchResults.get(repo);

		if (!existsSync(`${repoPath}/.git`)) {
			error(`  [${repo}] not a git repo`);
			result.failed.push(repo);
			continue;
		}

		if (fr && fr.exitCode !== 0) {
			if (fr.exitCode === 124) {
				error(`  [${repo}] fetch timed out`);
			} else {
				error(`  [${repo}] fetch failed`);
			}
			if (fr.output) {
				for (const line of fr.output.split("\n").filter(Boolean)) {
					error(`    ${line}`);
				}
			}
			result.failed.push(repo);
			continue;
		}

		if (existsSync(`${wsDir}/${repo}`)) {
			if (isWorktreeRefValid(join(wsDir, repo))) {
				warn(`  [${repo}] already exists — skipping`);
				result.skipped.push(repo);
				continue;
			}
			// Stale worktree reference — remove and recreate below
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

		// Prune only stale worktree entries that target this workspace, to avoid
		// destroying entries belonging to other workspaces whose directories may be
		// temporarily missing (e.g. deleted by an agent). A blanket `git worktree prune`
		// would remove ALL stale entries, allowing git to reuse their names for new
		// entries — leaving orphaned `.git` files in other workspaces pointing to the
		// wrong worktree.
		await pruneWorktreeEntriesForDir(repoPath, wsDir);

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
function isWorktreeRefValid(repoDir: string): boolean {
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
async function pruneWorktreeEntriesForDir(repoPath: string, targetDir: string): Promise<void> {
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
