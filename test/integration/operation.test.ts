import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { arb, git, withEnv, write } from "./helpers/env";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ── operation record creation ────────────────────────────────────

describe("branch rename operation record", () => {
  test("successful rename creates operation.json with status completed", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      const opFile = join(ws, ".arbws/operation.json");
      expect(existsSync(opFile)).toBe(true);

      const record = readJson(opFile) as Record<string, unknown>;
      expect(record.command).toBe("branch-rename");
      expect(record.status).toBe("completed");
      expect(record.oldBranch).toBe("my-feature");
      expect(record.newBranch).toBe("feat/new-name");

      // All repos completed
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-a"]?.status).toBe("completed");
      expect(repos["repo-b"]?.status).toBe("completed");
    }));

  test("successful rename updates config without branch_rename_from", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      const config = readJson(join(ws, ".arbws/config.json")) as Record<string, unknown>;
      expect(config.branch).toBe("feat/new-name");
      expect(config.branch_rename_from).toBeUndefined();
    }));

  test("operation record contains configBefore and configAfter", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      const record = readJson(join(ws, ".arbws/operation.json")) as Record<string, unknown>;
      const configBefore = record.configBefore as Record<string, unknown>;
      const configAfter = record.configAfter as Record<string, unknown>;

      expect(configBefore.branch).toBe("my-feature");
      expect(configBefore.base).toBe("main");
      expect(configAfter.branch).toBe("feat/new-name");
      expect(configAfter.base).toBe("main");
    }));

  test("dry-run does not create operation record", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");

      await arb(env, ["branch", "rename", "feat/new-name", "--dry-run", "--no-fetch"], { cwd: ws });

      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));
});

// ── continue ─────────────────────────────────────────────────────

describe("branch rename continue", () => {
  test("re-running arb branch rename continues in-progress operation", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");
      const repoB = join(ws, "repo-b");

      // Simulate partial failure: create new-name branch in repo-a to make git branch -m fail
      await git(repoA, ["branch", "feat/new-name"]);

      const result1 = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });
      expect(result1.exitCode).not.toBe(0);

      // Operation record should exist with in-progress status
      const record1 = readJson(join(ws, ".arbws/operation.json")) as Record<string, unknown>;
      expect(record1.status).toBe("in-progress");

      // repo-b should be renamed (completed), repo-a should have failed (conflicting)
      const repos1 = record1.repos as Record<string, Record<string, unknown>>;
      expect(repos1["repo-b"]?.status).toBe("completed");
      expect(repos1["repo-a"]?.status).toBe("conflicting");

      // Fix the issue: remove the blocking branch
      await git(repoA, ["branch", "-D", "feat/new-name"]);

      // Continue: re-run the same command (no args needed)
      const result2 = await arb(env, ["branch", "rename", "--yes", "--no-fetch"], { cwd: ws });
      expect(result2.exitCode).toBe(0);

      // Both repos should now be on new branch
      const branchA = (await git(repoA, ["symbolic-ref", "--short", "HEAD"])).trim();
      const branchB = (await git(repoB, ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("feat/new-name");
      expect(branchB).toBe("feat/new-name");

      // Operation should be completed
      const record2 = readJson(join(ws, ".arbws/operation.json")) as Record<string, unknown>;
      expect(record2.status).toBe("completed");
    }));

  test("arb branch rename <same-target> during in-progress treated as continue", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause failure in repo-a
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Fix and re-run with explicit same target
      await git(repoA, ["branch", "-D", "feat/new-name"]);
      const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).toBe(0);
    }));

  test("arb branch rename <different-target> during in-progress is blocked", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause failure
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Try a different target
      const result = await arb(env, ["branch", "rename", "feat/other-name", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already in progress");
    }));
});

// ── gate ─────────────────────────────────────────────────────────

describe("operation gate", () => {
  test("in-progress branch-rename blocks arb rebase", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause partial rename failure
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Try rebase — should be blocked by gate
      const result = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("branch-rename in progress");
      expect(result.output).toContain("arb undo");
    }));

  test("in-progress branch-rename allows arb status", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause partial rename failure
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Status should work (read-only, no gate)
      const result = await arb(env, ["status", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).toBe(0);
    }));
});

// ── undo ─────────────────────────────────────────────────────────

