import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { arb, git, withEnv, write } from "./helpers/env";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

/**
 * Set up a stacked workspace for retarget testing.
 *
 * Creates:
 * - origin/repo-a with main branch + feat/base branch (1 commit ahead of main)
 * - workspace "stacked" based on feat/base, branch feat/stacked
 * - feature commit in stacked/repo-a
 * - main advanced with a new commit (so retarget from feat/base → main has work to do)
 *
 * Returns paths for convenience.
 */
async function setupRetargetScenario(env: { testDir: string; projectDir: string; originDir: string }) {
  const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");

  // Create a feature base branch
  await git(mainRepoA, ["checkout", "-b", "feat/base"]);
  await write(join(mainRepoA, "base.txt"), "base feature");
  await git(mainRepoA, ["add", "base.txt"]);
  await git(mainRepoA, ["commit", "-m", "base feature commit"]);
  await git(mainRepoA, ["push", "origin", "feat/base"]);
  await git(mainRepoA, ["checkout", "--detach"]);

  // Create workspace stacked on feat/base
  await arb(env, ["create", "stacked", "--base", "feat/base", "-b", "feat/stacked", "repo-a"]);
  const wt = join(env.projectDir, "stacked/repo-a");

  // Add a feature commit in the workspace
  await write(join(wt, "feature.txt"), "stacked feature");
  await git(wt, ["add", "feature.txt"]);
  await git(wt, ["commit", "-m", "stacked feature commit"]);

  // Advance main with a new commit (so retarget has something to rebase onto)
  await git(mainRepoA, ["checkout", "main"]);
  await write(join(mainRepoA, "main-advance.txt"), "main advance");
  await git(mainRepoA, ["add", "main-advance.txt"]);
  await git(mainRepoA, ["commit", "-m", "advance main"]);
  await git(mainRepoA, ["push", "origin", "main"]);
  await git(mainRepoA, ["checkout", "--detach"]);

  return {
    ws: join(env.projectDir, "stacked"),
    wt,
    mainRepoA,
  };
}

/**
 * Like setupRetargetScenario but creates a conflict: both the workspace commit
 * and the main-advance commit modify the same file.
 */
async function setupRetargetConflictScenario(env: { testDir: string; projectDir: string; originDir: string }) {
  const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");

  // Create a feature base branch
  await git(mainRepoA, ["checkout", "-b", "feat/base"]);
  await write(join(mainRepoA, "base.txt"), "base feature");
  await git(mainRepoA, ["add", "base.txt"]);
  await git(mainRepoA, ["commit", "-m", "base feature commit"]);
  await git(mainRepoA, ["push", "origin", "feat/base"]);
  await git(mainRepoA, ["checkout", "--detach"]);

  // Create workspace stacked on feat/base
  await arb(env, ["create", "stacked", "--base", "feat/base", "-b", "feat/stacked", "repo-a"]);
  const wt = join(env.projectDir, "stacked/repo-a");

  // Add a commit that will conflict with main's advance
  await write(join(wt, "conflict.txt"), "stacked version");
  await git(wt, ["add", "conflict.txt"]);
  await git(wt, ["commit", "-m", "stacked conflict commit"]);

  // Advance main with a conflicting change to the same file
  await git(mainRepoA, ["checkout", "main"]);
  await write(join(mainRepoA, "conflict.txt"), "main version");
  await git(mainRepoA, ["add", "conflict.txt"]);
  await git(mainRepoA, ["commit", "-m", "main conflict commit"]);
  await git(mainRepoA, ["push", "origin", "main"]);
  await git(mainRepoA, ["checkout", "--detach"]);

  return {
    ws: join(env.projectDir, "stacked"),
    wt,
    mainRepoA,
  };
}

/**
 * Multi-repo retarget conflict scenario: repo-a will conflict, repo-b will succeed.
 */
