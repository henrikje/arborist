import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, withEnv, write } from "./helpers/env";

// ── retarget (merged base, auto-detect) ──────────────────────────

describe("retarget (merged base, auto-detect)", () => {
  test("arb retarget rebases onto default branch (merge commit)", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui feature"]);

      // Merge feat/auth into main via merge commit
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);

      const result = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("base branch changed from feat/auth to main");

      const logOutput = await git(join(env.projectDir, "stacked/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("ui feature");
      expect(logOutput).toContain("merge feat/auth");

      // Verify config no longer has base = feat/auth
      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();
    }));

  test("arb retarget uses --onto for squash-merged base", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui feature"]);

      // Squash merge feat/auth into main (do NOT delete feat/auth)
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "--squash", "origin/feat/auth"]);
      await git(tmpMerge, ["commit", "-m", "squash: auth"]);
      await git(tmpMerge, ["push"]);

      const result = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("base branch changed from feat/auth to main");

      const logOutput = await git(join(env.projectDir, "stacked/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("ui feature");
      expect(logOutput).toContain("squash: auth");

      // Verify feat/auth's original commits are NOT in the branch history
      const logOutput2 = await git(join(env.projectDir, "stacked/repo-a"), ["log", "--oneline"]);
      expect(logOutput2).not.toContain("auth feature");

      // Verify config updated
      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();
    }));

  test("existing auto-detect retarget still works unchanged", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui feature"]);

      // Merge feat/auth into main
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);

      const result = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("Retargeted");

      // Config should have base cleared (retargeted to default)
      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();
    }));

  test("noop rebase when all local commits are already on target", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      // Add a commit on the stacked workspace
      const wsRepo = join(env.projectDir, "stacked/repo-a");
      await write(join(wsRepo, "ui.txt"), "ui");
      await git(wsRepo, ["add", "ui.txt"]);
      await git(wsRepo, ["commit", "-m", "ui feature"]);

      // Merge feat/auth into main via merge commit, then add the same change as the
      // workspace's commit (same diff = same patch-id) so it's already on target.
      const tmpMerge = join(env.testDir, "tmp-merge-noop");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await write(join(tmpMerge, "ui.txt"), "ui");
      await git(tmpMerge, ["add", "ui.txt"]);
      await git(tmpMerge, ["commit", "-m", "ui feature (cherry-picked)"]);
      await git(tmpMerge, ["push"]);

      const result = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      // Plan should show "reset to" (noop: all commits merged)
      expect(result.output).toContain("reset to");
      expect(result.output).toContain("merged");
      // Execution message should also use "reset to" framing, not "rebased 0 new commits"
      expect(result.output).not.toContain("rebased 0");
      // Config updated
      expect(result.output).toContain("base branch changed from feat/auth to main");

      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();
    }));
});

// ── retarget (merged base, branch deleted) ───────────────────────

describe("retarget (merged base, branch deleted)", () => {
  test("arb retarget works when base branch is merged and deleted", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui feature"]);

      // Merge feat/auth into main via merge commit, then DELETE the branch
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);
      await git(tmpMerge, ["push", "origin", "--delete", "feat/auth"]);

      const result = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("base branch changed from feat/auth to main");

      const logOutput = await git(join(env.projectDir, "stacked/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("ui feature");
      expect(logOutput).toContain("merge feat/auth");

      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();
    }));

  test("arb retarget works for squash-merged and deleted base", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui feature"]);

      // Squash merge feat/auth into main, then DELETE the branch
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "--squash", "origin/feat/auth"]);
      await git(tmpMerge, ["commit", "-m", "squash: auth"]);
      await git(tmpMerge, ["push"]);
      await git(tmpMerge, ["push", "origin", "--delete", "feat/auth"]);

      const result = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("base branch changed from feat/auth to main");

      const logOutput = await git(join(env.projectDir, "stacked/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("ui feature");
      expect(logOutput).toContain("squash: auth");

      const logOutput2 = await git(join(env.projectDir, "stacked/repo-a"), ["log", "--oneline"]);
      expect(logOutput2).not.toContain("auth feature");

      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();
    }));
});

// ── explicit retarget to non-default branch ──────────────────────

