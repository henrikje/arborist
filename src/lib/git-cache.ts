import { getDefaultBranch } from "./git";
import { type RepoRemotes, getRemoteNames, getRemoteUrl, resolveRemotes } from "./remotes";

/**
 * Request-scoped cache for read-only git queries.
 *
 * Caches **Promises** (not resolved values) so concurrent callers coalesce
 * onto the same in-flight git process instead of spawning duplicates.
 *
 * Create one instance per command invocation and pass it through the call chain.
 * After a fetch, call `invalidateAfterFetch()` to clear entries that may have
 * changed (default branch resolution) while preserving stable entries (remote names).
 */
export class GitCache {
	private remoteNamesCache = new Map<string, Promise<string[]>>();
	private resolvedRemotesCache = new Map<string, Promise<RepoRemotes>>();
	private defaultBranchCache = new Map<string, Promise<string | null>>();
	private remoteUrlCache = new Map<string, Promise<string | null>>();

	getRemoteNames(repoDir: string): Promise<string[]> {
		let cached = this.remoteNamesCache.get(repoDir);
		if (!cached) {
			cached = getRemoteNames(repoDir);
			this.remoteNamesCache.set(repoDir, cached);
		}
		return cached;
	}

	resolveRemotes(repoDir: string): Promise<RepoRemotes> {
		let cached = this.resolvedRemotesCache.get(repoDir);
		if (!cached) {
			cached = this.getRemoteNames(repoDir).then((names) => resolveRemotes(repoDir, names));
			this.resolvedRemotesCache.set(repoDir, cached);
		}
		return cached;
	}

	getDefaultBranch(repoDir: string, remote: string): Promise<string | null> {
		const key = `${repoDir}\0${remote}`;
		let cached = this.defaultBranchCache.get(key);
		if (!cached) {
			cached = getDefaultBranch(repoDir, remote);
			this.defaultBranchCache.set(key, cached);
		}
		return cached;
	}

	getRemoteUrl(repoDir: string, remote: string): Promise<string | null> {
		const key = `${repoDir}\0${remote}`;
		let cached = this.remoteUrlCache.get(key);
		if (!cached) {
			cached = getRemoteUrl(repoDir, remote);
			this.remoteUrlCache.set(key, cached);
		}
		return cached;
	}

	/** Clear caches that may change after a fetch (default branch may update). */
	invalidateAfterFetch(): void {
		this.defaultBranchCache.clear();
	}

	/** Build a remotes map from cached individual results. */
	async resolveRemotesMap(repos: string[], reposDir: string): Promise<Map<string, RepoRemotes>> {
		const entries = await Promise.all(
			repos.map(async (repo) => [repo, await this.resolveRemotes(`${reposDir}/${repo}`)] as const),
		);
		return new Map(entries);
	}
}
