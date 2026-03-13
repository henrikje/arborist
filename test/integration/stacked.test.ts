import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { arb, fetchAllRepos, git, withEnv, write } from "./helpers/env";

// ── --base option (stacked PRs) ──────────────────────────────────

describe("--base option (stacked PRs)", () => {
  test("arb create --base stores base in config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "--all-repos"]);
      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).branch).toBe("feat/auth-ui");
      expect(JSON.parse(config).base).toBe("feat/auth");
    }));

  test("arb create --base branches from the specified base", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth-content");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "add auth"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);
      expect(existsSync(join(env.projectDir, "stacked/repo-a/auth.txt"))).toBe(true);
      const content = await readFile(join(env.projectDir, "stacked/repo-a/auth.txt"), "utf-8");
      expect(content).toContain("auth-content");
    }));

  test("arb create without --base has no base key in config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "no-base", "-b", "feat/plain", "--all-repos"]);
      const config = await readFile(join(env.projectDir, "no-base/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).branch).toBe("feat/plain");
      expect(JSON.parse(config).base).toBeUndefined();
    }));

  test("arb create --base with invalid branch name fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "bad-base", "--base", "bad branch name", "-b", "feat/ok", "repo-a"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Invalid base branch name");
    }));

  test("arb attach respects stored base branch", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/base"]);
      await write(join(repoA, "base.txt"), "base-a");
      await git(repoA, ["add", "base.txt"]);
      await git(repoA, ["commit", "-m", "base"]);
      await git(repoA, ["push", "-u", "origin", "feat/base"]);
      await git(repoA, ["checkout", "--detach"]);

      const repoB = join(env.projectDir, ".arb/repos/repo-b");
      await git(repoB, ["checkout", "-b", "feat/base"]);
      await write(join(repoB, "base.txt"), "base-b");
      await git(repoB, ["add", "base.txt"]);
      await git(repoB, ["commit", "-m", "base"]);
      await git(repoB, ["push", "-u", "origin", "feat/base"]);
      await git(repoB, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/base", "-b", "feat/stacked", "repo-a"]);
      expect(existsSync(join(env.projectDir, "stacked/repo-a/base.txt"))).toBe(true);

      await arb(env, ["attach", "repo-b"], { cwd: join(env.projectDir, "stacked") });
      expect(existsSync(join(env.projectDir, "stacked/repo-b/base.txt"))).toBe(true);
      const content = await readFile(join(env.projectDir, "stacked/repo-b/base.txt"), "utf-8");
      expect(content).toContain("base-b");
    }));

  test("arb create --base falls back to default branch when base missing", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "--all-repos"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("base branch 'feat/auth' not found");
      expect(existsSync(join(env.projectDir, "stacked/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "stacked/repo-b"))).toBe(true);
      const branch = (await git(join(env.projectDir, "stacked/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branch).toBe("feat/auth-ui");
    }));

  test("arb attach falls back to default branch when workspace base missing in repo", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/base"]);
      await write(join(repoA, "base.txt"), "base-a");
      await git(repoA, ["add", "base.txt"]);
      await git(repoA, ["commit", "-m", "base"]);
      await git(repoA, ["push", "-u", "origin", "feat/base"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/base", "-b", "feat/stacked", "repo-a"]);
      expect(existsSync(join(env.projectDir, "stacked/repo-a/base.txt"))).toBe(true);

      const result = await arb(env, ["attach", "repo-b"], { cwd: join(env.projectDir, "stacked") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("base branch 'feat/base' not found");
      expect(existsSync(join(env.projectDir, "stacked/repo-b"))).toBe(true);
      const branch = (await git(join(env.projectDir, "stacked/repo-b"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branch).toBe("feat/stacked");
    }));
});

// ── stacked base merge detection ─────────────────────────────────

describe("stacked base merge detection", () => {
  test("arb status detects base branch merged (not deleted)", () =>
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

      // Merge feat/auth into main via merge commit (do NOT delete feat/auth)
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);

      await fetchAllRepos(env);

      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "stacked") });
      expect(result.output).toContain("base merged");

      const whereResult = await arb(env, ["status", "--where", "base-merged"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(whereResult.output).toContain("repo-a");
    }));

  test("arb status detects base branch squash-merged (not deleted)", () =>
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

      await fetchAllRepos(env);

      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "stacked") });
      expect(result.output).toContain("base merged");
    }));

  test("arb rebase --retarget rebases onto default branch (merge commit)", () =>
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

      const result = await arb(env, ["rebase", "--retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget");
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("base branch changed from feat/auth to main");

      const logOutput = await git(join(env.projectDir, "stacked/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("ui feature");
      expect(logOutput).toContain("merge feat/auth");

      // Verify config no longer has base = feat/auth
      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();
    }));

  test("arb rebase --retarget uses --onto for squash-merged base", () =>
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

      const result = await arb(env, ["rebase", "--retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget");
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

  test("arb status --json includes baseMergedIntoDefault", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      // Merge feat/auth into main
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status", "--json"], { cwd: join(env.projectDir, "stacked") });
      expect(result.output).toContain("baseMergedIntoDefault");
      expect(result.output).toContain('"merge"');
    }));

  test("arb list shows base-merged in workspace summary", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      // Merge feat/auth into main via merge commit (do NOT delete feat/auth)
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);

      await fetchAllRepos(env);

      const listResult = await arb(env, ["list"]);
      expect(listResult.output).toContain("base merged");

      const whereResult = await arb(env, ["list", "-w", "base-merged"]);
      expect(whereResult.output).toContain("stacked");
    }));
});

