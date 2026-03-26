import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arb, git, withEnv, write } from "./helpers/env";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

/** Advance main on a repo's origin so rebase has work to do. */
async function advanceMain(env: { projectDir: string }, repoName: string, file: string, content: string) {
  const mainRepo = join(env.projectDir, `.arb/repos/${repoName}`);
  await git(mainRepo, ["checkout", "main"]);
  await write(join(mainRepo, file), content);
  await git(mainRepo, ["add", file]);
  await git(mainRepo, ["commit", "-m", `advance main: ${file}`]);
  await git(mainRepo, ["push", "origin", "main"]);
  await git(mainRepo, ["checkout", "--detach"]);
}

/** Get HEAD sha for a worktree. */
async function getHead(repoDir: string): Promise<string> {
  return (await git(repoDir, ["rev-parse", "HEAD"])).trim();
}

// ── selective sync undo ──────────────────────────────────────────

describe("selective undo", () => {
  test("undo one repo keeps the other rebased", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");

      // Make feature commits in both repos
      await write(join(wtA, "feature-a.txt"), "feature a");
      await git(wtA, ["add", "feature-a.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await write(join(wtB, "feature-b.txt"), "feature b");
      await git(wtB, ["add", "feature-b.txt"]);
      await git(wtB, ["commit", "-m", "feature b"]);

      // Advance main on both
      await advanceMain(env, "repo-a", "main-a.txt", "main advance a");
      await advanceMain(env, "repo-b", "main-b.txt", "main advance b");

      // Rebase
      const rebaseResult = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(rebaseResult.exitCode).toBe(0);

      const headAAfterRebase = await getHead(wtA);
      const headBAfterRebase = await getHead(wtB);

      // Selectively undo only repo-a
      const undoResult = await arb(env, ["undo", "repo-a", "--yes"], { cwd: ws });
      expect(undoResult.exitCode).toBe(0);
      expect(undoResult.output).toContain("Undone 1 repo");
      expect(undoResult.output).toContain("1 remaining");
      expect(undoResult.output).toContain("Use 'arb undo'");

      // repo-a should be reset (HEAD changed)
      const headAAfterUndo = await getHead(wtA);
      expect(headAAfterUndo).not.toBe(headAAfterRebase);

      // repo-b should still be rebased (HEAD unchanged)
      const headBAfterUndo = await getHead(wtB);
      expect(headBAfterUndo).toBe(headBAfterRebase);

      // Operation record should have repo-a as "undone"
      const record = readJson(join(ws, ".arbws/operation.json"));
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-a"]?.status).toBe("undone");
      expect(repos["repo-b"]?.status).toBe("completed");
      // Record should NOT be finalized yet
      expect(record.outcome).toBeUndefined();
    }));

  test("undo remaining repos after partial undo finalizes the record", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");

      await write(join(wtA, "feature-a.txt"), "feature a");
      await git(wtA, ["add", "feature-a.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await write(join(wtB, "feature-b.txt"), "feature b");
      await git(wtB, ["add", "feature-b.txt"]);
      await git(wtB, ["commit", "-m", "feature b"]);

      await advanceMain(env, "repo-a", "main-a.txt", "main advance a");
      await advanceMain(env, "repo-b", "main-b.txt", "main advance b");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Undo repo-a first
      await arb(env, ["undo", "repo-a", "--yes"], { cwd: ws });

      // Now undo remaining (repo-b)
      const undoResult = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(undoResult.exitCode).toBe(0);
      expect(undoResult.output).toContain("Undone 1 repo");
      // Should NOT contain "remaining" since all are done
      expect(undoResult.output).not.toContain("remaining");

      // Record should be finalized
      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.outcome).toBe("undone");
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-a"]?.status).toBe("undone");
      expect(repos["repo-b"]?.status).toBe("undone");
    }));

  test("naming all repos explicitly finalizes like bare undo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");

      await write(join(wtA, "feature-a.txt"), "feature a");
      await git(wtA, ["add", "feature-a.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await write(join(wtB, "feature-b.txt"), "feature b");
      await git(wtB, ["add", "feature-b.txt"]);
      await git(wtB, ["commit", "-m", "feature b"]);

      await advanceMain(env, "repo-a", "main-a.txt", "main advance a");
      await advanceMain(env, "repo-b", "main-b.txt", "main advance b");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Undo both by name — should be same as bare undo
      const undoResult = await arb(env, ["undo", "repo-a", "repo-b", "--yes"], { cwd: ws });
      expect(undoResult.exitCode).toBe(0);
      expect(undoResult.output).toContain("Undone 2 repos");
      expect(undoResult.output).not.toContain("remaining");

      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.outcome).toBe("undone");
    }));

  test("already-undone repo shows 'already undone'", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");

      await write(join(wtA, "feature-a.txt"), "feature a");
      await git(wtA, ["add", "feature-a.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await advanceMain(env, "repo-a", "main-a.txt", "main advance a");

      await arb(env, ["rebase", "--yes"], { cwd: ws });
      await arb(env, ["undo", "repo-a", "--yes"], { cwd: ws });

      // Try to undo repo-a again
      const result = await arb(env, ["undo", "repo-a", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Nothing to undo");
    }));

  test("unknown repo name errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");

      await write(join(wtA, "feature-a.txt"), "feature a");
      await git(wtA, ["add", "feature-a.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await advanceMain(env, "repo-a", "main-a.txt", "main advance a");
      await arb(env, ["rebase", "--yes"], { cwd: ws });

      const result = await arb(env, ["undo", "nonexistent", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Unknown repo");
      expect(result.output).toContain("nonexistent");
    }));

  test("drift on unselected repo does not block selected", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");

      await write(join(wtA, "feature-a.txt"), "feature a");
      await git(wtA, ["add", "feature-a.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await write(join(wtB, "feature-b.txt"), "feature b");
      await git(wtB, ["add", "feature-b.txt"]);
      await git(wtB, ["commit", "-m", "feature b"]);

      await advanceMain(env, "repo-a", "main-a.txt", "main advance a");
      await advanceMain(env, "repo-b", "main-b.txt", "main advance b");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Drift repo-b by making a new commit after rebase
      await write(join(wtB, "drift.txt"), "drift");
      await git(wtB, ["add", "drift.txt"]);
      await git(wtB, ["commit", "-m", "drift"]);

      // Undo only repo-a — should succeed despite repo-b drift
      const undoResult = await arb(env, ["undo", "repo-a", "--yes"], { cwd: ws });
      expect(undoResult.exitCode).toBe(0);
      expect(undoResult.output).toContain("Undone 1 repo");
    }));

  test("drift on selected repo blocks undo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");

      await write(join(wtA, "feature-a.txt"), "feature a");
      await git(wtA, ["add", "feature-a.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await write(join(wtB, "feature-b.txt"), "feature b");
      await git(wtB, ["add", "feature-b.txt"]);
      await git(wtB, ["commit", "-m", "feature b"]);

      await advanceMain(env, "repo-a", "main-a.txt", "main advance a");
      await advanceMain(env, "repo-b", "main-b.txt", "main advance b");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Drift repo-a
      await write(join(wtA, "drift.txt"), "drift");
      await git(wtA, ["add", "drift.txt"]);
      await git(wtA, ["commit", "-m", "drift"]);

      // Undo repo-a — should fail due to drift
      const undoResult = await arb(env, ["undo", "repo-a", "--yes"], { cwd: ws });
      expect(undoResult.exitCode).toBe(1);
      expect(undoResult.output).toContain("drifted");
    }));
});