describe("explicit retarget to non-default branch", () => {
  test("arb retarget <branch> retargets to a non-default branch", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      // Create feat/A branch in repo-a with a commit
      await git(repoA, ["checkout", "-b", "feat/A"]);
      await write(join(repoA, "a.txt"), "A-content");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "feat A"]);
      await git(repoA, ["push", "-u", "origin", "feat/A"]);

      // Create feat/B branch from feat/A
      await git(repoA, ["checkout", "-b", "feat/B"]);
      await write(join(repoA, "b.txt"), "B-content");
      await git(repoA, ["add", "b.txt"]);
      await git(repoA, ["commit", "-m", "feat B"]);
      await git(repoA, ["push", "-u", "origin", "feat/B"]);
      await git(repoA, ["checkout", "--detach"]);

      // Create stacked workspace C based on feat/B
      await arb(env, ["create", "stacked-C", "--base", "feat/B", "-b", "feat/C", "repo-a"]);

      // Add a commit on feat/C
      await write(join(env.projectDir, "stacked-C/repo-a/c.txt"), "C-content");
      await git(join(env.projectDir, "stacked-C/repo-a"), ["add", "c.txt"]);
      await git(join(env.projectDir, "stacked-C/repo-a"), ["commit", "-m", "feat C"]);

      // Merge feat/B into feat/A (simulating PR merge)
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["checkout", "feat/A"]);
      await git(tmpMerge, ["merge", "origin/feat/B", "--no-ff", "-m", "merge feat/B into feat/A"]);
      await git(tmpMerge, ["push"]);

      const result = await arb(env, ["retarget", "feat/A", "--yes"], {
        cwd: join(env.projectDir, "stacked-C"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("base branch changed from feat/B to feat/A");

      const logOutput = await git(join(env.projectDir, "stacked-C/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("feat C");
      expect(logOutput).toContain("merge feat/B into feat/A");

      // Verify config now has base = feat/A (not cleared, since feat/A is not default)
      const config = await readFile(join(env.projectDir, "stacked-C/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBe("feat/A");
      expect(JSON.parse(config).base).not.toBe("feat/B");
    }));

  test("arb retarget main clears base config", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui feature"]);

      // Merge feat/auth into main
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);

      const result = await arb(env, ["retarget", "main", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("Retargeted");

      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();
    }));

  test("arb retarget origin/main rejects matching remote-qualified input", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui feature"]);

      const tmpMerge = join(env.testDir, "tmp-merge-qualified");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);

      const result = await arb(env, ["retarget", "origin/main", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("includes the resolved base remote 'origin'");
      expect(result.output).toContain("Use 'main' instead");
    }));

  test("arb retarget main updates config in no-op retarget path", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      // Merge feat/auth into main and delete the old base branch from remote.
      const tmpMerge = join(env.testDir, "tmp-merge-no-dryrun");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);
      await git(join(env.originDir, "repo-a.git"), ["branch", "-D", "feat/auth"]);
      // Keep canonical refs in sync so base resolution falls back to default.
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["fetch", "--prune"]);

      // Simulate already-retargeted history while config still points at feat/auth.
      await git(join(env.projectDir, "stacked/repo-a"), ["merge", "--ff-only", "origin/main"]);

      const before = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(before).base).toBe("feat/auth");

      const result = await arb(env, ["retarget", "main"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("change base branch from feat/auth to main");
      expect(result.output).toContain("base branch changed from feat/auth to main");
      expect(result.output).toContain("up to date");

      const after = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(after).base).toBeUndefined();
    }));

  test("arb retarget nonexistent target fails", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      const result = await arb(env, ["retarget", "nonexistent", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not found");
    }));

  test("arb retarget shows warning for unmerged base", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);

      // Create feat/B from feat/auth
      await git(repoA, ["checkout", "-b", "feat/B"]);
      await write(join(repoA, "b.txt"), "B");
      await git(repoA, ["add", "b.txt"]);
      await git(repoA, ["commit", "-m", "feat B"]);
      await git(repoA, ["push", "-u", "origin", "feat/B"]);
      await git(repoA, ["checkout", "--detach"]);

      // Create stacked workspace based on feat/B
      await arb(env, ["create", "stacked", "--base", "feat/B", "-b", "feat/C", "repo-a"]);

      // Add a commit on feat/C
      await write(join(env.projectDir, "stacked/repo-a/c.txt"), "C");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "c.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "feat C"]);

      // Retarget to feat/auth WITHOUT merging feat/B into feat/auth
      // Non-merged retargets intentionally suppress the "may not be merged" warning
      const result = await arb(env, ["retarget", "feat/auth", "--dry-run"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("rebase onto");
      expect(result.output).toContain("Dry run");
      expect(result.output).not.toContain("may not be merged");
    }));

  test("arb retarget proceeds when old base ref is missing in stacked repo", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      const repoB = join(env.projectDir, ".arb/repos/repo-b");
      await git(repoB, ["checkout", "-b", "feat/auth"]);
      await write(join(repoB, "auth.txt"), "auth");
      await git(repoB, ["add", "auth.txt"]);
      await git(repoB, ["commit", "-m", "auth feature"]);
      await git(repoB, ["push", "-u", "origin", "feat/auth"]);
      await git(repoB, ["checkout", "--detach"]);

      // Create stacked workspace with both repos
      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a", "repo-b"]);

      // Add commits
      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui-a");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui a"]);

      // Delete feat/auth from repo-b's remote and prune (but leave repo-a's intact)
      await git(join(env.originDir, "repo-b.git"), ["branch", "-D", "feat/auth"]);
      await git(join(env.projectDir, ".arb/repos/repo-b"), ["fetch", "--prune"]);
      try {
        await git(join(env.projectDir, ".arb/repos/repo-b"), ["branch", "-D", "feat/auth"]);
      } catch {
        // Ignore if branch doesn't exist
      }

      // repo-a is truly stacked (base exists), repo-b's base is gone (both remote and local)
      // repo-b is skipped (retarget-base-not-found) but does not block the operation
      const result = await arb(env, ["retarget", "main", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("repo-b");
      expect(result.output).toContain("skipped");
    }));

  test("arb retarget rejects retargeting to the current feature branch", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      const result = await arb(env, ["retarget", "feat/auth-ui"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("current feature branch");
    }));

  test("arb retarget rejects retargeting to the current base branch", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      const result = await arb(env, ["retarget", "feat/auth"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already the configured base");
    }));
});

