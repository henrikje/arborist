import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { arb, withEnv } from "./helpers/env";

// ── from project root, no workspaces ─────────────────────────────

describe("arb dump", () => {
  test("output structure and content from project root", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["dump"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const data = JSON.parse(result.stdout);

      // top-level shape
      expect(Number.isNaN(Date.parse(data.timestamp))).toBe(false);
      expect(data.errors).toEqual([]);
      expect(Object.keys(data.workspaces)).toHaveLength(0);
      expect(data.currentWorkspaceStatus).toBeNull();

      // arb section
      expect(typeof data.arb.version).toBe("string");
      expect(data.arb.rootDir).toBe(env.projectDir);
      expect(data.arb.reposDir).toBe(join(env.projectDir, ".arb/repos"));
      expect(data.arb.currentWorkspace).toBeNull();

      // system section
      expect(data.system.argv.some((a: string) => a.endsWith("arb"))).toBe(true);
      expect(data.system.cwd).toBe(env.projectDir);
      expect(data.system.git).toMatch(/^\d+\.\d+\.\d+$/);
      expect(data.system.env.NO_COLOR).toBe("1");
      expect(typeof data.system.stdin.isTTY).toBe("boolean");

      // canonical repos
      const names = data.canonicalRepos.map((r: { name: string }) => r.name);
      expect(names).toContain("repo-a");
      expect(names).toContain("repo-b");
      const repoA = data.canonicalRepos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.headSha).toMatch(/^[0-9a-f]{40}$/);
      expect(repoA.remotes.urls.origin).toContain("repo-a.git");
      expect(repoA.worktrees[0]).toHaveProperty("path");
      const mainBranch = repoA.localBranches.find((b: { name: string }) => b.name === "main");
      expect(mainBranch.upstream).toBe("origin/main");
    }));

  test("workspace data from project root", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "dump-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arb(env, ["dump"]);
      const data = JSON.parse(result.stdout);

      // workspace entry
      expect(data.workspaces["dump-ws"].branch).toBe("dump-ws");
      const repoA = data.workspaces["dump-ws"].repos["repo-a"];
      expect(repoA.gitStatus[0]).toMatch(/^## /);
      expect(repoA.valid).toBe(true);
      expect(repoA.gitdir).toContain(".arb/repos/repo-a");

      // localBranches: workspace branch has worktreePath, no upstream
      const canonRepoA = data.canonicalRepos.find((r: { name: string }) => r.name === "repo-a");
      const wsBranch = canonRepoA.localBranches.find((b: { name: string }) => b.name === "dump-ws");
      expect(wsBranch.worktreePath).toContain("dump-ws");
      expect(wsBranch.upstream).toBeNull();
    }));

  test("workspace context when run from inside a workspace", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "dump-ctx", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arb(env, ["dump"], { cwd: join(env.projectDir, "dump-ctx/repo-a") });
      const data = JSON.parse(result.stdout);

      expect(data.arb.currentWorkspace).toBe("dump-ctx");
      expect(data.currentWorkspaceStatus.name).toBe("dump-ctx");
      expect(data.currentWorkspaceStatus.branch).toBe("dump-ctx");
      const repoEntry = data.currentWorkspaceStatus.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoEntry.flags).toBeDefined();
    }));

  test("fails outside a project", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["dump"], { cwd: "/tmp" });
      expect(result.exitCode).not.toBe(0);
    }));
});