// ── stacked base merge detection (branch deleted) ────────────────

describe("stacked base merge detection (branch deleted)", () => {
  test("arb status detects base branch merged and deleted", () =>
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

      await fetchAllRepos(env);

      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "stacked") });
      expect(result.output).toContain("base merged");
      expect(result.output).not.toContain("base missing");
      expect(result.output).not.toContain("not found");

      const whereResult = await arb(env, ["status", "--where", "base-merged"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(whereResult.output).toContain("repo-a");

      const verboseResult = await arb(env, ["status", "-v"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(verboseResult.output).toContain("has been merged into default");
      expect(verboseResult.output).not.toContain("not found on origin");
    }));

  test("arb status detects base branch squash-merged and deleted", () =>
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

      await fetchAllRepos(env);

      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "stacked") });
      expect(result.output).toContain("base merged");
      expect(result.output).not.toContain("base missing");
      expect(result.output).not.toContain("not found");
    }));

  test("arb push skips when base branch is merged and deleted", () =>
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

      const result = await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "stacked") });
      expect(result.output).toContain("was merged into default");
      expect(result.output).toContain("retarget");
      expect(result.output).toContain("skipped");
    }));

  test("arb pull skips when base branch is merged and deleted", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      // Create stacked workspace and push
      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);
      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui feature"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["push", "-u", "origin", "feat/auth-ui"]);

      // Merge feat/auth into main via merge commit, then DELETE the branch
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);
      await git(tmpMerge, ["push", "origin", "--delete", "feat/auth"]);

      const result = await arb(env, ["pull", "--yes"], { cwd: join(env.projectDir, "stacked") });
      expect(result.output).toContain("was merged into default");
      expect(result.output).toContain("retarget");
      expect(result.output).toContain("skipped");
    }));

  test("arb rebase --retarget works when base branch is merged and deleted", () =>
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

      const result = await arb(env, ["rebase", "--retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget");
      expect(result.output).toContain("Retargeted");
      expect(result.output).toContain("base branch changed from feat/auth to main");

      const logOutput = await git(join(env.projectDir, "stacked/repo-a"), ["log", "--oneline"]);
      expect(logOutput).toContain("ui feature");
      expect(logOutput).toContain("merge feat/auth");

      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();
    }));

  test("arb rebase --retarget works for squash-merged and deleted base", () =>
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

      const result = await arb(env, ["rebase", "--retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget");
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
  test("arb rebase --retarget <branch> retargets to a non-default branch", () =>
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

      const result = await arb(env, ["rebase", "--retarget", "feat/A", "--yes"], {
        cwd: join(env.projectDir, "stacked-C"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget");
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

  test("arb rebase --retarget main clears base config", () =>
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

      const result = await arb(env, ["rebase", "--retarget", "main", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget");
      expect(result.output).toContain("Retargeted");

      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();
    }));

  test("arb rebase --retarget main updates config in no-op retarget path", () =>
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

      const result = await arb(env, ["rebase", "--retarget", "main"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("base branch changed from feat/auth to main");
      expect(result.output).toContain("All repos up to date");

      const after = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(after).base).toBeUndefined();
    }));

  test("arb rebase --retarget nonexistent target fails", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      const result = await arb(env, ["rebase", "--retarget", "nonexistent", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not found");
    }));

  test("arb rebase --retarget shows warning for unmerged base", () =>
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
      const result = await arb(env, ["rebase", "--retarget", "feat/auth", "--dry-run"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("may not be merged");
    }));

  test("arb rebase --retarget blocks when old base ref is missing in truly stacked repo", () =>
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

      // repo-a is truly stacked (base exists), repo-b's base is gone (fell back)
      // Explicit retarget should work for repo-a but repo-b falls back to normal rebase
      const result = await arb(env, ["rebase", "--retarget", "main", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget");
      expect(result.output).toContain("Retargeted");
    }));

  test("arb rebase --retarget refuses when a stacked repo is dirty", () =>
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

      const result = await arb(env, ["rebase", "--retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot retarget");
      expect(result.output).toContain("repo-b");
      expect(result.output).toContain("uncommitted changes (use --autostash)");
    }));

  test("arb rebase --retarget (auto-detect) is all-or-nothing", () =>
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

      const result = await arb(env, ["rebase", "--retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot retarget");
      expect(result.output).toContain("repo-a");
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

      const result = await arb(env, ["rebase", "--retarget", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget");
      expect(result.output).toContain("Retargeted");

      // Config should have base cleared (retargeted to default)
      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBeUndefined();
    }));

  test("arb rebase --retarget rejects retargeting to the current feature branch", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      const result = await arb(env, ["rebase", "--retarget", "feat/auth-ui"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("current feature branch");
    }));

  test("arb rebase --retarget rejects retargeting to the current base branch", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      const result = await arb(env, ["rebase", "--retarget", "feat/auth"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already the configured base");
    }));
});

// ── Retarget with readonly repos (target branch missing on some remotes) ──

describe("retarget with readonly repos", () => {
  test("arb rebase --retarget proceeds when some repos lack the target branch", () =>
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
      const result = await arb(env, ["rebase", "--retarget", "feat/next", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("retarget");
      expect(result.output).toContain("repo-b");
      expect(result.output).toContain("skipped");

      // Verify workspace config updated with new base
      const config = await readFile(join(env.projectDir, "stacked/.arbws/config.json"), "utf-8");
      expect(JSON.parse(config).base).toBe("feat/next");
    }));

  test("arb rebase --retarget still blocks when a repo is dirty", () =>
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

      const result = await arb(env, ["rebase", "--retarget", "feat/next", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot retarget");
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("uncommitted changes");
    }));

  test("arb status shows not-found (not base-merged) for repos where base is a worktree branch", () =>
    withEnv(async (env) => {
      // Setup: push feat/auth and feat/next to repo-a only
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

      // Push feat/next only to repo-a
      const tmpPush = join(env.testDir, "tmp-push");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpPush]);
      await git(tmpPush, ["checkout", "-b", "feat/next"]);
      await write(join(tmpPush, "next.txt"), "next");
      await git(tmpPush, ["add", "next.txt"]);
      await git(tmpPush, ["commit", "-m", "next feature"]);
      await git(tmpPush, ["push", "-u", "origin", "feat/next"]);
      await rm(tmpPush, { recursive: true });

      // Create stacked workspace and retarget repo-a only
      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a", "repo-b"]);

      await write(join(env.projectDir, "stacked/repo-a/ui.txt"), "ui-a");
      await git(join(env.projectDir, "stacked/repo-a"), ["add", "ui.txt"]);
      await git(join(env.projectDir, "stacked/repo-a"), ["commit", "-m", "ui a"]);

      // Retarget (repo-b will be skipped — target not on its remote)
      await arb(env, ["rebase", "--retarget", "feat/next", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });

      // Now create another workspace on feat/next so the local branch is in a worktree for repo-b
      await arb(env, ["create", "next-ws", "-b", "feat/next", "repo-b"]);

      // Verify: repo-b now has local branch feat/next (from worktree), but it's not on origin
      // Status should show "not found", NOT "base merged"
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "stacked") });
      expect(result.output).toContain("not found");
      expect(result.output).not.toContain("base merged");
    }));

  test("arb rebase --retarget fails when target not found on any repo", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      const result = await arb(env, ["rebase", "--retarget", "totally-nonexistent", "--yes"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not found");
    }));
});