// ── retarget dirty repo checks ───────────────────────────────────

describe("retarget dirty repo checks", () => {
  test("arb retarget refuses when a stacked repo is dirty", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      const repoB = join(env.projectDir, ".arb/repos/repo-b");
      await git(repoB, ["checkout", "-b", "feat/auth"]);
      await write(join(repoB, "auth.txt"), "auth");
      await git(repoB, ["add", "auth.txt"]);
      await git(repoB, ["commit", "-m", "auth feature"]);
      await git(repoB, ["push", "-u", "origin", "feat/auth"]);
      await git(repoB, ["checkout", "--detach"]);

      // Create stacked workspace with both repos
      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a", "repo-b"]);

      // Add commits on both repos
      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui-a");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui a"]);
      await write(join(env.projectDir, "stacked/repo-b/ui.txt"), "ui-b");
      await git(join(env.projectDir, "stacked/repo-b"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-b"), ["commit", "-m", "ui b"]);

      // Merge feat/auth into main for both
      const tmpMergeA = join(env.testDir, "tmp-merge-a");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMergeA]);
      await git(tmpMergeA, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge auth"]);
      await git(tmpMergeA, ["push"]);
      const tmpMergeB = join(env.testDir, "tmp-merge-b");
      await git(env.testDir, ["clone", join(env.originDir, "repo-b.git"), tmpMergeB]);
      await git(tmpMergeB, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge auth"]);
      await git(tmpMergeB, ["push"]);

      // Make repo-b dirty
      await write(join(env.projectDir, "stacked/repo-b/dirty.txt"), "dirty");

      const result = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot retarget");
      expect(result.output).toContain("repo-b");
      expect(result.output).toContain("uncommitted changes (use --autostash)");
    }));

  test("arb retarget (auto-detect) is all-or-nothing", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      const repoB = join(env.projectDir, ".arb/repos/repo-b");
      await git(repoB, ["checkout", "-b", "feat/auth"]);
      await write(join(repoB, "auth.txt"), "auth");
      await git(repoB, ["add", "auth.txt"]);
      await git(repoB, ["commit", "-m", "auth feature"]);
      await git(repoB, ["push", "-u", "origin", "feat/auth"]);
      await git(repoB, ["checkout", "--detach"]);

      // Create stacked workspace with both repos
      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a", "repo-b"]);

      // Add commits on both
      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui-a");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui a"]);
      await write(join(env.projectDir, "stacked/repo-b/ui.txt"), "ui-b");
      await git(join(env.projectDir, "stacked/repo-b"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-b"), ["commit", "-m", "ui b"]);

      // Merge feat/auth into main for repo-a only (via tmp clone)
      const tmpMerge1 = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge1]);
      await git(tmpMerge1, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge auth"]);
      await git(tmpMerge1, ["push"]);
      await rm(tmpMerge1, { recursive: true });

      // Merge feat/auth into main for repo-b (via a fresh tmp clone)
      const tmpMerge2 = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-b.git"), tmpMerge2]);
      await git(tmpMerge2, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge auth"]);
      await git(tmpMerge2, ["push"]);
      await rm(tmpMerge2, { recursive: true });

      // Make repo-a dirty so the all-or-nothing check blocks
      await write(join(env.projectDir, "stacked/repo-a/dirty.txt"), "dirty");

      const result = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot retarget");
      expect(result.output).toContain("repo-a");
    }));
});

// ── retarget with readonly repos ─────────────────────────────────

