import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectBranchMerged, git } from "./git";
import type { GitCache } from "./git-cache";
import { listRepos } from "./repos";

export async function findStaleWorktrees(reposDir: string): Promise<string[]> {
	const repos = listRepos(reposDir);
	const stale: string[] = [];
	for (const repo of repos) {
		const repoDir = join(reposDir, repo);
		const result = await git(repoDir, "worktree", "list", "--porcelain");
		if (result.exitCode !== 0) continue;
		// Parse porcelain output: each worktree block starts with "worktree <path>"
		for (const line of result.stdout.split("\n")) {
			if (line.startsWith("worktree ")) {
				const wtPath = line.slice("worktree ".length);
				// The first entry is the main worktree (the canonical repo itself) — skip it
				if (wtPath === repoDir) continue;
				if (!existsSync(wtPath)) {
					stale.push(repo);
					break;
				}
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
