import { describe, expect, mock, test } from "bun:test";
import type { GitCacheDeps } from "./git-cache";
import { GitCache } from "./git-cache";

function makeMockDeps() {
  return {
    branchExistsLocally: mock(() => Promise.resolve(true)),
    getDefaultBranch: mock(() => Promise.resolve("main" as string | null)),
    getRemoteNames: mock(() => Promise.resolve(["origin"])),
    getRemoteUrl: mock(() => Promise.resolve("https://github.com/org/repo.git" as string | null)),
    remoteBranchExists: mock(() => Promise.resolve(true)),
    resolveRemotes: mock(() => Promise.resolve({ base: "origin", share: "origin" })),
    findBranchWorktree: mock(() => Promise.resolve(null)),
  } satisfies GitCacheDeps;
}

describe("GitCache", () => {
  describe("promise coalescing", () => {
    test("two concurrent getDefaultBranch calls with same key coalesce into one", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const [a, b] = await Promise.all([
        cache.getDefaultBranch("/repo", "origin"),
        cache.getDefaultBranch("/repo", "origin"),
      ]);
      expect(a).toBe("main");
      expect(b).toBe("main");
      expect(deps.getDefaultBranch).toHaveBeenCalledTimes(1);
    });

    test("two concurrent getRemoteNames calls with same repoDir coalesce into one", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const [a, b] = await Promise.all([cache.getRemoteNames("/repo"), cache.getRemoteNames("/repo")]);
      expect(a).toEqual(["origin"]);
      expect(b).toEqual(["origin"]);
      expect(deps.getRemoteNames).toHaveBeenCalledTimes(1);
    });

    test("two concurrent getRemoteUrl calls with same key coalesce into one", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const [a, b] = await Promise.all([cache.getRemoteUrl("/repo", "origin"), cache.getRemoteUrl("/repo", "origin")]);
      expect(a).toBe("https://github.com/org/repo.git");
      expect(b).toBe("https://github.com/org/repo.git");
      expect(deps.getRemoteUrl).toHaveBeenCalledTimes(1);
    });

    test("two concurrent resolveRemotes calls with same repoDir coalesce getRemoteNames into one call", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const [a, b] = await Promise.all([cache.resolveRemotes("/repo"), cache.resolveRemotes("/repo")]);
      expect(a).toEqual({ base: "origin", share: "origin" });
      expect(b).toEqual({ base: "origin", share: "origin" });
      expect(deps.getRemoteNames).toHaveBeenCalledTimes(1);
    });

    test("two concurrent remoteBranchExists calls with same key coalesce into one", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const [a, b] = await Promise.all([
        cache.remoteBranchExists("/repo", "main", "origin"),
        cache.remoteBranchExists("/repo", "main", "origin"),
      ]);
      expect(a).toBe(true);
      expect(b).toBe(true);
      expect(deps.remoteBranchExists).toHaveBeenCalledTimes(1);
    });

    test("two concurrent branchExistsLocally calls with same key coalesce into one", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const [a, b] = await Promise.all([
        cache.branchExistsLocally("/repo", "feature"),
        cache.branchExistsLocally("/repo", "feature"),
      ]);
      expect(a).toBe(true);
      expect(b).toBe(true);
      expect(deps.branchExistsLocally).toHaveBeenCalledTimes(1);
    });
  });

  describe("cache isolation", () => {
    test("getDefaultBranch with different keys triggers separate calls", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const [a, b] = await Promise.all([
        cache.getDefaultBranch("/repo-a", "origin"),
        cache.getDefaultBranch("/repo-b", "origin"),
      ]);
      expect(a).toBe("main");
      expect(b).toBe("main");
      expect(deps.getDefaultBranch).toHaveBeenCalledTimes(2);
    });

    test("getRemoteNames with different repoDirs triggers separate calls", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const [a, b] = await Promise.all([cache.getRemoteNames("/repo-a"), cache.getRemoteNames("/repo-b")]);
      expect(a).toEqual(["origin"]);
      expect(b).toEqual(["origin"]);
      expect(deps.getRemoteNames).toHaveBeenCalledTimes(2);
    });

    test("remoteBranchExists with different branch triggers separate call", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const [a, b] = await Promise.all([
        cache.remoteBranchExists("/repo", "main", "origin"),
        cache.remoteBranchExists("/repo", "develop", "origin"),
      ]);
      expect(a).toBe(true);
      expect(b).toBe(true);
      expect(deps.remoteBranchExists).toHaveBeenCalledTimes(2);
    });

    test("branchExistsLocally with different branch triggers separate call", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const [a, b] = await Promise.all([
        cache.branchExistsLocally("/repo", "main"),
        cache.branchExistsLocally("/repo", "feature"),
      ]);
      expect(a).toBe(true);
      expect(b).toBe(true);
      expect(deps.branchExistsLocally).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalidateAfterFetch", () => {
    test("after invalidation getDefaultBranch makes a new call", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      await cache.getDefaultBranch("/repo", "origin");
      expect(deps.getDefaultBranch).toHaveBeenCalledTimes(1);

      cache.invalidateAfterFetch();

      await cache.getDefaultBranch("/repo", "origin");
      expect(deps.getDefaultBranch).toHaveBeenCalledTimes(2);
    });

    test("after invalidation remoteNamesCache is preserved", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      await cache.getRemoteNames("/repo");
      expect(deps.getRemoteNames).toHaveBeenCalledTimes(1);

      cache.invalidateAfterFetch();

      await cache.getRemoteNames("/repo");
      expect(deps.getRemoteNames).toHaveBeenCalledTimes(1);
    });

    test("after invalidation remoteBranchExists makes a new call", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      await cache.remoteBranchExists("/repo", "main", "origin");
      expect(deps.remoteBranchExists).toHaveBeenCalledTimes(1);

      cache.invalidateAfterFetch();

      await cache.remoteBranchExists("/repo", "main", "origin");
      expect(deps.remoteBranchExists).toHaveBeenCalledTimes(2);
    });

    test("after invalidation branchExistsLocally makes a new call", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      await cache.branchExistsLocally("/repo", "feature");
      expect(deps.branchExistsLocally).toHaveBeenCalledTimes(1);

      cache.invalidateAfterFetch();

      await cache.branchExistsLocally("/repo", "feature");
      expect(deps.branchExistsLocally).toHaveBeenCalledTimes(2);
    });
  });

  describe("resolveRemotesMap", () => {
    test("fans out via Promise.all using cached resolveRemotes", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const map = await cache.resolveRemotesMap(["alpha", "beta"], "/repos");

      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(2);
      expect(map.get("alpha")).toEqual({ base: "origin", share: "origin" });
      expect(map.get("beta")).toEqual({ base: "origin", share: "origin" });
    });

    test("returns Map with correct entries keyed by repo name", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      const map = await cache.resolveRemotesMap(["only-one"], "/repos");

      expect([...map.keys()]).toEqual(["only-one"]);
      expect(map.get("only-one")).toEqual({ base: "origin", share: "origin" });
    });
  });

  describe("resolveRemotes chains on getRemoteNames", () => {
    test("single getRemoteNames call even when resolveRemotes triggers it", async () => {
      const deps = makeMockDeps();
      const cache = new GitCache(deps);
      await cache.resolveRemotes("/repo");

      expect(deps.getRemoteNames).toHaveBeenCalledTimes(1);
      expect(deps.resolveRemotes).toHaveBeenCalledTimes(1);
    });
  });
});