describe("retarget with readonly repos", () => {
  test("arb retarget proceeds when some repos lack the target branch", () =>
    withEnv(async (env) => {
      // Setup: push feat/auth to both repos
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      const repoB = join(env.projectDir, ".arb/repos/repo-b");
      await git(repoB, ["checkout", "-b", "feat/auth"]);
      await write(join(repoB, "auth.txt"), "auth-b");
      await git(repoB, ["add", "auth.txt"]);
      await git(repoB, ["commit", "-m", "auth feature"]);
      await git(repoB, ["push", "-u", "origin", "feat/auth"]);
      await git(repoB, ["checkout", "--detach"]);

      // Create stacked workspace with both repos
      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a", "repo-b"]);

      // Add feature commits on both
      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui-a");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui a"]);
      await write(join(env.projectDir, "stacked/repo-b/ui.txt"), "ui-b");
      await git(join(env.projectDir, "stacked/repo-b"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-b"), ["commit", "-m", "ui b"]);

      // Push feat/next only to repo-a's origin (not repo-b)
      const tmpPush = join(env.testDir, "tmp-push");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpPush]);
      await git(tmpPush, ["checkout", "-b", "feat/next"]);
      await write(join(tmpPush, "next.txt"), "next");
      await git(tmpPush, ["add", "next.txt"]);
      await git(tmpPush, ["commit", "-m", "next feature"]);
      await git(tmpPush, ["push", "-u", "origin", "feat/next"]);
      await rm(tmpPush, { recursive: true });

      // Retarget should succeed — repo-b is skipped (target not found), repo-a proceeds
      const result = await arb(env, ["retarget", "feat/next", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("repo-b");
      expect(result.output).toContain("skipped");

      // Verify workspace config updated with new base
      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBe("feat/next");
    }));

  test("arb retarget still blocks when a repo is dirty", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      const repoB = join(env.projectDir, ".arb/repos/repo-b");
      await git(repoB, ["checkout", "-b", "feat/auth"]);
      await write(join(repoB, "auth.txt"), "auth-b");
      await git(repoB, ["add", "auth.txt"]);
      await git(repoB, ["commit", "-m", "auth feature"]);
      await git(repoB, ["push", "-u", "origin", "feat/auth"]);
      await git(repoB, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a", "repo-b"]);

      // Add feature commits
      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui-a");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui a"]);

      // Push feat/next only to repo-a's origin
      const tmpPush = join(env.testDir, "tmp-push");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpPush]);
      await git(tmpPush, ["checkout", "-b", "feat/next"]);
      await write(join(tmpPush, "next.txt"), "next");
      await git(tmpPush, ["add", "next.txt"]);
      await git(tmpPush, ["commit", "-m", "next feature"]);
      await git(tmpPush, ["push", "-u", "origin", "feat/next"]);
      await rm(tmpPush, { recursive: true });

      // Make repo-a dirty — should block retarget even though repo-b is just "not found"
      await write(join(env.projectDir, "stacked/repo-a/dirty.txt"), "dirty");

      const result = await arb(env, ["retarget", "feat/next", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot retarget");
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("uncommitted changes");
    }));

  test("arb retarget fails when target not found on any repo", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      const result = await arb(env, ["retarget", "totally-nonexistent", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not found");
    }));
});

// ── retarget with autostash ──────────────────────────────────────

describe("retarget with autostash", () => {
  test("arb retarget --autostash stashes dirty repo during retarget", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui feature"]);

      // Merge feat/auth into main
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);

      // Make worktree dirty (staged file)
      await write(join(env.projectDir, "stacked/repo-a/dirty.txt"), "dirty");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "dirty.txt"]);

      const result = await arb(env, ["retarget", "--autostash", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("Retargeted");

      expect(existsSync(join(env.projectDir, "stacked/repo-a/dirty.txt"))).toBe(true);

      const logOutput = await git(join(env.projectDir, "stacked/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("ui feature");
    }));

  test("arb retarget refuses dirty repo without --autostash but succeeds with it", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      const repoB = join(env.projectDir, ".arb/repos/repo-b");
      await git(repoB, ["checkout", "-b", "feat/auth"]);
      await write(join(repoB, "auth.txt"), "auth");
      await git(repoB, ["add", "auth.txt"]);
      await git(repoB, ["commit", "-m", "auth feature"]);
      await git(repoB, ["push", "-u", "origin", "feat/auth"]);
      await git(repoB, ["checkout", "--detach"]);

      // Create stacked workspace with both repos
      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a", "repo-b"]);

      // Add commits
      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui-a");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui a"]);
      await write(join(env.projectDir, "stacked/repo-b/ui.txt"), "ui-b");
      await git(join(env.projectDir, "stacked/repo-b"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-b"), ["commit", "-m", "ui b"]);

      // Merge feat/auth into main for both
      const tmpMergeA = join(env.testDir, "tmp-merge-a");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMergeA]);
      await git(tmpMergeA, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge auth"]);
      await git(tmpMergeA, ["push"]);
      const tmpMergeB = join(env.testDir, "tmp-merge-b");
      await git(env.testDir, ["clone", join(env.originDir, "repo-b.git"), tmpMergeB]);
      await git(tmpMergeB, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge auth"]);
      await git(tmpMergeB, ["push"]);

      // Make repo-b dirty
      await write(join(env.projectDir, "stacked/repo-b/dirty.txt"), "dirty");
      await git(join(env.projectDir, "stacked/repo-b"), ["add", "dirty.txt"]);

      // Without --autostash should fail (all-or-nothing)
      const failResult = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(failResult.exitCode).not.toBe(0);
      expect(failResult.output).toContain("Cannot retarget");

      // With --autostash should succeed
      const successResult = await arb(env, ["retarget", "--autostash", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(successResult.exitCode).toBe(0);
      expect(successResult.output).toContain("Retargeted");

      expect(existsSync(join(env.projectDir, "stacked/repo-b/dirty.txt"))).toBe(true);
    }));
});

