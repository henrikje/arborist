import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRemoteNames, getRemoteUrl, resolveRemotes, resolveRemotesMap } from "./remotes";

describe("remotes", () => {
	function withRepo(fn: (ctx: { tmpDir: string; repoDir: string }) => Promise<void>): Promise<void> {
		const tmpDir = mkdtempSync(join(tmpdir(), "arb-remotes-test-"));
		const repoDir = join(tmpDir, "repo");
		const bare = join(tmpDir, "bare.git");
		Bun.spawnSync(["git", "init", "--bare", bare]);
		Bun.spawnSync(["git", "clone", bare, repoDir]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "--allow-empty", "-m", "init"]);
		Bun.spawnSync(["git", "-C", repoDir, "push", "origin", "HEAD"]);
		return fn({ tmpDir, repoDir }).finally(() => {
			rmSync(tmpDir, { recursive: true, force: true });
		});
	}

	describe("getRemoteNames", () => {
		test("returns origin for a cloned repo", () =>
			withRepo(async ({ repoDir }) => {
				const names = await getRemoteNames(repoDir);
				expect(names).toEqual(["origin"]);
			}));

		test("returns empty array for repo without remotes", () =>
			withRepo(async ({ tmpDir }) => {
				const local = join(tmpDir, "local");
				Bun.spawnSync(["git", "init", local]);
				const names = await getRemoteNames(local);
				expect(names).toEqual([]);
			}));

		test("returns multiple remotes", () =>
			withRepo(async ({ tmpDir, repoDir }) => {
				const upstream = join(tmpDir, "upstream.git");
				Bun.spawnSync(["git", "init", "--bare", upstream]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "upstream", upstream]);
				const names = await getRemoteNames(repoDir);
				expect(names).toContain("origin");
				expect(names).toContain("upstream");
			}));
	});

	describe("getRemoteUrl", () => {
		test("returns URL for existing remote", () =>
			withRepo(async ({ repoDir }) => {
				const url = await getRemoteUrl(repoDir, "origin");
				expect(url).not.toBeNull();
				expect(url?.length).toBeGreaterThan(0);
			}));

		test("returns null for nonexistent remote", () =>
			withRepo(async ({ repoDir }) => {
				const url = await getRemoteUrl(repoDir, "nonexistent");
				expect(url).toBeNull();
			}));
	});

	describe("resolveRemotes", () => {
		test("single origin → both roles", () =>
			withRepo(async ({ repoDir }) => {
				const result = await resolveRemotes(repoDir);
				expect(result).toEqual({ base: "origin", share: "origin" });
			}));

		test("single non-origin remote → both roles", () =>
			withRepo(async ({ repoDir }) => {
				Bun.spawnSync(["git", "-C", repoDir, "remote", "rename", "origin", "my-remote"]);
				const result = await resolveRemotes(repoDir);
				expect(result).toEqual({ base: "my-remote", share: "my-remote" });
			}));

		test("origin + upstream convention", () =>
			withRepo(async ({ tmpDir, repoDir }) => {
				const upstreamBare = join(tmpDir, "upstream.git");
				Bun.spawnSync(["git", "init", "--bare", upstreamBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "upstream", upstreamBare]);
				const result = await resolveRemotes(repoDir);
				expect(result).toEqual({ base: "upstream", share: "origin" });
			}));

		test("remote.pushDefault set", () =>
			withRepo(async ({ tmpDir, repoDir }) => {
				const upstreamBare = join(tmpDir, "upstream.git");
				Bun.spawnSync(["git", "init", "--bare", upstreamBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "upstream", upstreamBare]);
				Bun.spawnSync(["git", "-C", repoDir, "config", "remote.pushDefault", "origin"]);
				const result = await resolveRemotes(repoDir);
				expect(result).toEqual({ base: "upstream", share: "origin" });
			}));

		test("remote.pushDefault with non-standard names", () =>
			withRepo(async ({ tmpDir, repoDir }) => {
				const canonicalBare = join(tmpDir, "canonical.git");
				Bun.spawnSync(["git", "init", "--bare", canonicalBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "canonical", canonicalBare]);
				Bun.spawnSync(["git", "-C", repoDir, "config", "remote.pushDefault", "origin"]);
				const result = await resolveRemotes(repoDir);
				expect(result).toEqual({ base: "canonical", share: "origin" });
			}));

		test("three remotes with pushDefault — upstream named 'upstream'", () =>
			withRepo(async ({ tmpDir, repoDir }) => {
				const upstreamBare = join(tmpDir, "upstream.git");
				const stagingBare = join(tmpDir, "staging.git");
				Bun.spawnSync(["git", "init", "--bare", upstreamBare]);
				Bun.spawnSync(["git", "init", "--bare", stagingBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "upstream", upstreamBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "staging", stagingBare]);
				Bun.spawnSync(["git", "-C", repoDir, "config", "remote.pushDefault", "origin"]);
				const result = await resolveRemotes(repoDir);
				expect(result).toEqual({ base: "upstream", share: "origin" });
			}));

		test("three remotes with pushDefault — no 'upstream' name → error", () =>
			withRepo(async ({ tmpDir, repoDir }) => {
				const forkBare = join(tmpDir, "fork.git");
				const stagingBare = join(tmpDir, "staging.git");
				Bun.spawnSync(["git", "init", "--bare", forkBare]);
				Bun.spawnSync(["git", "init", "--bare", stagingBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "fork", forkBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "staging", stagingBare]);
				Bun.spawnSync(["git", "-C", repoDir, "config", "remote.pushDefault", "fork"]);
				expect(resolveRemotes(repoDir)).rejects.toThrow("Cannot determine base remote");
			}));

		test("three remotes without pushDefault → error", () =>
			withRepo(async ({ tmpDir, repoDir }) => {
				const upstreamBare = join(tmpDir, "upstream.git");
				const stagingBare = join(tmpDir, "staging.git");
				Bun.spawnSync(["git", "init", "--bare", upstreamBare]);
				Bun.spawnSync(["git", "init", "--bare", stagingBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "upstream", upstreamBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "staging", stagingBare]);
				expect(resolveRemotes(repoDir)).rejects.toThrow("Cannot determine remote roles");
			}));

		test("no remotes → error", () =>
			withRepo(async ({ tmpDir }) => {
				const local = join(tmpDir, "local");
				Bun.spawnSync(["git", "init", local]);
				expect(resolveRemotes(local)).rejects.toThrow("No remotes configured");
			}));

		test("two remotes, neither named origin or upstream, no pushDefault → error", () =>
			withRepo(async ({ tmpDir, repoDir }) => {
				Bun.spawnSync(["git", "-C", repoDir, "remote", "rename", "origin", "fork"]);
				const canonicalBare = join(tmpDir, "canonical.git");
				Bun.spawnSync(["git", "init", "--bare", canonicalBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "canonical", canonicalBare]);
				expect(resolveRemotes(repoDir)).rejects.toThrow("Cannot determine remote roles");
			}));

		test("pushDefault set to non-existent remote is ignored", () =>
			withRepo(async ({ repoDir }) => {
				Bun.spawnSync(["git", "-C", repoDir, "config", "remote.pushDefault", "nonexistent"]);
				const result = await resolveRemotes(repoDir);
				expect(result).toEqual({ base: "origin", share: "origin" });
			}));
	});

	describe("resolveRemotesMap", () => {
		test("propagates errors for repos without remotes", () =>
			withRepo(async ({ tmpDir }) => {
				const local = join(tmpDir, "local");
				Bun.spawnSync(["git", "init", local]);
				expect(resolveRemotesMap(["repo", "local"], tmpDir)).rejects.toThrow("No remotes configured");
			}));

		test("rethrows ambiguous remote configuration errors", () =>
			withRepo(async ({ tmpDir, repoDir }) => {
				const upstreamBare = join(tmpDir, "upstream.git");
				const stagingBare = join(tmpDir, "staging.git");
				Bun.spawnSync(["git", "init", "--bare", upstreamBare]);
				Bun.spawnSync(["git", "init", "--bare", stagingBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "upstream", upstreamBare]);
				Bun.spawnSync(["git", "-C", repoDir, "remote", "add", "staging", stagingBare]);
				expect(resolveRemotesMap(["repo"], tmpDir)).rejects.toThrow("Cannot determine remote roles");
			}));
	});
});
