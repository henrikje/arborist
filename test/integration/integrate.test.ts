import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { arb, fetchAllRepos, git, withEnv, write } from "./helpers/env";

// ── rebase ───────────────────────────────────────────────────────

describe("rebase", () => {
  test("arb rebase rebases feature branch onto updated base", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream change"]);
      await git(mainRepoA, ["push"]);

      const result = await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fetched");
      expect(result.output).toContain("Rebased");

      const logOutput = await git(join(env.projectDir, "my-feature/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("upstream change");
    }));

  test("arb rebase plan shows HEAD SHA", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream"]);
      await git(mainRepoA, ["push"]);

      const expectedSha = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["rev-parse", "--short", "HEAD"])
      ).trim();
      const result = await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain(`HEAD ${expectedSha}`);
    }));

  test("arb rebase continues past conflict and shows consolidated report", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      await write(join(env.projectDir, "my-feature/repo-a/conflict.txt"), "feature");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "conflict.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feature change"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "conflict.txt"), "upstream-conflict");
      await git(mainRepoA, ["add", "conflict.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream conflict"]);
      await git(mainRepoA, ["push"]);

      const mainRepoB = join(env.projectDir, ".arb/repos/repo-b");
      await write(join(mainRepoB, "ok.txt"), "upstream-ok");
      await git(mainRepoB, ["add", "ok.txt"]);
      await git(mainRepoB, ["commit", "-m", "upstream ok"]);
      await git(mainRepoB, ["push"]);

      const result = await arb(env, ["rebase", "repo-a", "repo-b", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("CONFLICT");
      expect(result.output).toContain("conflict.txt");
      expect(result.output).toContain("conflict");
      expect(result.output).toContain("git rebase --continue");
      expect(result.output).toContain("git rebase --abort");
      expect(result.output).toContain("Rebased 1 repo, 1 conflicted");
    }));

  test("arb rebase with specific repos only processes those repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream"]);
      await git(mainRepoA, ["push"]);

      const result = await arb(env, ["rebase", "repo-a", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Rebased 1 repo");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb rebase repo-a only fetches named repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream"]);
      await git(mainRepoA, ["push"]);

      const result = await arb(env, ["rebase", "repo-a", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fetched 1 repo");
      expect(result.output).toContain("Rebased 1 repo");
    }));

  test("arb rebase with custom base branch", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      // Push a new commit to feat/auth on origin
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "feat/auth"]);
      await write(join(tmpClone, "new-auth.txt"), "new-auth");
      await git(tmpClone, ["add", "new-auth.txt"]);
      await git(tmpClone, ["commit", "-m", "new auth commit"]);
      await git(tmpClone, ["push"]);

      const result = await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "stacked") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toMatch(/rebase feat\/auth-ui onto.*feat\/auth/);
      expect(result.output).toContain("Rebased");

      const logOutput = await git(join(env.projectDir, "stacked/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("new auth commit");
    }));
});

// ── merge ────────────────────────────────────────────────────────

describe("merge", () => {
  test("arb merge merges base branch into feature branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream change"]);
      await git(mainRepoA, ["push"]);

      const result = await arb(env, ["merge", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fetched");
      expect(result.output).toContain("Merged");

      const logOutput = await git(join(env.projectDir, "my-feature/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("upstream change");
    }));

  test("arb merge plan shows HEAD SHA", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream"]);
      await git(mainRepoA, ["push"]);

      const expectedSha = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["rev-parse", "--short", "HEAD"])
      ).trim();
      const result = await arb(env, ["merge", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain(`HEAD ${expectedSha}`);
    }));

  test("arb merge continues past conflict and shows consolidated report", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      await write(join(env.projectDir, "my-feature/repo-a/conflict.txt"), "feature");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "conflict.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feature change"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "conflict.txt"), "upstream-conflict");
      await git(mainRepoA, ["add", "conflict.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream conflict"]);
      await git(mainRepoA, ["push"]);

      const mainRepoB = join(env.projectDir, ".arb/repos/repo-b");
      await write(join(mainRepoB, "ok.txt"), "upstream-ok");
      await git(mainRepoB, ["add", "ok.txt"]);
      await git(mainRepoB, ["commit", "-m", "upstream ok"]);
      await git(mainRepoB, ["push"]);

      const result = await arb(env, ["merge", "repo-a", "repo-b", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("CONFLICT");
      expect(result.output).toContain("conflict.txt");
      expect(result.output).toContain("conflict");
      expect(result.output).toContain("git merge --continue");
      expect(result.output).toContain("git merge --abort");
      expect(result.output).toContain("Merged 1 repo, 1 conflicted");
    }));
});

