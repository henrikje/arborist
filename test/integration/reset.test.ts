import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { arb, git, setupForkRepo, withEnv, write } from "./helpers/env";

describe("reset", () => {
  test("basic reset discards local commits and dirty files", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      const repoA = join(env.projectDir, "my-feature/repo-a");
      const repoB = join(env.projectDir, "my-feature/repo-b");

      // Add a local commit to repo-a
      await write(join(repoA, "local.txt"), "local change");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      // Add dirty files to repo-b
      await write(join(repoB, "dirty.txt"), "dirty");
      await git(repoB, ["add", "dirty.txt"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Reset 2 repos");

      // Verify repo-a local commit is gone
      const logA = await git(repoA, ["log", "--oneline", "-1"]);
      expect(logA).not.toContain("local commit");

      // Verify repo-b dirty file is gone
      const statusB = await git(repoB, ["status", "--porcelain"]);
      // staged files should be gone, but untracked might remain
      expect(statusB).not.toContain("A  dirty.txt");
    }));

  test("dry-run shows plan without executing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      await write(join(repoA, "local.txt"), "change");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      const result = await arb(env, ["reset", "--dry-run"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("reset to");
      expect(result.output).toContain("Dry run");

      // Verify local commit still exists
      const logA = await git(repoA, ["log", "--oneline", "-1"]);
      expect(logA).toContain("local commit");
    }));

  test("already-clean repos are reported", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already at base");
    }));

  test("warns about unpushed commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Push then add more local commits
      await git(repoA, ["push", "-u", "origin", "my-feature"]);
      await write(join(repoA, "extra.txt"), "extra");
      await git(repoA, ["add", "extra.txt"]);
      await git(repoA, ["commit", "-m", "unpushed work"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("unpushed commit");
    }));

  test("skip detached HEAD", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Detach HEAD
      await git(repoA, ["checkout", "--detach"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("detached");
    }));

  test("reset with repo filter", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      const repoB = join(env.projectDir, "my-feature/repo-b");

      // Add local commits to both repos
      await write(join(repoA, "local.txt"), "a");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "a commit"]);

      await write(join(repoB, "local.txt"), "b");
      await git(repoB, ["add", "local.txt"]);
      await git(repoB, ["commit", "-m", "b commit"]);

      // Reset only repo-a
      const result = await arb(env, ["reset", "repo-a", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Reset 1 repo");

      // Verify repo-a was reset
      const logA = await git(repoA, ["log", "--oneline", "-1"]);
      expect(logA).not.toContain("a commit");

      // Verify repo-b was NOT reset
      const logB = await git(repoB, ["log", "--oneline", "-1"]);
      expect(logB).toContain("b commit");
    }));

  test("reset with fork workflow uses correct base remote", () =>
    withEnv(async (env) => {
      await setupForkRepo(env, "repo-a");
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Add a local commit
      await write(join(repoA, "local.txt"), "change");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      // Fork workflow should resolve upstream as the base remote
      expect(result.output).toContain("upstream/");
      expect(result.output).toContain("Reset 1 repo");
    }));
});
