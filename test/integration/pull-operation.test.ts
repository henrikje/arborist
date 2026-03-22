import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { arb, git, withEnv, write } from "./helpers/env";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

/**
 * Push the feature branch so pull has a remote to pull from,
 * then create a conflicting remote commit via a separate clone.
 */
async function setupPullConflict(env: { testDir: string; projectDir: string; originDir: string }) {
  await arb(env, ["create", "my-feature", "repo-a"]);
  const ws = join(env.projectDir, "my-feature");
  const wt = join(ws, "repo-a");

  // Push feature branch
  await git(wt, ["push", "-u", "origin", "my-feature"]);

  // Local conflicting commit
  await write(join(wt, "conflict.txt"), "local version");
  await git(wt, ["add", "conflict.txt"]);
  await git(wt, ["commit", "-m", "local commit"]);

  // Remote conflicting commit (via clone)
  const tmpClone = join(env.testDir, "tmp-clone-a");
  await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
  await git(tmpClone, ["checkout", "my-feature"]);
  await write(join(tmpClone, "conflict.txt"), "remote version");
  await git(tmpClone, ["add", "conflict.txt"]);
  await git(tmpClone, ["commit", "-m", "remote commit"]);
  await git(tmpClone, ["push"]);

  return { ws, wt };
}

// ── pull operation tracking ──────────────────────────────────────

describe("pull operation tracking", () => {
  test("pull with conflict creates in-progress record", () =>
    withEnv(async (env) => {
      const { ws } = await setupPullConflict(env);

      const result = await arb(env, ["pull", "--yes", "--rebase"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);

      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.command).toBe("pull");
      expect(record.status).toBe("in-progress");
    }));

  test("successful pull creates completed record", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      // Push, then add remote commit (non-conflicting)
      await git(wt, ["push", "-u", "origin", "my-feature"]);
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "remote.txt"), "remote");
      await git(tmpClone, ["add", "remote.txt"]);
      await git(tmpClone, ["commit", "-m", "remote"]);
      await git(tmpClone, ["push"]);

      const result = await arb(env, ["pull", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.command).toBe("pull");
      expect(record.status).toBe("completed");
    }));
});

// ── pull continue ────────────────────────────────────────────────

describe("pull continue", () => {
  test("resolve conflicts then re-run arb pull continues", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupPullConflict(env);

      await arb(env, ["pull", "--yes", "--rebase"], { cwd: ws });

      // Resolve
      await write(join(wt, "conflict.txt"), "resolved");
      await git(wt, ["add", "conflict.txt"]);

      // Continue
      const result = await arb(env, ["pull", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.status).toBe("completed");
    }));

  test("re-running without resolving shows still-conflicting", () =>
    withEnv(async (env) => {
      const { ws } = await setupPullConflict(env);

      await arb(env, ["pull", "--yes", "--rebase"], { cwd: ws });

      const result = await arb(env, ["pull", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not yet resolved");
    }));
});

// ── pull undo ────────────────────────────────────────────────────

describe("pull undo", () => {
  test("undo conflicted pull aborts and restores HEAD", () =>
    withEnv(async (env) => {
      const { ws, wt } = await setupPullConflict(env);

      const preHead = (await git(wt, ["rev-parse", "HEAD"])).trim();

      await arb(env, ["pull", "--yes", "--rebase"], { cwd: ws });

      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));

  test("undo successful pull resets HEAD", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await git(wt, ["push", "-u", "origin", "my-feature"]);
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "remote.txt"), "remote");
      await git(tmpClone, ["add", "remote.txt"]);
      await git(tmpClone, ["commit", "-m", "remote"]);
      await git(tmpClone, ["push"]);

      const preHead = (await git(wt, ["rev-parse", "HEAD"])).trim();

      await arb(env, ["pull", "--yes"], { cwd: ws });
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).not.toBe(preHead);

      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);
    }));
});

// ── pull gate ────────────────────────────────────────────────────

describe("pull gate", () => {
  test("in-progress pull blocks arb rebase", () =>
    withEnv(async (env) => {
      const { ws } = await setupPullConflict(env);

      await arb(env, ["pull", "--yes", "--rebase"], { cwd: ws });

      const result = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("pull in progress");
    }));
});