async function setupMultiRepoRetargetConflictScenario(env: {
  testDir: string;
  projectDir: string;
  originDir: string;
}) {
  const mainRepoA = join(env.projectDir, ".arb/repos/repo-a");
  const mainRepoB = join(env.projectDir, ".arb/repos/repo-b");

  // Create feature base branches on both repos
  for (const repo of [mainRepoA, mainRepoB]) {
    await git(repo, ["checkout", "-b", "feat/base"]);
    await write(join(repo, "base.txt"), "base feature");
    await git(repo, ["add", "base.txt"]);
    await git(repo, ["commit", "-m", "base feature commit"]);
    await git(repo, ["push", "origin", "feat/base"]);
    await git(repo, ["checkout", "--detach"]);
  }

  // Create workspace stacked on feat/base with both repos
  await arb(env, ["create", "stacked", "--base", "feat/base", "-b", "feat/stacked", "repo-a", "repo-b"]);
  const wtA = join(env.projectDir, "stacked/repo-a");
  const wtB = join(env.projectDir, "stacked/repo-b");

  // repo-a: commit that will conflict
  await write(join(wtA, "conflict.txt"), "stacked version");
  await git(wtA, ["add", "conflict.txt"]);
  await git(wtA, ["commit", "-m", "stacked conflict commit"]);

  // repo-b: commit that won't conflict
  await write(join(wtB, "feature.txt"), "stacked feature");
  await git(wtB, ["add", "feature.txt"]);
  await git(wtB, ["commit", "-m", "stacked feature commit"]);

  // Advance main on both repos — repo-a conflicts, repo-b doesn't
  await git(mainRepoA, ["checkout", "main"]);
  await write(join(mainRepoA, "conflict.txt"), "main version");
  await git(mainRepoA, ["add", "conflict.txt"]);
  await git(mainRepoA, ["commit", "-m", "main conflict commit"]);
  await git(mainRepoA, ["push", "origin", "main"]);
  await git(mainRepoA, ["checkout", "--detach"]);

  await git(mainRepoB, ["checkout", "main"]);
  await write(join(mainRepoB, "main-advance.txt"), "main advance");
  await git(mainRepoB, ["add", "main-advance.txt"]);
  await git(mainRepoB, ["commit", "-m", "advance main"]);
  await git(mainRepoB, ["push", "origin", "main"]);
  await git(mainRepoB, ["checkout", "--detach"]);

  return {
    ws: join(env.projectDir, "stacked"),
    wtA,
    wtB,
  };
}

// ── operation tracking ───────────────────────────────────────────

describe("retarget operation tracking", () => {
  test("successful retarget creates completed operation record with config updated", () =>
    withEnv(async (env) => {
      const { ws } = await setupRetargetScenario(env);

      const result = await arb(env, ["retarget", "main", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // Operation record exists and is completed
      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.command).toBe("retarget");
      expect(record.status).toBe("completed");
      expect(record.targetBranch).toBe("main");
      expect(record.oldBase).toBe("feat/base");

      // Config updated to remove base (retargeted to default)
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.base).toBeUndefined();
    }));

  test("retarget with conflict creates in-progress record, config NOT updated (bug fix)", () =>
    withEnv(async (env) => {
      const { ws } = await setupRetargetConflictScenario(env);

      const result = await arb(env, ["retarget", "main", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);

      // Operation record is in-progress
      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.command).toBe("retarget");
      expect(record.status).toBe("in-progress");

      // Config NOT updated — this is the bug fix!
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.base).toBe("feat/base");

      // Record has configAfter for deferred application
      expect(record.configAfter).toBeDefined();
    }));

  test("dry-run does not create operation record", () =>
    withEnv(async (env) => {
      const { ws } = await setupRetargetScenario(env);

      await arb(env, ["retarget", "main", "--dry-run"], { cwd: ws });

      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));
});

// ── continue (reconciliation table) ─────────────────────────────