describe("arb undo", () => {
  test("undo after successful rename restores branches and config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");
      const repoB = join(ws, "repo-b");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Verify rename succeeded
      expect((await git(repoA, ["symbolic-ref", "--short", "HEAD"])).trim()).toBe("feat/new-name");

      // Undo
      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // Branches restored
      expect((await git(repoA, ["symbolic-ref", "--short", "HEAD"])).trim()).toBe("my-feature");
      expect((await git(repoB, ["symbolic-ref", "--short", "HEAD"])).trim()).toBe("my-feature");

      // Config restored
      const config = readJson(join(ws, ".arbws/config.json")) as Record<string, unknown>;
      expect(config.branch).toBe("my-feature");

      // Operation record removed
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));

  test("undo after successful rename preserves base in config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });
      await arb(env, ["undo", "--yes"], { cwd: ws });

      const config = readJson(join(ws, ".arbws/config.json")) as Record<string, unknown>;
      expect(config.branch).toBe("my-feature");
      expect(config.base).toBe("main");
    }));

  test("undo after partial failure only reverses completed repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");
      const repoB = join(ws, "repo-b");

      // Cause failure in repo-a (repo-b succeeds first alphabetically? No, order is arbitrary)
      // Create blocking branch in repo-a
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Undo
      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // repo-b (which was completed) should be reverted
      expect((await git(repoB, ["symbolic-ref", "--short", "HEAD"])).trim()).toBe("my-feature");

      // Config restored
      const config = readJson(join(ws, ".arbws/config.json")) as Record<string, unknown>;
      expect(config.branch).toBe("my-feature");

      // Operation record removed
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));

  test("undo with no operation record errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");

      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Nothing to undo");
    }));

  test("undo refuses when repos have drifted (new commits)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Make a commit (drift)
      await write(join(repoA, "drift.txt"), "drift");
      await git(repoA, ["add", "drift.txt"]);
      await git(repoA, ["commit", "-m", "drift commit"]);

      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("drifted");
    }));

  test("undo after manual revert cleans up record and config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Manually revert
      await git(repoA, ["branch", "-m", "feat/new-name", "my-feature"]);

      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // Record cleaned up
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);

      // Config restored
      const config = readJson(join(ws, ".arbws/config.json")) as Record<string, unknown>;
      expect(config.branch).toBe("my-feature");
    }));

  test("undo --dry-run shows plan without executing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      const result = await arb(env, ["undo", "--dry-run"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Dry run");

      // Branch should still be on new name
      const branch = (await git(join(ws, "repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branch).toBe("feat/new-name");

      // Operation record still exists
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(true);
    }));

  test("undo partial failure recovery — re-running undo completes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");
      const repoB = join(ws, "repo-b");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Block undo for repo-a by creating a branch named "my-feature"
      // (git branch -m feat/new-name my-feature will fail because my-feature already exists)
      await git(repoA, ["branch", "my-feature"]);

      const r1 = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(r1.exitCode).not.toBe(0);

      // repo-b was undone, repo-a failed — record still exists
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(true);
      expect((await git(repoB, ["symbolic-ref", "--short", "HEAD"])).trim()).toBe("my-feature");
      expect((await git(repoA, ["symbolic-ref", "--short", "HEAD"])).trim()).toBe("feat/new-name");

      // Fix: remove blocking branch
      await git(repoA, ["branch", "-D", "my-feature"]);

      // Re-run undo — repo-b is already-at-target, repo-a can now be undone
      const r2 = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(r2.exitCode).toBe(0);

      expect((await git(repoA, ["symbolic-ref", "--short", "HEAD"])).trim()).toBe("my-feature");
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));

  test("undo skips repos detached from workspace since the operation", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Detach repo-a from the workspace
      await arb(env, ["detach", "repo-a", "--yes"], { cwd: ws });

      // Undo — should succeed, skipping the detached repo
      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // repo-b was undone
      expect((await git(join(ws, "repo-b"), ["symbolic-ref", "--short", "HEAD"])).trim()).toBe("my-feature");

      // Config restored
      const config = readJson(join(ws, ".arbws/config.json")) as Record<string, unknown>;
      expect(config.branch).toBe("my-feature");
    }));
});

// ── status banner ────────────────────────────────────────────────

describe("status operation banner", () => {
  test("arb status shows operation banner during in-progress branch rename", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause partial rename failure
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Status should show banner
      const result = await arb(env, ["status", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("branch-rename in progress");
      expect(result.output).toContain("arb undo");
    }));

  test("arb status shows no banner when no operation in progress", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");

      const result = await arb(env, ["status", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("in progress");
    }));

  test("arb status shows no banner after completed operation", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");

      // Successful rename → completed record
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      const result = await arb(env, ["status", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("in progress");
    }));
});

// ── conflict report ──────────────────────────────────────────────

describe("conflict report mentions arb undo", () => {
  test("rebase conflict report includes arb undo guidance", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      await git(mainRepo, ["checkout", "main"]);
      await write(join(mainRepo, "conflict.txt"), "main version");
      await git(mainRepo, ["add", "conflict.txt"]);
      await git(mainRepo, ["commit", "-m", "main"]);
      await git(mainRepo, ["push", "origin", "main"]);
      await git(mainRepo, ["checkout", "--detach"]);

      const result = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("arb undo");
    }));
});

// ── push gate ────────────────────────────────────────────────────

describe("push gate", () => {
  test("arb push is blocked during in-progress branch rename", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause partial rename failure to leave operation in-progress
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Push should be blocked
      const result = await arb(env, ["push", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("in progress");
      expect(result.output).toContain("arb undo");
    }));

  test("arb push is blocked during in-progress rebase", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");

      await write(join(wt, "conflict.txt"), "feature");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      await git(mainRepo, ["checkout", "main"]);
      await write(join(mainRepo, "conflict.txt"), "main");
      await git(mainRepo, ["add", "conflict.txt"]);
      await git(mainRepo, ["commit", "-m", "main"]);
      await git(mainRepo, ["push", "origin", "main"]);
      await git(mainRepo, ["checkout", "--detach"]);

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Push should be blocked
      const result = await arb(env, ["push", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("rebase in progress");
    }));
});