// ── rebase+push end-to-end ──────────────────────────────────────

describe("rebase+push end-to-end", () => {
  test("arb rebase then push --force end-to-end", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "feature");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feature"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream"]);
      await git(mainRepoA, ["push"]);

      const rebaseResult = await arb(env, ["rebase", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(rebaseResult.exitCode).toBe(0);
      expect(rebaseResult.output).toContain("Rebased");

      const pushResult = await arb(env, ["push", "--force", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(pushResult.exitCode).toBe(0);
      expect(pushResult.output).toContain("Pushed");

      await git(join(env.projectDir, ".arb/repos/repo-a"), ["fetch", "origin", "my-feature"]);
      const logOutput = await git(join(env.projectDir, ".arb/repos/repo-a"), ["log", "--oneline", "origin/my-feature"]);
      expect(logOutput).toContain("feature");
      expect(logOutput).toContain("upstream");
    }));
});

// ── autostash ─────────────────────────────────────────────────────

describe("autostash", () => {
  test("arb rebase --autostash stashes and rebases dirty repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream"]);
      await git(mainRepoA, ["push"]);

      // Make worktree dirty (modified file)
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "dirty.txt"]);

      const result = await arb(env, ["rebase", "--autostash", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Rebased");

      const logOutput = await git(join(env.projectDir, "my-feature/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("upstream");

      expect(existsSync(join(env.projectDir, "my-feature/repo-a/dirty.txt"))).toBe(true);
    }));

  test("arb merge --autostash stashes and merges dirty repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream change"]);
      await git(mainRepoA, ["push"]);

      // Make worktree dirty (modified file)
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "dirty.txt"]);

      const result = await arb(env, ["merge", "--autostash", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Merged");

      const logOutput = await git(join(env.projectDir, "my-feature/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("upstream change");

      expect(existsSync(join(env.projectDir, "my-feature/repo-a/dirty.txt"))).toBe(true);
    }));

  test("arb pull --autostash stashes and pulls dirty repo (rebase)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const wt = join(env.projectDir, "my-feature/repo-a");
      await write(join(wt, "local.txt"), "local");
      await git(wt, ["add", "local.txt"]);
      await git(wt, ["commit", "-m", "local"]);
      await git(wt, ["push", "-u", "origin", "my-feature"]);

      // Push a remote commit to the feature branch via a tmp clone
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "remote.txt"), "remote");
      await git(tmpClone, ["add", "remote.txt"]);
      await git(tmpClone, ["commit", "-m", "remote"]);
      await git(tmpClone, ["push"]);

      // Make worktree dirty
      await write(join(wt, "dirty.txt"), "dirty");
      await git(wt, ["add", "dirty.txt"]);

      const result = await arb(env, ["pull", "--autostash", "--rebase", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pulled");

      const logOutput = await git(wt, ["log", "--oneline"]);
      expect(logOutput).toContain("remote");

      expect(existsSync(join(wt, "dirty.txt"))).toBe(true);
    }));

  test("arb pull --autostash stashes and pulls dirty repo (merge)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const wt = join(env.projectDir, "my-feature/repo-a");
      await write(join(wt, "local.txt"), "local");
      await git(wt, ["add", "local.txt"]);
      await git(wt, ["commit", "-m", "local"]);
      await git(wt, ["push", "-u", "origin", "my-feature"]);

      // Push a remote commit to the feature branch via a tmp clone
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "remote.txt"), "remote");
      await git(tmpClone, ["add", "remote.txt"]);
      await git(tmpClone, ["commit", "-m", "remote"]);
      await git(tmpClone, ["push"]);

      // Make worktree dirty
      await write(join(wt, "dirty.txt"), "dirty");
      await git(wt, ["add", "dirty.txt"]);

      const result = await arb(env, ["pull", "--autostash", "--merge", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pulled");

      const logOutput = await git(wt, ["log", "--oneline"]);
      expect(logOutput).toContain("remote");

      expect(existsSync(join(wt, "dirty.txt"))).toBe(true);
    }));

  test("arb rebase --retarget --autostash stashes dirty repo during retarget", () =>
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

      const result = await arb(env, ["rebase", "--retarget", "--autostash", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget");
      expect(result.output).toContain("Retargeted");

      expect(existsSync(join(env.projectDir, "stacked/repo-a/dirty.txt"))).toBe(true);

      const logOutput = await git(join(env.projectDir, "stacked/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("ui feature");
    }));

  test("arb rebase --retarget refuses dirty repo without --autostash but succeeds with it", () =>
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
      const failResult = await arb(env, ["rebase", "--retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(failResult.exitCode).not.toBe(0);
      expect(failResult.output).toContain("Cannot retarget");

      // With --autostash should succeed
      const successResult = await arb(env, ["rebase", "--retarget", "--autostash", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(successResult.exitCode).toBe(0);
      expect(successResult.output).toContain("Retargeted");

      expect(existsSync(join(env.projectDir, "stacked/repo-b/dirty.txt"))).toBe(true);
    }));

  test("arb rebase --autostash with multiple repos (mixed dirty/clean)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      // Push upstream changes to both repos
      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream-a");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream a"]);
      await git(mainRepoA, ["push"]);
      const mainRepoB = join(env.projectDir, ".arb/repos/repo-b");
      await write(join(mainRepoB, "upstream.txt"), "upstream-b");
      await git(mainRepoB, ["add", "upstream.txt"]);
      await git(mainRepoB, ["commit", "-m", "upstream b"]);
      await git(mainRepoB, ["push"]);

      // Make only repo-a dirty
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "dirty.txt"]);

      const result = await arb(env, ["rebase", "--autostash", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Rebased 2 repos");
      expect(result.output).toContain("autostash");

      const logA = await git(join(env.projectDir, "my-feature/repo-a"), ["log", "--oneline"]);
      expect(logA).toContain("upstream a");
      const logB = await git(join(env.projectDir, "my-feature/repo-b"), ["log", "--oneline"]);
      expect(logB).toContain("upstream b");

      expect(existsSync(join(env.projectDir, "my-feature/repo-a/dirty.txt"))).toBe(true);
    }));

  test("arb rebase --autostash with repo filter only processes named repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      // Push upstream changes to both repos
      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream-a");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream a"]);
      await git(mainRepoA, ["push"]);
      const mainRepoB = join(env.projectDir, ".arb/repos/repo-b");
      await write(join(mainRepoB, "upstream.txt"), "upstream-b");
      await git(mainRepoB, ["add", "upstream.txt"]);
      await git(mainRepoB, ["commit", "-m", "upstream b"]);
      await git(mainRepoB, ["push"]);

      // Make both repos dirty
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty-a");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "dirty.txt"]);
      await write(join(env.projectDir, "my-feature/repo-b/dirty.txt"), "dirty-b");
      await git(join(env.projectDir, "my-feature/repo-b"), ["add", "dirty.txt"]);

      const result = await arb(env, ["rebase", "--autostash", "--yes", "repo-a"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Rebased 1 repo");

      const logA = await git(join(env.projectDir, "my-feature/repo-a"), ["log", "--oneline"]);
      expect(logA).toContain("upstream a");
    }));

  test("arb pull --autostash reports stash pop failure (merge)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const wt = join(env.projectDir, "my-feature/repo-a");
      await write(join(wt, "shared.txt"), "original");
      await git(wt, ["add", "shared.txt"]);
      await git(wt, ["commit", "-m", "add shared"]);
      await git(wt, ["push", "-u", "origin", "my-feature"]);

      // Push a remote commit that changes the shared file
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "shared.txt"), "remote version");
      await git(tmpClone, ["add", "shared.txt"]);
      await git(tmpClone, ["commit", "-m", "remote change"]);
      await git(tmpClone, ["push"]);

      // Make a local dirty change to the same shared file
      await write(join(wt, "shared.txt"), "dirty version");

      const result = await arb(env, ["pull", "--autostash", "--merge", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("stash pop failed");
      expect(result.output).toContain("manual stash application");
    }));

  test("arb merge --autostash reports stash pop failure", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      // Create a shared file on main
      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "shared.txt"), "original");
      await git(mainRepoA, ["add", "shared.txt"]);
      await git(mainRepoA, ["commit", "-m", "add shared"]);
      await git(mainRepoA, ["push"]);

      // Pull the shared file into the feature branch
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      // Create upstream change to the shared file
      await write(join(mainRepoA, "shared.txt"), "main version");
      await git(mainRepoA, ["add", "shared.txt"]);
      await git(mainRepoA, ["commit", "-m", "main change"]);
      await git(mainRepoA, ["push"]);

      // Make a dirty change to the same shared file (will conflict on stash pop)
      await write(join(env.projectDir, "my-feature/repo-a/shared.txt"), "dirty version");

      const result = await arb(env, ["merge", "--autostash", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("stash pop failed");
      expect(result.output).toContain("manual stash application");
      expect(result.output).toContain("git stash pop");
    }));
});