describe("retarget continue", () => {
  test("resolve conflicts then re-run arb retarget continues and updates config", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupRetargetConflictScenario(env);

      // First run — conflicts
      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // Resolve: accept the stacked version
      await write(join(wt, "conflict.txt"), "resolved version");
      await git(wt, ["add", "conflict.txt"]);

      // Continue
      const result = await arb(env, ["retarget", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // Operation completed
      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.status).toBe("completed");

      // Config now updated (deferred config applied)
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.base).toBeUndefined(); // retargeted to main = default = unstack
    }));

  test("manually running git rebase --continue is detected", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupRetargetConflictScenario(env);

      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // Resolve and manually continue the rebase
      await write(join(wt, "conflict.txt"), "resolved version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["rebase", "--continue"]);

      // Re-run — should detect manually-continued
      const result = await arb(env, ["retarget", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already resolved");

      // Config updated
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.base).toBeUndefined();
    }));

  test("manually running git rebase --abort is detected", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupRetargetConflictScenario(env);

      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // Manually abort the rebase
      await git(wt, ["rebase", "--abort"]);

      // Re-run — should detect manually-aborted
      const result = await arb(env, ["retarget", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("manually aborted");

      // Config updated (all repos resolved — aborted counts as resolved)
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.base).toBeUndefined();
    }));

  test("re-running without resolving shows still-conflicting", () =>
    withEnv(async (env) => {
      const { ws } = await setupRetargetConflictScenario(env);

      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // Re-run without resolving
      const result = await arb(env, ["retarget", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not yet resolved");
    }));
});

// ── undo ─────────────────────────────────────────────────────────

describe("retarget undo", () => {
  test("undo successful retarget resets HEAD and restores config", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupRetargetScenario(env);

      // Capture pre-retarget state
      const preHead = (await git(wt, ["rev-parse", "HEAD"])).trim();

      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // HEAD moved
      const postHead = (await git(wt, ["rev-parse", "HEAD"])).trim();
      expect(postHead).not.toBe(preHead);

      // Undo
      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // HEAD restored
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);

      // Config restored
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.base).toBe("feat/base");

      // Operation record cleaned up
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));

  test("undo conflicted retarget aborts rebase and restores config", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupRetargetConflictScenario(env);

      const preHead = (await git(wt, ["rev-parse", "HEAD"])).trim();

      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // Undo — should abort the in-progress rebase
      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // HEAD restored to pre-retarget state
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);

      // Config restored
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.base).toBe("feat/base");

      // No git operation in progress — working tree should be clean after abort
    }));

  test("undo refuses when HEAD has drifted", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupRetargetScenario(env);

      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // Make a new commit (drift)
      await write(join(wt, "drift.txt"), "drift");
      await git(wt, ["add", "drift.txt"]);
      await git(wt, ["commit", "-m", "drift commit"]);

      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("drifted");
    }));
});

// ── gate ─────────────────────────────────────────────────────────

describe("retarget gate", () => {
  test("in-progress retarget blocks arb rebase", () =>
    withEnv(async (env) => {
      const { ws } = await setupRetargetConflictScenario(env);

      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      const result = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("retarget in progress");
    }));

  test("re-running arb retarget during in-progress continues (not blocked)", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupRetargetConflictScenario(env);

      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // Resolve and re-run — should continue, not be blocked by gate
      await write(join(wt, "conflict.txt"), "resolved");
      await git(wt, ["add", "conflict.txt"]);

      const result = await arb(env, ["retarget", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
    }));
});

// ── multi-repo ───────────────────────────────────────────────────

