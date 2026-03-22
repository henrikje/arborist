import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { arb, git, withEnv, write } from "./helpers/env";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

/** Advance main on repo-a's origin so rebase has work to do. */
async function advanceMain(env: { projectDir: string }, repoName: string, file: string, content: string) {
  const mainRepo = join(env.projectDir, `.arb/repos/${repoName}`);
  await git(mainRepo, ["checkout", "main"]);
  await write(join(mainRepo, file), content);
  await git(mainRepo, ["add", file]);
  await git(mainRepo, ["commit", "-m", `advance main: ${file}`]);
  await git(mainRepo, ["push", "origin", "main"]);
  await git(mainRepo, ["checkout", "--detach"]);
}

// ── rebase operation tracking ────────────────────────────────────

describe("rebase operation tracking", () => {
  test("successful rebase creates completed operation record", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "feature.txt"), "feature");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature commit"]);

      await advanceMain(env, "repo-a", "main-new.txt", "main advance");

      const result = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.command).toBe("rebase");
      expect(record.status).toBe("completed");
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-a"]?.status).toBe("completed");
      expect(repos["repo-a"]?.preHead).toBeDefined();
      expect(repos["repo-a"]?.postHead).toBeDefined();
    }));

  test("rebase with conflict creates in-progress record", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature commit"]);

      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      const result = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);

      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.command).toBe("rebase");
      expect(record.status).toBe("in-progress");
    }));

  test("all repos up to date does not create operation record", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");

      await arb(env, ["rebase", "--yes", "--no-fetch"], { cwd: ws });

      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));

  test("dry-run does not create operation record", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");

      await write(join(ws, "repo-a/feature.txt"), "feature");
      await git(join(ws, "repo-a"), ["add", "feature.txt"]);
      await git(join(ws, "repo-a"), ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "main-new.txt", "main");

      await arb(env, ["rebase", "--dry-run"], { cwd: ws });

      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));
});

// ── rebase continue ──────────────────────────────────────────────

describe("rebase continue", () => {
  test("resolve conflicts then re-run arb rebase continues", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Resolve
      await write(join(wt, "conflict.txt"), "resolved");
      await git(wt, ["add", "conflict.txt"]);

      // Continue
      const result = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.status).toBe("completed");
    }));

  test("manually git rebase --continue is detected", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      await advanceMain(env, "repo-a", "conflict.txt", "main version");
      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Resolve and manually continue
      await write(join(wt, "conflict.txt"), "resolved");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["rebase", "--continue"]);

      const result = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already resolved");
    }));

  test("manually git rebase --abort is detected", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      await advanceMain(env, "repo-a", "conflict.txt", "main version");
      await arb(env, ["rebase", "--yes"], { cwd: ws });

      await git(wt, ["rebase", "--abort"]);

      const result = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("manually aborted");
    }));

  test("re-running without resolving shows still-conflicting", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      await advanceMain(env, "repo-a", "conflict.txt", "main version");
      await arb(env, ["rebase", "--yes"], { cwd: ws });

      const result = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not yet resolved");
    }));

  test("multi-repo: one conflicts, other succeeds, continue completes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");

      // repo-a: conflicting commit
      await write(join(wtA, "conflict.txt"), "feature version");
      await git(wtA, ["add", "conflict.txt"]);
      await git(wtA, ["commit", "-m", "feature"]);

      // repo-b: non-conflicting commit
      await write(join(wtB, "feature.txt"), "feature");
      await git(wtB, ["add", "feature.txt"]);
      await git(wtB, ["commit", "-m", "feature"]);

      // Advance main on both
      await advanceMain(env, "repo-a", "conflict.txt", "main version");
      await advanceMain(env, "repo-b", "main-new.txt", "main advance");

      const r1 = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(r1.exitCode).not.toBe(0);

      const record = readJson(join(ws, ".arbws/operation.json"));
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-b"]?.status).toBe("completed");
      expect(repos["repo-a"]?.status).toBe("conflicting");

      // Resolve repo-a and continue
      await write(join(wtA, "conflict.txt"), "resolved");
      await git(wtA, ["add", "conflict.txt"]);

      const r2 = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(r2.exitCode).toBe(0);

      const record2 = readJson(join(ws, ".arbws/operation.json"));
      expect(record2.status).toBe("completed");
    }));
});

// ── rebase undo ──────────────────────────────────────────────────

describe("rebase undo", () => {
  test("undo successful rebase resets HEAD", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "feature.txt"), "feature");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      const preHead = (await git(wt, ["rev-parse", "HEAD"])).trim();
      await advanceMain(env, "repo-a", "main-new.txt", "main");

      await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).not.toBe(preHead);

      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));

  test("undo conflicted rebase aborts rebase and resets", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      const preHead = (await git(wt, ["rev-parse", "HEAD"])).trim();
      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);
    }));

  test("undo refuses when HEAD has drifted", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "feature.txt"), "feature");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "main-new.txt", "main");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Drift
      await write(join(wt, "drift.txt"), "drift");
      await git(wt, ["add", "drift.txt"]);
      await git(wt, ["commit", "-m", "drift"]);

      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("drifted");
    }));
});

// ── rebase gate ──────────────────────────────────────────────────

describe("rebase gate", () => {
  test("in-progress rebase blocks arb merge", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "conflict.txt", "main");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      const result = await arb(env, ["merge", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("rebase in progress");
    }));

  test("in-progress rebase blocks arb retarget", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "conflict.txt", "main");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      const result = await arb(env, ["retarget", "main", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("rebase in progress");
    }));
});

// ── merge operation ──────────────────────────────────────────────

describe("merge operation", () => {
  test("merge with conflict creates in-progress record, continue completes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      const r1 = await arb(env, ["merge", "--yes"], { cwd: ws });
      expect(r1.exitCode).not.toBe(0);

      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.command).toBe("merge");
      expect(record.status).toBe("in-progress");

      // Resolve and continue
      await write(join(wt, "conflict.txt"), "resolved");
      await git(wt, ["add", "conflict.txt"]);

      const r2 = await arb(env, ["merge", "--yes"], { cwd: ws });
      expect(r2.exitCode).toBe(0);

      const record2 = readJson(join(ws, ".arbws/operation.json"));
      expect(record2.status).toBe("completed");
    }));

  test("merge undo uses git merge --abort for in-progress, git reset --hard for completed", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      const preHead = (await git(wt, ["rev-parse", "HEAD"])).trim();
      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      await arb(env, ["merge", "--yes"], { cwd: ws });

      // Undo — should abort the in-progress merge
      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);
    }));

  test("in-progress merge blocks rebase", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "conflict.txt", "main");

      await arb(env, ["merge", "--yes"], { cwd: ws });

      const result = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("merge in progress");
    }));
});
