import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
});