describe("retarget multi-repo", () => {
  test("repo-a conflicts, repo-b succeeds — continue only continues repo-a", () =>
    withEnv(async (env) => {
      const { ws, wtA, wtB } = await setupMultiRepoRetargetConflictScenario(env);

      const preHeadB = (await git(wtB, ["rev-parse", "HEAD"])).trim();

      // First run — repo-a conflicts, repo-b succeeds
      const r1 = await arb(env, ["retarget", "main", "--yes"], { cwd: ws });
      expect(r1.exitCode).not.toBe(0);
      expect(r1.output).toContain("1 conflicted");

      // Operation record: repo-b completed, repo-a conflicting
      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.status).toBe("in-progress");
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-b"]?.status).toBe("completed");
      expect(repos["repo-a"]?.status).toBe("conflicting");

      // repo-b HEAD moved (retarget succeeded)
      expect((await git(wtB, ["rev-parse", "HEAD"])).trim()).not.toBe(preHeadB);

      // Config NOT updated yet
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.base).toBe("feat/base");

      // Resolve repo-a and continue
      await write(join(wtA, "conflict.txt"), "resolved");
      await git(wtA, ["add", "conflict.txt"]);

      const r2 = await arb(env, ["retarget", "--yes"], { cwd: ws });
      expect(r2.exitCode).toBe(0);

      // Config NOW updated
      const config2 = readJson(join(ws, ".arbws/config.json"));
      expect(config2.base).toBeUndefined();

      // Operation completed
      const record2 = readJson(join(ws, ".arbws/operation.json"));
      expect(record2.status).toBe("completed");
    }));

  test("multi-repo undo resets both repos and restores config", () =>
    withEnv(async (env) => {
      const { ws, wtA, wtB } = await setupMultiRepoRetargetConflictScenario(env);

      const preHeadA = (await git(wtA, ["rev-parse", "HEAD"])).trim();
      const preHeadB = (await git(wtB, ["rev-parse", "HEAD"])).trim();

      // Conflict — repo-b completed, repo-a conflicting
      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // Undo — should abort repo-a's rebase and reset repo-b
      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // Both repos restored
      expect((await git(wtA, ["rev-parse", "HEAD"])).trim()).toBe(preHeadA);
      expect((await git(wtB, ["rev-parse", "HEAD"])).trim()).toBe(preHeadB);

      // Config restored
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.base).toBe("feat/base");
    }));
});

// ── stash restoration ────────────────────────────────────────────

describe("retarget stash", () => {
  test("undo with autostash restores working tree changes", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupRetargetScenario(env);

      // Create dirty working tree (uncommitted change)
      await write(join(wt, "dirty.txt"), "uncommitted work");
      await git(wt, ["add", "dirty.txt"]);

      // Retarget with autostash
      const r1 = await arb(env, ["retarget", "main", "--yes", "--autostash"], { cwd: ws });
      expect(r1.exitCode).toBe(0);

      // dirty.txt should still exist (autostash restored it after rebase)
      expect(existsSync(join(wt, "dirty.txt"))).toBe(true);

      // Undo
      const r2 = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(r2.exitCode).toBe(0);

      // dirty.txt should be back in working tree (stash restored)
      expect(existsSync(join(wt, "dirty.txt"))).toBe(true);
    }));
});

// ── edge cases ───────────────────────────────────────────────────

describe("retarget edge cases", () => {
  test("undo after all repos manually aborted cleans up record and restores config", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupRetargetConflictScenario(env);

      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // Manually abort
      await git(wt, ["rebase", "--abort"]);

      // Undo — should find nothing to do but still clean up
      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // Record cleaned up
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);

      // Config restored
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.base).toBe("feat/base");
    }));

  test("undo after user manually continued is treated as drifted", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupRetargetConflictScenario(env);

      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // Resolve and manually continue
      await write(join(wt, "conflict.txt"), "resolved");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["rebase", "--continue"]);

      // Undo — HEAD moved from preHead, no longer at postHead (which was never set since it conflicted)
      // The record shows status "conflicting" but HEAD != preHead → drifted
      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("drifted");
    }));

  test("continue then undo works end-to-end", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupRetargetConflictScenario(env);

      const preHead = (await git(wt, ["rev-parse", "HEAD"])).trim();

      // Conflict
      await arb(env, ["retarget", "main", "--yes"], { cwd: ws });

      // Resolve and continue
      await write(join(wt, "conflict.txt"), "resolved");
      await git(wt, ["add", "conflict.txt"]);
      await arb(env, ["retarget", "--yes"], { cwd: ws });

      // Config updated
      expect(readJson(join(ws, ".arbws/config.json")).base).toBeUndefined();

      // Undo the completed retarget
      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // HEAD restored
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);

      // Config restored
      expect(readJson(join(ws, ".arbws/config.json")).base).toBe("feat/base");
    }));
});