// ── selective branch-rename undo ─────────────────────────────────

describe("selective branch-rename undo", () => {
  test("undo one repo keeps the other on the new branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Undo only repo-a
      const undoResult = await arb(env, ["undo", "repo-a", "--yes"], { cwd: ws });
      expect(undoResult.exitCode).toBe(0);
      expect(undoResult.output).toContain("Undone 1 repo");
      expect(undoResult.output).toContain("1 remaining");

      // repo-a should be back on original branch
      const branchA = (await git(join(ws, "repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("my-feature");

      // repo-b should still be on the new branch
      const branchB = (await git(join(ws, "repo-b"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchB).toBe("feat/new-name");

      // Config should NOT be restored yet (still shows new branch)
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.branch).toBe("feat/new-name");

      // Record should have undone status for repo-a
      const record = readJson(join(ws, ".arbws/operation.json"));
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-a"]?.status).toBe("undone");
      expect(repos["repo-b"]?.status).toBe("completed");
    }));

  test("undo all branch-rename repos restores config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Undo repo-a first
      await arb(env, ["undo", "repo-a", "--yes"], { cwd: ws });

      // Undo repo-b — should finalize and restore config
      const undoResult = await arb(env, ["undo", "repo-b", "--yes"], { cwd: ws });
      expect(undoResult.exitCode).toBe(0);

      // Config should be restored to original branch
      const config = readJson(join(ws, ".arbws/config.json"));
      expect(config.branch).toBe("my-feature");
    }));
});

// ── edge cases ───────────────────────────────────────────────────

describe("selective undo edge cases", () => {
  test("--force with repos errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");

      await write(join(wtA, "feature-a.txt"), "feature a");
      await git(wtA, ["add", "feature-a.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await advanceMain(env, "repo-a", "main-a.txt", "main advance a");
      await arb(env, ["rebase", "--yes"], { cwd: ws });

      const result = await arb(env, ["undo", "repo-a", "--force"], { cwd: ws });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("cannot be combined");
    }));

  test("selective undo of already-undone repo with remaining repos shows correct message", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");

      await write(join(wtA, "feature-a.txt"), "feature a");
      await git(wtA, ["add", "feature-a.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await write(join(wtB, "feature-b.txt"), "feature b");
      await git(wtB, ["add", "feature-b.txt"]);
      await git(wtB, ["commit", "-m", "feature b"]);

      await advanceMain(env, "repo-a", "main-a.txt", "main advance a");
      await advanceMain(env, "repo-b", "main-b.txt", "main advance b");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Undo repo-a
      await arb(env, ["undo", "repo-a", "--yes"], { cwd: ws });

      // Try to undo repo-a again — repo-b still actionable
      const result = await arb(env, ["undo", "repo-a", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      // Should say "nothing to undo for the selected repos", NOT "operation record cleaned up"
      expect(result.output).toContain("Nothing to undo for the selected repos");
      expect(result.output).not.toContain("cleaned up");

      // repo-b should still be rebased
      const record = readJson(join(ws, ".arbws/operation.json"));
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-b"]?.status).toBe("completed");
      // Record should NOT be finalized
      expect(record.outcome).toBeUndefined();
    }));
});
