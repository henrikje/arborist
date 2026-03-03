import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectBranchMerged, git } from "../git/git";
import type { GitCache } from "../git/git-cache";
import { listRepos } from "./repos";

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

export async function findStaleWorktrees(reposDir: string): Promise<string[]> {
	const repos = listRepos(reposDir);
	const stale: string[] = [];
	for (const repo of repos) {
		const repoDir = join(reposDir, repo);
		const result = await git(repoDir, "worktree", "list", "--porcelain");
		if (result.exitCode !== 0) continue;
		const paths = parseWorktreeList(result.stdout);
		for (const wtPath of paths) {
			// The first entry is the main worktree (the canonical repo itself) — skip it
			if (wtPath === repoDir) continue;
			if (!existsSync(wtPath)) {
				stale.push(repo);
				break;
			}
		}
	}
	return stale;
}

export async function pruneWorktrees(reposDir: string): Promise<void> {
	const repos = listRepos(reposDir);
	for (const repo of repos) {
		await git(join(reposDir, repo), "worktree", "prune");
	}
}

export async function findOrphanedBranches(
	reposDir: string,
	workspaceBranches: Set<string>,
	cache: GitCache,
): Promise<{ repo: string; branch: string; mergeStatus: "merged" | "unmerged"; aheadCount: number }[]> {
	const repos = listRepos(reposDir);
	const orphaned: { repo: string; branch: string; mergeStatus: "merged" | "unmerged"; aheadCount: number }[] = [];
	for (const repo of repos) {
		const repoDir = join(reposDir, repo);
		const result = await git(repoDir, "for-each-ref", "refs/heads/", "--format=%(refname:short)");
		if (result.exitCode !== 0) continue;
		const defaultBranch = await cache.getDefaultBranch(repoDir, "origin");
		for (const branch of result.stdout.split("\n").filter(Boolean)) {
			if (branch === defaultBranch) continue;
			if (!workspaceBranches.has(branch)) {
				const defaultRef = defaultBranch ? `origin/${defaultBranch}` : "HEAD";
				const mergeResult = await detectBranchMerged(repoDir, defaultRef, 200, branch);
				if (mergeResult) {
					orphaned.push({ repo, branch, mergeStatus: "merged", aheadCount: 0 });
				} else {
					const countResult = await git(repoDir, "rev-list", "--count", `${defaultRef}..${branch}`);
					const aheadCount = countResult.exitCode === 0 ? Number.parseInt(countResult.stdout.trim(), 10) : 0;
					orphaned.push({ repo, branch, mergeStatus: "unmerged", aheadCount });
				}
			}
		}
	}
	return orphaned;
}