// ── --verbose ────────────────────────────────────────────────────

describe("--verbose", () => {
  test("arb rebase --verbose --dry-run shows incoming commit subjects", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "v1.txt"), "change1");
      await git(mainRepoA, ["add", "v1.txt"]);
      await git(mainRepoA, ["commit", "-m", "feat: first upstream change"]);
      await git(mainRepoA, ["push"]);
      await write(join(mainRepoA, "v2.txt"), "change2");
      await git(mainRepoA, ["add", "v2.txt"]);
      await git(mainRepoA, ["commit", "-m", "fix: second upstream change"]);
      await git(mainRepoA, ["push"]);

      const result = await arb(env, ["rebase", "--verbose", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Incoming from origin/main");
      expect(result.output).toContain("feat: first upstream change");
      expect(result.output).toContain("fix: second upstream change");
    }));

  test("arb merge --verbose --dry-run shows incoming commit subjects", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "v1.txt"), "change1");
      await git(mainRepoA, ["add", "v1.txt"]);
      await git(mainRepoA, ["commit", "-m", "feat: merge verbose test"]);
      await git(mainRepoA, ["push"]);

      const result = await arb(env, ["merge", "--verbose", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Incoming from origin/main");
      expect(result.output).toContain("feat: merge verbose test");
    }));

  test("arb rebase --dry-run without --verbose does not show commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "v1.txt"), "change1");
      await git(mainRepoA, ["add", "v1.txt"]);
      await git(mainRepoA, ["commit", "-m", "feat: should not appear"]);
      await git(mainRepoA, ["push"]);

      const result = await arb(env, ["rebase", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("Incoming from");
      expect(result.output).not.toContain("feat: should not appear");
    }));
});

