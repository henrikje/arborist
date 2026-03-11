import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

  // ── --base (retarget) tests ──

  test("reset --base retargets to a different base branch", () =>
    withEnv(async (env) => {
      // Create a "develop" branch on the origin with a distinct commit
      const canonicalA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalA, ["checkout", "-b", "develop"]);
      await git(canonicalA, ["commit", "--allow-empty", "-m", "develop commit"]);
      await git(canonicalA, ["push", "origin", "develop"]);
      await git(canonicalA, ["checkout", "--detach"]);

      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");
      const repoA = join(wsDir, "repo-a");

      // Add a local commit
      await write(join(repoA, "local.txt"), "change");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      const result = await arb(env, ["reset", "--base", "develop", "--yes"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget from main");
      expect(result.output).toContain("origin/develop");

      // Verify the repo was reset to develop
      const logA = await git(repoA, ["log", "--oneline", "-1"]);
      expect(logA).toContain("develop commit");

      // Verify workspace config was updated
      const config = JSON.parse(readFileSync(join(wsDir, ".arbws/config.json"), "utf-8"));
      expect(config.base).toBe("develop");
    }));

  test("reset --base with --dry-run does not change config or repos", () =>
    withEnv(async (env) => {
      const canonicalA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalA, ["checkout", "-b", "develop"]);
      await git(canonicalA, ["commit", "--allow-empty", "-m", "develop commit"]);
      await git(canonicalA, ["push", "origin", "develop"]);
      await git(canonicalA, ["checkout", "--detach"]);

      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");
      const repoA = join(wsDir, "repo-a");

      await write(join(repoA, "local.txt"), "change");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      const result = await arb(env, ["reset", "--base", "develop", "--dry-run"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Dry run");
      expect(result.output).toContain("retarget from main");

      // Verify local commit still exists
      const logA = await git(repoA, ["log", "--oneline", "-1"]);
      expect(logA).toContain("local commit");

      // Verify config was NOT updated
      const config = JSON.parse(readFileSync(join(wsDir, ".arbws/config.json"), "utf-8"));
      expect(config.base).toBeUndefined();
    }));

  test("reset --base errors when target is the current feature branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["reset", "--base", "my-feature", "--yes"], { cwd: wsDir });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("current feature branch");
    }));

  test("reset --base with same base as current does a normal reset", () =>
    withEnv(async (env) => {
      const canonicalA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalA, ["checkout", "-b", "develop"]);
      await git(canonicalA, ["commit", "--allow-empty", "-m", "develop commit"]);
      await git(canonicalA, ["push", "origin", "develop"]);
      await git(canonicalA, ["checkout", "--detach"]);

      await arb(env, ["create", "my-feature", "--base", "develop", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");
      const repoA = join(wsDir, "repo-a");

      // Add a local commit so there's something to reset
      await write(join(repoA, "local.txt"), "change");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      // --base develop is already the configured base — should reset normally without retarget
      const result = await arb(env, ["reset", "--base", "develop", "--yes"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("retarget");
      expect(result.output).toContain("Reset 1 repo");
    }));

  test("reset --base skips repos where target branch does not exist", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["reset", "--base", "nonexistent", "--yes"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("not found");
    }));

  test("reset --base works with a local-only branch (not on remote)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");
      const repoA = join(wsDir, "repo-a");

      // Create a local-only branch in the worktree (not pushed to origin)
      await git(repoA, ["branch", "local-only-base"]);

      // Add a local commit so there's something to reset
      await write(join(repoA, "local.txt"), "change");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      const result = await arb(env, ["reset", "--base", "local-only-base", "--yes"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget from main");
      expect(result.output).not.toContain("not found");

      // Config should be updated to the local branch
      const config = JSON.parse(readFileSync(join(wsDir, ".arbws/config.json"), "utf-8"));
      expect(config.base).toBe("local-only-base");
    }));

  test("reset --base to default branch removes base from config", () =>
    withEnv(async (env) => {
      const canonicalA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalA, ["checkout", "-b", "develop"]);
      await git(canonicalA, ["commit", "--allow-empty", "-m", "develop commit"]);
      await git(canonicalA, ["push", "origin", "develop"]);
      await git(canonicalA, ["checkout", "--detach"]);

      // Create workspace with develop as base
      await arb(env, ["create", "my-feature", "--base", "develop", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      // Verify config has base set
      const configBefore = JSON.parse(readFileSync(join(wsDir, ".arbws/config.json"), "utf-8"));
      expect(configBefore.base).toBe("develop");

      // Retarget back to main (the default branch) — should remove base from config
      const result = await arb(env, ["reset", "--base", "main", "--yes"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget from develop");

      const configAfter = JSON.parse(readFileSync(join(wsDir, ".arbws/config.json"), "utf-8"));
      expect(configAfter.base).toBeUndefined();
    }));

  test("reset --base retargets multiple repos", () =>
    withEnv(async (env) => {
      // Create develop branch on both origins
      for (const name of ["repo-a", "repo-b"]) {
        const canonical = join(env.projectDir, `.arb/repos/${name}`);
        await git(canonical, ["checkout", "-b", "develop"]);
        await git(canonical, ["commit", "--allow-empty", "-m", `${name} develop commit`]);
        await git(canonical, ["push", "origin", "develop"]);
        await git(canonical, ["checkout", "--detach"]);
      }

      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const wsDir = join(env.projectDir, "my-feature");

      // Add local commits to both
      for (const name of ["repo-a", "repo-b"]) {
        const repoDir = join(wsDir, name);
        await write(join(repoDir, "local.txt"), "change");
        await git(repoDir, ["add", "local.txt"]);
        await git(repoDir, ["commit", "-m", "local commit"]);
      }

      const result = await arb(env, ["reset", "--base", "develop", "--yes"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted 2 repos");

      // Both repos should be on develop
      for (const name of ["repo-a", "repo-b"]) {
        const log = await git(join(wsDir, name), ["log", "--oneline", "-1"]);
        expect(log).toContain("develop commit");
      }

      const config = JSON.parse(readFileSync(join(wsDir, ".arbws/config.json"), "utf-8"));
      expect(config.base).toBe("develop");
    }));

  test("reset --base with mixed availability: skips repos missing the target branch", () =>
    withEnv(async (env) => {
      // Only create develop on repo-a, not repo-b
      const canonicalA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalA, ["checkout", "-b", "develop"]);
      await git(canonicalA, ["commit", "--allow-empty", "-m", "develop commit"]);
      await git(canonicalA, ["push", "origin", "develop"]);
      await git(canonicalA, ["checkout", "--detach"]);

      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const wsDir = join(env.projectDir, "my-feature");

      // Add local commits to both
      for (const name of ["repo-a", "repo-b"]) {
        const repoDir = join(wsDir, name);
        await write(join(repoDir, "local.txt"), "change");
        await git(repoDir, ["add", "local.txt"]);
        await git(repoDir, ["commit", "-m", "local commit"]);
      }

      const result = await arb(env, ["reset", "--base", "develop", "--yes"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      // repo-a retargeted, repo-b skipped
      expect(result.output).toContain("Retargeted 1 repo");
      expect(result.output).toContain("not found");

      // repo-a should be on develop
      const logA = await git(join(wsDir, "repo-a"), ["log", "--oneline", "-1"]);
      expect(logA).toContain("develop commit");

      // repo-b should still have its local commit
      const logB = await git(join(wsDir, "repo-b"), ["log", "--oneline", "-1"]);
      expect(logB).toContain("local commit");
    }));

  test("reset --base with positional repo selection only retargets named repos", () =>
    withEnv(async (env) => {
      // Create develop on both origins
      for (const name of ["repo-a", "repo-b"]) {
        const canonical = join(env.projectDir, `.arb/repos/${name}`);
        await git(canonical, ["checkout", "-b", "develop"]);
        await git(canonical, ["commit", "--allow-empty", "-m", `${name} develop commit`]);
        await git(canonical, ["push", "origin", "develop"]);
        await git(canonical, ["checkout", "--detach"]);
      }

      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const wsDir = join(env.projectDir, "my-feature");

      // Add local commits to both
      for (const name of ["repo-a", "repo-b"]) {
        const repoDir = join(wsDir, name);
        await write(join(repoDir, "local.txt"), "change");
        await git(repoDir, ["add", "local.txt"]);
        await git(repoDir, ["commit", "-m", "local commit"]);
      }

      // Only retarget repo-a
      const result = await arb(env, ["reset", "repo-a", "--base", "develop", "--yes"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted 1 repo");

      // repo-a should be on develop
      const logA = await git(join(wsDir, "repo-a"), ["log", "--oneline", "-1"]);
      expect(logA).toContain("repo-a develop commit");

      // repo-b should still have its local commit (was not included)
      const logB = await git(join(wsDir, "repo-b"), ["log", "--oneline", "-1"]);
      expect(logB).toContain("local commit");
    }));
});
