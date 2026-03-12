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
      expect(result.output).toContain("already at origin/main");
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
      expect(result.output).toContain("permanently lost");
    }));

  test("plan shows pushed commits as recoverable when using --base", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Add a local commit and push it
      await write(join(repoA, "pushed.txt"), "pushed");
      await git(repoA, ["add", "pushed.txt"]);
      await git(repoA, ["commit", "-m", "pushed work"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // With --base, reset targets origin/main, so the pushed commit shows as recoverable
      const result = await arb(env, ["reset", "--base", "--dry-run"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      // Should show commit count with (pushed) annotation
      expect(result.output).toContain("1 commit (pushed)");
      expect(result.output).toContain("discard");
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

  // ── Share-first reset tests ──

  test("resets to share branch when remote branch exists", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Push to share, then add more local commits
      await write(join(repoA, "shared.txt"), "shared");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "shared commit"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      await write(join(repoA, "local.txt"), "local");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      // Should reset to the share branch, not base
      expect(result.output).toContain("reset to origin/my-feature");
      expect(result.output).toContain("Reset 1 repo");

      // Verify local commit is gone but shared commit remains
      const log = await git(repoA, ["log", "--oneline"]);
      expect(log).not.toContain("local commit");
      expect(log).toContain("shared commit");
    }));

  test("falls back to base when no share branch exists", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Add local commits without pushing to share
      await write(join(repoA, "local.txt"), "local");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      const result = await arb(env, ["reset", "--dry-run"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      // Should target base branch since no share exists
      expect(result.output).toContain("reset to origin/main");
    }));

  test("--base forces reset to base even when share exists", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Push to share
      await write(join(repoA, "shared.txt"), "shared");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "shared commit"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      await write(join(repoA, "local.txt"), "local");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      const result = await arb(env, ["reset", "--base", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      // Should reset to base, not share
      expect(result.output).toContain("reset to origin/main");
      expect(result.output).toContain("Reset 1 repo");

      // Both shared and local commits should be gone
      const log = await git(repoA, ["log", "--oneline"]);
      expect(log).not.toContain("shared commit");
      expect(log).not.toContain("local commit");
    }));

  test("already-clean for share", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Push to share and make no further changes
      await write(join(repoA, "shared.txt"), "shared");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "shared commit"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already at origin/my-feature");
    }));

  test("already-clean for base when no share", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already at origin/main");
    }));

  test("mixed repos: some have share, some don't", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      const repoB = join(env.projectDir, "my-feature/repo-b");

      // Push repo-a to share, don't push repo-b
      await write(join(repoA, "shared.txt"), "shared");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "shared commit"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Add local commits to both
      await write(join(repoA, "local.txt"), "local");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local a"]);

      await write(join(repoB, "local.txt"), "local");
      await git(repoB, ["add", "local.txt"]);
      await git(repoB, ["commit", "-m", "local b"]);

      const result = await arb(env, ["reset", "--dry-run"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      // repo-a should target share, repo-b should target base
      expect(result.output).toContain("origin/my-feature");
      expect(result.output).toContain("origin/main");
    }));

  test("reset to share with dirty files", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Push to share
      await write(join(repoA, "shared.txt"), "shared");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "shared commit"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Add dirty files (staged, no commit)
      await write(join(repoA, "dirty.txt"), "dirty");
      await git(repoA, ["add", "dirty.txt"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("reset to origin/my-feature");
      expect(result.output).toContain("dirty file");
      expect(result.output).toContain("Reset 1 repo");
    }));

  test("reset to share warns about unpushed commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Push to share
      await write(join(repoA, "shared.txt"), "shared");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "shared commit"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Add more local commits (not pushed)
      await write(join(repoA, "unpushed.txt"), "unpushed");
      await git(repoA, ["add", "unpushed.txt"]);
      await git(repoA, ["commit", "-m", "unpushed work"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("unpushed commit");
      expect(result.output).toContain("permanently lost");
      expect(result.output).toContain("Reset 1 repo");
    }));

  test("reset to share with diverged state", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Push initial commit to share
      await write(join(repoA, "shared.txt"), "shared");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "shared commit"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Simulate divergence: amend-and-force-push to create a different remote HEAD,
      // then add a local commit on the old (pre-amend) branch
      await git(repoA, ["commit", "--amend", "-m", "amended shared commit"]);
      await git(repoA, ["push", "--force"]);

      // Reset back to the pre-amend state and add a local-only commit
      // This creates: local has old-shared + local-only, remote has amended-shared
      await git(repoA, ["reset", "--hard", "HEAD~1"]);
      await write(join(repoA, "shared.txt"), "shared");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "old shared commit"]);
      await write(join(repoA, "local-only.txt"), "local");
      await git(repoA, ["add", "local-only.txt"]);
      await git(repoA, ["commit", "-m", "local-only commit"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("reset to origin/my-feature");
      expect(result.output).toContain("Reset 1 repo");

      // After reset, should be at the remote share state
      const log = await git(repoA, ["log", "--oneline"]);
      expect(log).not.toContain("local-only commit");
      expect(log).toContain("amended shared commit");
    }));

  test("--base with dry-run shows base target", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Push to share
      await write(join(repoA, "shared.txt"), "shared");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "shared commit"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      const result = await arb(env, ["reset", "--base", "--dry-run"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      // With --base, should show base target even though share exists
      expect(result.output).toContain("reset to origin/main");
      expect(result.output).not.toContain("origin/my-feature");
      expect(result.output).toContain("Dry run");
    }));

  test("fork workflow resets to share on origin", () =>
    withEnv(async (env) => {
      await setupForkRepo(env, "repo-a");
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Push to share (origin in fork workflow)
      await write(join(repoA, "shared.txt"), "shared");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "shared commit"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Add local-only commit
      await write(join(repoA, "local.txt"), "local");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      const result = await arb(env, ["reset", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      // Should reset to share on origin, not upstream (base)
      expect(result.output).toContain("reset to origin/my-feature");
      expect(result.output).toContain("Reset 1 repo");

      // Shared commit should remain, local should be gone
      const log = await git(repoA, ["log", "--oneline"]);
      expect(log).toContain("shared commit");
      expect(log).not.toContain("local commit");
    }));

  test("fork workflow --base resets to upstream", () =>
    withEnv(async (env) => {
      await setupForkRepo(env, "repo-a");
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Push to share
      await write(join(repoA, "shared.txt"), "shared");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "shared commit"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      const result = await arb(env, ["reset", "--base", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      // With --base in fork workflow, should reset to upstream (base remote)
      expect(result.output).toContain("upstream/");
      expect(result.output).toContain("Reset 1 repo");
    }));
});