// ── diverged commit matching in plan ─────────────────────────────

describe("diverged commit matching in plan", () => {
  test("arb rebase --verbose --dry-run skips cherry-picked commit (detected as squash-merged)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/feature.txt"), "feature");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "feature.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feature work"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      // Cherry-pick the feature commit onto main (with a diverging commit first)
      const featureSha = (await git(join(env.projectDir, "my-feature/repo-a"), ["rev-parse", "HEAD"])).trim();
      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream work"]);
      await git(mainRepoA, ["cherry-pick", featureSha]);
      await git(mainRepoA, ["push"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["rebase", "--verbose", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already squash-merged into main");
    }));

  test("arb rebase skips repo that was squash-merged onto base", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/first.txt"), "first");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "first.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "first feature"]);
      await write(join(env.projectDir, "my-feature/repo-a/second.txt"), "second");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "second.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "second feature"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      // Squash merge the feature commits onto main
      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(mainRepoA, ["merge", "--squash", "origin/my-feature"]);
      await git(mainRepoA, ["commit", "-m", "squash: first and second"]);
      await git(mainRepoA, ["push"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["rebase", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already squash-merged into main");
    }));

  test("arb rebase skips squash-merged repo and rebases others", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      // Make feature commits in repo-a and push
      await write(join(env.projectDir, "my-feature/repo-a/feature.txt"), "feature");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "feature.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feature work"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      // Squash merge repo-a's feature into main
      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(mainRepoA, ["merge", "--squash", "origin/my-feature"]);
      await git(mainRepoA, ["commit", "-m", "squash: feature"]);
      await git(mainRepoA, ["push"]);

      // Push an upstream commit to repo-b so it has something to rebase
      const mainRepoB = join(env.projectDir, ".arb/repos/repo-b");
      await write(join(mainRepoB, "upstream.txt"), "upstream");
      await git(mainRepoB, ["add", "upstream.txt"]);
      await git(mainRepoB, ["commit", "-m", "upstream change"]);
      await git(mainRepoB, ["push"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["rebase", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already squash-merged into main");
      expect(result.output).toContain("rebased my-feature onto origin/main");

      // Verify repo-b actually has the upstream commit after rebase
      const logB = await git(join(env.projectDir, "my-feature/repo-b"), ["log", "--oneline"]);
      expect(logB).toContain("upstream change");
    }));

  test("arb rebase --verbose --dry-run shows no match annotations for genuinely different commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/feature.txt"), "feature");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "feature.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feature work"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      // Different commit on main (not a cherry-pick)
      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "upstream.txt"), "upstream");
      await git(mainRepoA, ["add", "upstream.txt"]);
      await git(mainRepoA, ["commit", "-m", "upstream work"]);
      await git(mainRepoA, ["push"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["rebase", "--verbose", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("(same as");
      expect(result.output).not.toContain("(squash of");
    }));
});

