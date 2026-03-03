import { afterEach, describe, expect, mock, test } from "bun:test";

// Mock the underlying git functions
const mockGetDefaultBranch = mock(() => Promise.resolve("main"));
const mockGetRemoteNames = mock(() => Promise.resolve(["origin"]));
const mockGetRemoteUrl = mock(() => Promise.resolve("https://github.com/org/repo.git"));
const mockResolveRemotes = mock(() => Promise.resolve({ base: "origin", share: "origin" }));

mock.module("./git", () => ({
	getDefaultBranch: mockGetDefaultBranch,
}));

mock.module("./remotes", () => ({
	getRemoteNames: mockGetRemoteNames,
	getRemoteUrl: mockGetRemoteUrl,
	resolveRemotes: mockResolveRemotes,
}));

// Import AFTER mocking
const { GitCache } = await import("./git-cache");

afterEach(() => {
	mockGetDefaultBranch.mockClear();
	mockGetRemoteNames.mockClear();
	mockGetRemoteUrl.mockClear();
	mockResolveRemotes.mockClear();
});

describe("GitCache", () => {
	describe("promise coalescing", () => {
		test("two concurrent getDefaultBranch calls with same key coalesce into one", async () => {
			const cache = new GitCache();
			const [a, b] = await Promise.all([
				cache.getDefaultBranch("/repo", "origin"),
				cache.getDefaultBranch("/repo", "origin"),
			]);
			expect(a).toBe("main");
			expect(b).toBe("main");
			expect(mockGetDefaultBranch).toHaveBeenCalledTimes(1);
		});

		test("two concurrent getRemoteNames calls with same repoDir coalesce into one", async () => {
			const cache = new GitCache();
			const [a, b] = await Promise.all([cache.getRemoteNames("/repo"), cache.getRemoteNames("/repo")]);
			expect(a).toEqual(["origin"]);
			expect(b).toEqual(["origin"]);
			expect(mockGetRemoteNames).toHaveBeenCalledTimes(1);
		});

		test("two concurrent getRemoteUrl calls with same key coalesce into one", async () => {
			const cache = new GitCache();
			const [a, b] = await Promise.all([cache.getRemoteUrl("/repo", "origin"), cache.getRemoteUrl("/repo", "origin")]);
			expect(a).toBe("https://github.com/org/repo.git");
			expect(b).toBe("https://github.com/org/repo.git");
			expect(mockGetRemoteUrl).toHaveBeenCalledTimes(1);
		});

		test("two concurrent resolveRemotes calls with same repoDir coalesce getRemoteNames into one call", async () => {
			const cache = new GitCache();
			const [a, b] = await Promise.all([cache.resolveRemotes("/repo"), cache.resolveRemotes("/repo")]);
			expect(a).toEqual({ base: "origin", share: "origin" });
			expect(b).toEqual({ base: "origin", share: "origin" });
			expect(mockGetRemoteNames).toHaveBeenCalledTimes(1);
		});
	});

	describe("cache isolation", () => {
		test("getDefaultBranch with different keys triggers separate calls", async () => {
			const cache = new GitCache();
			const [a, b] = await Promise.all([
				cache.getDefaultBranch("/repo-a", "origin"),
				cache.getDefaultBranch("/repo-b", "origin"),
			]);
			expect(a).toBe("main");
			expect(b).toBe("main");
			expect(mockGetDefaultBranch).toHaveBeenCalledTimes(2);
		});

		test("getRemoteNames with different repoDirs triggers separate calls", async () => {
			const cache = new GitCache();
			const [a, b] = await Promise.all([cache.getRemoteNames("/repo-a"), cache.getRemoteNames("/repo-b")]);
			expect(a).toEqual(["origin"]);
			expect(b).toEqual(["origin"]);
			expect(mockGetRemoteNames).toHaveBeenCalledTimes(2);
		});
	});

	describe("invalidateAfterFetch", () => {
		test("after invalidation getDefaultBranch makes a new call", async () => {
			const cache = new GitCache();
			await cache.getDefaultBranch("/repo", "origin");
			expect(mockGetDefaultBranch).toHaveBeenCalledTimes(1);

			cache.invalidateAfterFetch();

			await cache.getDefaultBranch("/repo", "origin");
			expect(mockGetDefaultBranch).toHaveBeenCalledTimes(2);
		});

		test("after invalidation remoteNamesCache is preserved", async () => {
			const cache = new GitCache();
			await cache.getRemoteNames("/repo");
			expect(mockGetRemoteNames).toHaveBeenCalledTimes(1);

			cache.invalidateAfterFetch();

			await cache.getRemoteNames("/repo");
			expect(mockGetRemoteNames).toHaveBeenCalledTimes(1);
		});
	});

	describe("resolveRemotesMap", () => {
		test("fans out via Promise.all using cached resolveRemotes", async () => {
			const cache = new GitCache();
			const map = await cache.resolveRemotesMap(["alpha", "beta"], "/repos");

			expect(map).toBeInstanceOf(Map);
			expect(map.size).toBe(2);
			expect(map.get("alpha")).toEqual({ base: "origin", share: "origin" });
			expect(map.get("beta")).toEqual({ base: "origin", share: "origin" });
		});

		test("returns Map with correct entries keyed by repo name", async () => {
			const cache = new GitCache();
			const map = await cache.resolveRemotesMap(["only-one"], "/repos");

			expect([...map.keys()]).toEqual(["only-one"]);
			expect(map.get("only-one")).toEqual({ base: "origin", share: "origin" });
		});
	});

	describe("resolveRemotes chains on getRemoteNames", () => {
		test("single getRemoteNames call even when resolveRemotes triggers it", async () => {
			const cache = new GitCache();
			await cache.resolveRemotes("/repo");

			expect(mockGetRemoteNames).toHaveBeenCalledTimes(1);
			expect(mockResolveRemotes).toHaveBeenCalledTimes(1);
		});
	});
});