// ── retarget non-merged base (new scenarios) ─────────────────────

describe("retarget non-merged base (new scenarios)", () => {
  test("retarget from main to feature1 (non-merged, explicit branch)", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");

      // Create feature1 branch with a commit
      await git(repoA, ["checkout", "-b", "feature1"]);
      await write(join(repoA, "f1.txt"), "feature1-content");
      await git(repoA, ["add", "f1.txt"]);
      await git(repoA, ["commit", "-m", "feature1 commit"]);
      await git(repoA, ["push", "-u", "origin", "feature1"]);
      await git(repoA, ["checkout", "--detach"]);

      // Create a workspace with no base (default = main)
      await arb(env, ["create", "my-ws", "-b", "feat/work", "repo-a"]);

      // Add a commit on the workspace branch
      await write(join(env.projectDir, "my-ws/repo-a/work.txt"), "work-content");
      await git(join(env.projectDir, "my-ws/repo-a"), ["add", "work.txt"]);
      await git(join(env.projectDir, "my-ws/repo-a"), ["commit", "-m", "work commit"]);

      // Verify config has no base initially
      const beforeConfig = await readFile(join(env.projectDir, "my-ws/.arbws/config.json"), "utf-8");
      expect(JSON.parse(beforeConfig).base).toBeUndefined();

      // Retarget to feature1
      const result = await arb(env, ["retarget", "feature1", "--yes"], {
        cwd: join(env.projectDir, "my-ws"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");

      // Config updated to base: "feature1"
      const afterConfig = await readFile(join(env.projectDir, "my-ws/.arbws/config.json"), "utf-8");
      expect(JSON.parse(afterConfig).base).toBe("feature1");

      // Commits are rebased onto feature1
      const logOutput = await git(join(env.projectDir, "my-ws/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("work commit");
      expect(logOutput).toContain("feature1 commit");
    }));

  test("retarget to default when base is not merged (unstack)", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");

      // Create feature1 branch with a commit
      await git(repoA, ["checkout", "-b", "feature1"]);
      await write(join(repoA, "f1.txt"), "feature1-content");
      await git(repoA, ["add", "f1.txt"]);
      await git(repoA, ["commit", "-m", "feature1 commit"]);
      await git(repoA, ["push", "-u", "origin", "feature1"]);
      await git(repoA, ["checkout", "--detach"]);

      // Create stacked workspace with base = feature1
      await arb(env, ["create", "stacked", "--base", "feature1", "-b", "feat/stacked-work", "repo-a"]);

      // Add a commit on the workspace branch
      await write(join(env.projectDir, "stacked/repo-a/stacked-work.txt"), "stacked-content");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "stacked-work.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "stacked work"]);

      // Verify base is feature1 initially
      const beforeConfig = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(beforeConfig).base).toBe("feature1");

      // Retarget to main (unstack)
      const result = await arb(env, ["retarget", "main", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Retargeted");

      // Config base is unset (retargeted to default branch)
      const afterConfig = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(afterConfig).base).toBeUndefined();
    }));

  test("error when no configured base and no arg", () =>
    withEnv(async (env) => {
      // Create a workspace with no base (default = main)
      await arb(env, ["create", "my-ws", "-b", "feat/plain", "repo-a"]);

      // Verify config has no base
      const config = await readFile(join(env.projectDir, "my-ws/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();

      // Run retarget with no argument — should fail since there's no configured base
      const result = await arb(env, ["retarget"], {
        cwd: join(env.projectDir, "my-ws"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No configured base");
    }));

  test("error when retargeting to the same base (no-op)", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");

      // Create feature1 branch
      await git(repoA, ["checkout", "-b", "feature1"]);
      await write(join(repoA, "f1.txt"), "feature1-content");
      await git(repoA, ["add", "f1.txt"]);
      await git(repoA, ["commit", "-m", "feature1 commit"]);
      await git(repoA, ["push", "-u", "origin", "feature1"]);
      await git(repoA, ["checkout", "--detach"]);

      // Create stacked workspace with base = feature1
      await arb(env, ["create", "stacked", "--base", "feature1", "-b", "feat/stacked-work", "repo-a"]);

      // Retarget to the same base — should be a no-op
      const result = await arb(env, ["retarget", "feature1"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already the configured base branch");
    }));

  test("error when retargeting to current default base with no configured base", () =>
    withEnv(async (env) => {
      // Create workspace with no configured base (effective base = main)
      await arb(env, ["create", "my-ws", "-b", "feat/work", "repo-a"]);

      // Add a commit so the repo has work ahead of main
      await write(join(env.projectDir, "my-ws/repo-a/work.txt"), "content");
      await git(join(env.projectDir, "my-ws/repo-a"), ["add", "work.txt"]);
      await git(join(env.projectDir, "my-ws/repo-a"), ["commit", "-m", "work"]);

      // Retarget to main — but main is already the effective base
      const result = await arb(env, ["retarget", "main"], {
        cwd: join(env.projectDir, "my-ws"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already based on main (use 'arb rebase' to sync)");
    }));

  test("retarget with --dry-run shows plan", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui feature"]);

      // Merge feat/auth into main
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);

      const result = await arb(env, ["retarget", "--dry-run"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("rebase onto");
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Retargeted");

      // Verify the retarget didn't actually happen — config should still have feat/auth
      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBe("feat/auth");
    }));

  test("config unchanged if retarget has conflicts", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");

      // Create feat/auth with a file
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "shared.txt"), "auth-version");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);

      // Create feat/other from main (not from feat/auth) with a conflicting file
      await git(repoA, ["checkout", "main"]);
      await git(repoA, ["checkout", "-b", "feat/other"]);
      await write(join(repoA, "shared.txt"), "other-version-conflicting");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "other feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/other"]);
      await git(repoA, ["checkout", "--detach"]);

      // Create stacked workspace based on feat/auth
      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/stacked", "repo-a"]);

      // Add a commit that modifies shared.txt to create a conflict
      await write(join(env.projectDir, "stacked/repo-a/shared.txt"), "stacked-version-conflicting");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "shared.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "stacked change"]);

      // Verify config has base = feat/auth before retarget
      const beforeConfig = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(beforeConfig).base).toBe("feat/auth");

      // Retarget to feat/other — should conflict because shared.txt differs
      const result = await arb(env, ["retarget", "feat/other", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("CONFLICT");

      // Verify config is NOT updated — still has feat/auth
      const afterConfig = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(afterConfig).base).toBe("feat/auth");
    }));
});

// ── retarget blocker scenarios ───────────────────────────────────

describe("retarget blocker scenarios", () => {
  test("skips repo on wrong branch", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      // Switch repo-a to a different branch
      await git(join(env.projectDir, "stacked/repo-a"), ["checkout", "-b", "experiment"]);

      const result = await arb(env, ["retarget", "main", "--dry-run"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.output).toContain("wrong");
      expect(result.output).toContain("skipped");
    }));

  test("--include-wrong-branch includes repos on a different branch", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);
      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui feature"]);

      // Switch repo-a to a different branch
      await git(join(env.projectDir, "stacked/repo-a"), ["checkout", "-b", "experiment"]);

      const result = await arb(env, ["retarget", "main", "--include-wrong-branch", "--dry-run"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("rebase onto");
      expect(result.output).not.toContain("skipped");
    }));

  test("skips repo with detached HEAD", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      // Detach HEAD in the worktree
      await git(join(env.projectDir, "stacked/repo-a"), ["checkout", "--detach"]);

      const result = await arb(env, ["retarget", "main", "--dry-run"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.output).toContain("detached");
      expect(result.output).toContain("skipped");
    }));

  test("skips repo with operation in progress", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "line1");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      // Create two commits with conflicting changes on the same branch to trigger a rebase conflict
      const wt = join(env.projectDir, "stacked/repo-a");
      await write(join(wt, "conflict.txt"), "version-A");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "commit A"]);

      // Push a conflicting change to origin so we can cherry-pick and conflict
      const tmpClone = join(env.testDir, "tmp-conflict");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "feat/auth"]);
      await write(join(tmpClone, "conflict.txt"), "version-B-conflict");
      await git(tmpClone, ["add", "conflict.txt"]);
      await git(tmpClone, ["commit", "-m", "commit B conflict"]);
      const commitHash = (await git(tmpClone, ["rev-parse", "HEAD"])).trim();
      await git(tmpClone, ["push"]);

      // Fetch and cherry-pick to create a conflict, leaving operation in progress
      await git(wt, ["fetch", "origin"]);
      try {
        await git(wt, ["cherry-pick", commitHash]);
      } catch {
        // Expected to fail with conflict — leaves cherry-pick in progress
      }

      const result = await arb(env, ["retarget", "main", "--dry-run"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.output).toContain("in progress");
      expect(result.output).toContain("skipped");
    }));
});