// ── --graph flag ────────────────────────────────────────────────

describe("--graph flag", () => {
  test("arb rebase --graph --dry-run shows merge-base line", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "v1.txt"), "change1");
      await git(mainRepoA, ["add", "v1.txt"]);
      await git(mainRepoA, ["commit", "-m", "feat: graph test upstream"]);
      await git(mainRepoA, ["push"]);

      const result = await arb(env, ["rebase", "--graph", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merge-base");
      expect(result.output).toContain("origin/main");
    }));

  test("arb rebase --graph --verbose --dry-run shows commits in graph", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "v1.txt"), "change1");
      await git(mainRepoA, ["add", "v1.txt"]);
      await git(mainRepoA, ["commit", "-m", "feat: graph verbose incoming"]);
      await git(mainRepoA, ["push"]);

      await write(join(env.projectDir, "my-feature/repo-a/local.txt"), "local");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "local.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feat: graph verbose outgoing"]);

      const result = await arb(env, ["rebase", "--graph", "--verbose", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merge-base");
      expect(result.output).toContain("feat: graph verbose incoming");
      expect(result.output).toContain("feat: graph verbose outgoing");
      // Separate "Incoming from..." section should NOT appear when graph is active
      expect(result.output).not.toContain("Incoming from");
    }));

  test("arb merge --graph --dry-run shows graph", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepoA, "v1.txt"), "change1");
      await git(mainRepoA, ["add", "v1.txt"]);
      await git(mainRepoA, ["commit", "-m", "feat: merge graph test"]);
      await git(mainRepoA, ["push"]);

      const result = await arb(env, ["merge", "--graph", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merge-base");
      expect(result.output).toContain("origin/main");
    }));
});

// ── rebase dry-run ───────────────────────────────────────────────

describe("rebase dry-run", () => {
  test("arb rebase --dry-run shows plan without rebasing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      // Push upstream change so rebase has work to do
      await write(join(env.projectDir, ".arb/repos/repo-a/upstream.txt"), "upstream");
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["add", "upstream.txt"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["commit", "-m", "upstream"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["push"]);

      const result = await arb(env, ["rebase", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("rebase my-feature onto");
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Rebased");
      // Verify the upstream commit is NOT reachable (rebase didn't happen)
      const logOutput = await git(join(env.projectDir, "my-feature/repo-a"), ["log", "--oneline"]);
      expect(logOutput).not.toContain("upstream");
    }));
});

// ── merge dry-run ────────────────────────────────────────────────

describe("merge dry-run", () => {
  test("arb merge --dry-run shows plan without merging", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      await write(join(env.projectDir, ".arb/repos/repo-a/upstream.txt"), "upstream");
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["add", "upstream.txt"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["commit", "-m", "upstream"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["push"]);

      const result = await arb(env, ["merge", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toMatch(/merge.*into my-feature/);
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Merged");
      // Verify the upstream commit is NOT reachable (merge didn't happen)
      const logOutput = await git(join(env.projectDir, "my-feature/repo-a"), ["log", "--oneline"]);
      expect(logOutput).not.toContain("upstream");
    }));
});
