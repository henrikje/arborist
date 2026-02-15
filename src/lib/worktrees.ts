import { existsSync } from "node:fs";
import { branchExistsLocally, getDefaultBranch, hasRemote, isRepoDirty, remoteBranchExists } from "./git";
import { error, inlineResult, inlineStart, warn } from "./output";
import { type FetchResult, parallelFetch } from "./parallel-fetch";
import type { RepoRemotes } from "./remotes";

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
	baseDir: string,
	baseBranch?: string,
	remotesMap?: Map<string, RepoRemotes>,
): Promise<AddWorktreesResult> {
	const wsDir = `${baseDir}/${name}`;
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
		if (!(await hasRemote(repoPath))) {
			fetchResults.set(repo, { repo, exitCode: 0, output: "" });
			continue;
		}
		reposDirsToFetch.push(repoPath);
	}

	if (reposDirsToFetch.length > 0) {
		process.stderr.write(`Fetching ${reposDirsToFetch.length} repo(s)...\n`);
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
			warn(`  [${repo}] worktree already exists — skipping`);
			result.skipped.push(repo);
			continue;
		}

		if (await isRepoDirty(repoPath)) {
			warn(`  [${repo}] canonical repo has uncommitted changes`);
		}

		const repoHasRemote = await hasRemote(repoPath);

		// Resolve remote names for this repo
		const repoRemotes = remotesMap?.get(repo);
		const upstreamRemote = repoRemotes?.upstream ?? "origin";
		const publishRemote = repoRemotes?.publish ?? "origin";

		let effectiveBase: string | null;
		if (baseBranch) {
			const baseExists = repoHasRemote
				? await remoteBranchExists(repoPath, baseBranch, upstreamRemote)
				: await branchExistsLocally(repoPath, baseBranch);
			if (baseExists) {
				effectiveBase = baseBranch;
			} else {
				effectiveBase = await getDefaultBranch(repoPath, upstreamRemote);
				if (effectiveBase) {
					warn(`  [${repo}] base branch '${baseBranch}' not found — using '${effectiveBase}'`);
				} else {
					error(`  [${repo}] base branch '${baseBranch}' not found and could not determine default branch`);
					result.failed.push(repo);
					continue;
				}
			}
		} else {
			effectiveBase = await getDefaultBranch(repoPath, upstreamRemote);
			if (!effectiveBase) {
				error(`  [${repo}] could not determine default branch`);
				result.failed.push(repo);
				continue;
			}
		}

		const branchExists = await branchExistsLocally(repoPath, branch);

		// Prune stale worktrees
		await Bun.$`git -C ${repoPath} worktree prune`.quiet().nothrow();

		if (branchExists) {
			inlineStart(repo, `attaching branch ${branch}`);
			const wt = await Bun.$`git -C ${repoPath} worktree add ${wsDir}/${repo} ${branch}`.quiet().nothrow();
			if (wt.exitCode !== 0) {
				inlineResult(repo, "failed");
				const errText = wt.stderr.toString().trim();
				if (errText) error(`    ${errText}`);
				result.failed.push(repo);
				continue;
			}
			inlineResult(repo, `branch ${branch} attached`);
		} else {
			const startPoint = repoHasRemote ? `${upstreamRemote}/${effectiveBase}` : effectiveBase;
			inlineStart(repo, `creating branch ${branch} from ${startPoint}`);
			const wt = await Bun.$`git -C ${repoPath} worktree add -b ${branch} ${wsDir}/${repo} ${startPoint}`
				.quiet()
				.nothrow();
			if (wt.exitCode !== 0) {
				inlineResult(repo, "failed");
				const errText = wt.stderr.toString().trim();
				if (errText) error(`    ${errText}`);
				result.failed.push(repo);
				continue;
			}
			inlineResult(repo, `branch ${branch} created from ${startPoint}`);
		}

		// Set upstream so `git push` works without -u on first push
		if (repoHasRemote) {
			await Bun.$`git -C ${wsDir}/${repo} config branch.${branch}.remote ${publishRemote}`.quiet().nothrow();
			await Bun.$`git -C ${wsDir}/${repo} config branch.${branch}.merge refs/heads/${branch}`.quiet().nothrow();
		}

		result.created.push(repo);
	}

	return result;
}
