import {
  branchExistsLocally as _branchExistsLocally,
  findBranchWorktree as _findBranchWorktree,
  getDefaultBranch as _getDefaultBranch,
  remoteBranchExists as _remoteBranchExists,
  assertMinimumGitVersion,
  gitLocal,
} from "./git";
import { type GitVersion, parseGitVersion } from "./parsing";
import {
  type RepoRemotes,
  getRemoteNames as _getRemoteNames,
  getRemoteUrl as _getRemoteUrl,
  resolveRemotes as _resolveRemotes,
} from "./remotes";

/**
 * Cache for base-branch patch-id maps, keyed by resolved base SHA.
 * Shared across workspaces so the expensive `git log -p | git patch-id`
 * computation runs once per unique base branch position.
 */
export type BasePatchIdCache = Map<string, Map<string, string>>;

export interface GitCacheDeps {
  branchExistsLocally: (repoDir: string, branch: string) => Promise<boolean>;
  findBranchWorktree: (repoDir: string, branch: string) => Promise<string | null>;
  getDefaultBranch: (repoDir: string, remote: string) => Promise<string | null>;
  getRemoteNames: (repoDir: string) => Promise<string[]>;
  getRemoteUrl: (repoDir: string, remote: string) => Promise<string | null>;
  remoteBranchExists: (repoDir: string, branch: string, remote: string) => Promise<boolean>;
  resolveRemotes: (repoDir: string, knownRemoteNames?: string[]) => Promise<RepoRemotes>;
}

const defaultDeps: GitCacheDeps = {
  branchExistsLocally: _branchExistsLocally,
  findBranchWorktree: _findBranchWorktree,
  getDefaultBranch: _getDefaultBranch,
  getRemoteNames: _getRemoteNames,
  getRemoteUrl: _getRemoteUrl,
  remoteBranchExists: _remoteBranchExists,
  resolveRemotes: _resolveRemotes,
};

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
  private remoteBranchExistsCache = new Map<string, Promise<boolean>>();
  private branchExistsLocallyCache = new Map<string, Promise<boolean>>();
  private findBranchWorktreeCache = new Map<string, Promise<string | null>>();
  private gitVersionCache: Promise<GitVersion> | null = null;
  private deps: GitCacheDeps;

  /** Shared cache for base-branch patch-id maps used by merge detection. */
  readonly basePatchIdCache: BasePatchIdCache = new Map();

  constructor(deps?: GitCacheDeps) {
    this.deps = deps ?? defaultDeps;
  }

  /** Create a GitCache and assert minimum git version. Standard command preamble. */
  static async create(): Promise<GitCache> {
    const cache = new GitCache();
    await assertMinimumGitVersion(cache);
    return cache;
  }

  getRemoteNames(repoDir: string): Promise<string[]> {
    let cached = this.remoteNamesCache.get(repoDir);
    if (!cached) {
      cached = this.deps.getRemoteNames(repoDir);
      this.remoteNamesCache.set(repoDir, cached);
    }
    return cached;
  }

  resolveRemotes(repoDir: string): Promise<RepoRemotes> {
    let cached = this.resolvedRemotesCache.get(repoDir);
    if (!cached) {
      cached = this.getRemoteNames(repoDir).then((names) => this.deps.resolveRemotes(repoDir, names));
      this.resolvedRemotesCache.set(repoDir, cached);
    }
    return cached;
  }

  getDefaultBranch(repoDir: string, remote: string): Promise<string | null> {
    const key = `${repoDir}\0${remote}`;
    let cached = this.defaultBranchCache.get(key);
    if (!cached) {
      cached = this.deps.getDefaultBranch(repoDir, remote);
      this.defaultBranchCache.set(key, cached);
    }
    return cached;
  }

  getRemoteUrl(repoDir: string, remote: string): Promise<string | null> {
    const key = `${repoDir}\0${remote}`;
    let cached = this.remoteUrlCache.get(key);
    if (!cached) {
      cached = this.deps.getRemoteUrl(repoDir, remote);
      this.remoteUrlCache.set(key, cached);
    }
    return cached;
  }

  remoteBranchExists(repoDir: string, branch: string, remote: string): Promise<boolean> {
    const key = `${repoDir}\0${branch}\0${remote}`;
    let cached = this.remoteBranchExistsCache.get(key);
    if (!cached) {
      cached = this.deps.remoteBranchExists(repoDir, branch, remote);
      this.remoteBranchExistsCache.set(key, cached);
    }
    return cached;
  }

  branchExistsLocally(repoDir: string, branch: string): Promise<boolean> {
    const key = `${repoDir}\0${branch}`;
    let cached = this.branchExistsLocallyCache.get(key);
    if (!cached) {
      cached = this.deps.branchExistsLocally(repoDir, branch);
      this.branchExistsLocallyCache.set(key, cached);
    }
    return cached;
  }

  /** Find the worktree path for a branch. Returns the path or null. Cached per repo+branch. */
  findBranchWorktree(repoDir: string, branch: string): Promise<string | null> {
    const key = `${repoDir}\0${branch}`;
    let cached = this.findBranchWorktreeCache.get(key);
    if (!cached) {
      cached = this.deps.findBranchWorktree(repoDir, branch);
      this.findBranchWorktreeCache.set(key, cached);
    }
    return cached;
  }

  getGitVersion(): Promise<GitVersion> {
    if (!this.gitVersionCache) {
      this.gitVersionCache = gitLocal(".", "--version").then((result) => {
        const version = parseGitVersion(result.stdout);
        if (!version) {
          throw new Error(`Failed to parse git version from: ${result.stdout.trim()}`);
        }
        return version;
      });
    }
    return this.gitVersionCache;
  }

  /** Clear caches that may change after a fetch (default branch, remote refs). */
  invalidateAfterFetch(): void {
    this.defaultBranchCache.clear();
    this.remoteBranchExistsCache.clear();
    this.branchExistsLocallyCache.clear();
    this.findBranchWorktreeCache.clear();
  }

  /** Build a remotes map from cached individual results. */
  async resolveRemotesMap(repos: string[], reposDir: string): Promise<Map<string, RepoRemotes>> {
    const entries = await Promise.all(
      repos.map(async (repo) => [repo, await this.resolveRemotes(`${reposDir}/${repo}`)] as const),
    );
    return new Map(entries);
  }
}