// ── retarget (deep stack chain walking) ─────────────────────────

describe("retarget (deep stack chain walking)", () => {
  test("arb retarget follows stack chain to non-merged ancestor", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");

      // Create feat/a branch and push
      await git(repoA, ["checkout", "-b", "feat/a"]);
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "feat a"]);
      await git(repoA, ["push", "-u", "origin", "feat/a"]);
      await git(repoA, ["checkout", "--detach"]);

      // Create workspace ws-a on feat/a
      await arb(env, ["create", "ws-a", "-b", "feat/a", "repo-a"]);

      // Create feat/b branch stacking on feat/a
      await arb(env, ["create", "ws-b", "--base", "feat/a", "-b", "feat/b", "repo-a"]);
      await write(join(env.projectDir, "ws-b/repo-a/b.txt"), "b");
      await git(join(env.projectDir, "ws-b/repo-a"), ["add", "b.txt"]);
      await git(join(env.projectDir, "ws-b/repo-a"), ["commit", "-m", "feat b"]);
      await git(join(env.projectDir, "ws-b/repo-a"), ["push", "-u", "origin", "feat/b"]);

      // Create feat/c branch stacking on feat/b
      await arb(env, ["create", "ws-c", "--base", "feat/b", "-b", "feat/c", "repo-a"]);
      await write(join(env.projectDir, "ws-c/repo-a/c.txt"), "c");
      await git(join(env.projectDir, "ws-c/repo-a"), ["add", "c.txt"]);
      await git(join(env.projectDir, "ws-c/repo-a"), ["commit", "-m", "feat c"]);

      // Squash-merge feat/b into main (simulating GitHub merge)
      const tmpMerge = join(env.testDir, "tmp-merge-chain");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "--squash", "origin/feat/b"]);
      await git(tmpMerge, ["commit", "-m", "squash: feat b"]);
      await git(tmpMerge, ["push"]);

      // Retarget ws-c: should follow chain feat/b -> feat/a (not fall to main)
      const result = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "ws-c"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("following stack chain to feat/a");
      expect(result.output).toContain("base branch changed from feat/b to feat/a");
      expect(result.output).toContain("via stack");

      // Verify config has base: feat/a (not cleared)
      const config = JSON.parse(await readFile(join(env.projectDir, "ws-c/.arbws/config.json"), "utf-8"));
      expect(config.base).toBe("feat/a");
    }));

  test("arb retarget walks through multiple merged ancestors", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");

      // Create feat/a, push
      await git(repoA, ["checkout", "-b", "feat/a"]);
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "feat a"]);
      await git(repoA, ["push", "-u", "origin", "feat/a"]);
      await git(repoA, ["checkout", "--detach"]);

      // ws-a
      await arb(env, ["create", "ws-a", "-b", "feat/a", "repo-a"]);

      // feat/b stacking on feat/a
      await arb(env, ["create", "ws-b", "--base", "feat/a", "-b", "feat/b", "repo-a"]);
      await write(join(env.projectDir, "ws-b/repo-a/b.txt"), "b");
      await git(join(env.projectDir, "ws-b/repo-a"), ["add", "b.txt"]);
      await git(join(env.projectDir, "ws-b/repo-a"), ["commit", "-m", "feat b"]);
      await git(join(env.projectDir, "ws-b/repo-a"), ["push", "-u", "origin", "feat/b"]);

      // feat/c stacking on feat/b
      await arb(env, ["create", "ws-c", "--base", "feat/b", "-b", "feat/c", "repo-a"]);
      await write(join(env.projectDir, "ws-c/repo-a/c.txt"), "c");
      await git(join(env.projectDir, "ws-c/repo-a"), ["add", "c.txt"]);
      await git(join(env.projectDir, "ws-c/repo-a"), ["commit", "-m", "feat c"]);
      await git(join(env.projectDir, "ws-c/repo-a"), ["push", "-u", "origin", "feat/c"]);

      // feat/d stacking on feat/c
      await arb(env, ["create", "ws-d", "--base", "feat/c", "-b", "feat/d", "repo-a"]);
      await write(join(env.projectDir, "ws-d/repo-a/d.txt"), "d");
      await git(join(env.projectDir, "ws-d/repo-a"), ["add", "d.txt"]);
      await git(join(env.projectDir, "ws-d/repo-a"), ["commit", "-m", "feat d"]);

      // Merge both feat/b and feat/c into main via merge commits
      const tmpMerge = join(env.testDir, "tmp-merge-deep");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/b", "--no-ff", "-m", "merge feat/b"]);
      await git(tmpMerge, ["merge", "origin/feat/c", "--no-ff", "-m", "merge feat/c"]);
      await git(tmpMerge, ["push"]);

      // Add a new commit to feat/a (so it's no longer fully merged — has work beyond main)
      await write(join(env.projectDir, "ws-a/repo-a/a2.txt"), "a2");
      await git(join(env.projectDir, "ws-a/repo-a"), ["add", "a2.txt"]);
      await git(join(env.projectDir, "ws-a/repo-a"), ["commit", "-m", "feat a continued"]);
      await git(join(env.projectDir, "ws-a/repo-a"), ["push", "origin", "feat/a"]);

      // Retarget ws-d: should walk feat/c -> feat/b -> feat/a (not merged due to new commit)
      const result = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "ws-d"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("following stack chain to feat/a");

      const config = JSON.parse(await readFile(join(env.projectDir, "ws-d/.arbws/config.json"), "utf-8"));
      expect(config.base).toBe("feat/a");
    }));

  test("arb retarget falls back to default when intermediate workspace is deleted", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");

      // Create feat/a, push
      await git(repoA, ["checkout", "-b", "feat/a"]);
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "feat a"]);
      await git(repoA, ["push", "-u", "origin", "feat/a"]);
      await git(repoA, ["checkout", "--detach"]);

      // ws-a
      await arb(env, ["create", "ws-a", "-b", "feat/a", "repo-a"]);

      // feat/b stacking on feat/a
      await arb(env, ["create", "ws-b", "--base", "feat/a", "-b", "feat/b", "repo-a"]);
      await write(join(env.projectDir, "ws-b/repo-a/b.txt"), "b");
      await git(join(env.projectDir, "ws-b/repo-a"), ["add", "b.txt"]);
      await git(join(env.projectDir, "ws-b/repo-a"), ["commit", "-m", "feat b"]);
      await git(join(env.projectDir, "ws-b/repo-a"), ["push", "-u", "origin", "feat/b"]);

      // feat/c stacking on feat/b
      await arb(env, ["create", "ws-c", "--base", "feat/b", "-b", "feat/c", "repo-a"]);
      await write(join(env.projectDir, "ws-c/repo-a/c.txt"), "c");
      await git(join(env.projectDir, "ws-c/repo-a"), ["add", "c.txt"]);
      await git(join(env.projectDir, "ws-c/repo-a"), ["commit", "-m", "feat c"]);

      // Squash-merge feat/b into main
      const tmpMerge = join(env.testDir, "tmp-merge-deleted");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "--squash", "origin/feat/b"]);
      await git(tmpMerge, ["commit", "-m", "squash: feat b"]);
      await git(tmpMerge, ["push"]);

      // Delete ws-b workspace (breaks the chain)
      await arb(env, ["delete", "ws-b", "--yes"]);

      // Retarget ws-c: chain is broken, should fall back to default (main)
      const result = await arb(env, ["retarget", "--yes"], {
        cwd: join(env.projectDir, "ws-c"),
      });
      expect(result.exitCode).toBe(0);
      // Should NOT mention "following stack chain" since ws-b is deleted
      expect(result.output).not.toContain("following stack chain");
      expect(result.output).toContain("base branch changed from feat/b to main");

      const config = JSON.parse(await readFile(join(env.projectDir, "ws-c/.arbws/config.json"), "utf-8"));
      expect(config.base).toBeUndefined();
    }));

  test("explicit target overrides chain walk", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");

      // Create feat/a, push
      await git(repoA, ["checkout", "-b", "feat/a"]);
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "feat a"]);
      await git(repoA, ["push", "-u", "origin", "feat/a"]);
      await git(repoA, ["checkout", "--detach"]);

      // ws-a
      await arb(env, ["create", "ws-a", "-b", "feat/a", "repo-a"]);

      // feat/b stacking on feat/a
      await arb(env, ["create", "ws-b", "--base", "feat/a", "-b", "feat/b", "repo-a"]);
      await write(join(env.projectDir, "ws-b/repo-a/b.txt"), "b");
      await git(join(env.projectDir, "ws-b/repo-a"), ["add", "b.txt"]);
      await git(join(env.projectDir, "ws-b/repo-a"), ["commit", "-m", "feat b"]);
      await git(join(env.projectDir, "ws-b/repo-a"), ["push", "-u", "origin", "feat/b"]);

      // feat/c stacking on feat/b
      await arb(env, ["create", "ws-c", "--base", "feat/b", "-b", "feat/c", "repo-a"]);
      await write(join(env.projectDir, "ws-c/repo-a/c.txt"), "c");
      await git(join(env.projectDir, "ws-c/repo-a"), ["add", "c.txt"]);
      await git(join(env.projectDir, "ws-c/repo-a"), ["commit", "-m", "feat c"]);

      // Squash-merge feat/b into main
      const tmpMerge = join(env.testDir, "tmp-merge-explicit");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "--squash", "origin/feat/b"]);
      await git(tmpMerge, ["commit", "-m", "squash: feat b"]);
      await git(tmpMerge, ["push"]);

      // Explicit retarget to main (overrides chain walk)
      const result = await arb(env, ["retarget", "main", "--yes"], {
        cwd: join(env.projectDir, "ws-c"),
      });
      expect(result.exitCode).toBe(0);
      // Should NOT mention "following stack chain" since target is explicit
      expect(result.output).not.toContain("following stack chain");
      expect(result.output).toContain("base branch changed from feat/b to main");

      const config = JSON.parse(await readFile(join(env.projectDir, "ws-c/.arbws/config.json"), "utf-8"));
      expect(config.base).toBeUndefined();
    }));
});
