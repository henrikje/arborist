import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { arb, git, initBareRepo, withEnv, write } from "./helpers/env";

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

// ── multi-round continue ─────────────────────────────────────────

describe("rebase multi-round continue", () => {
  test("two commits that each conflict: resolve first, continue → second conflict, resolve second, continue → completes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");

      // Create 2 commits on feature branch modifying different files
      await write(join(wt, "file1.txt"), "feature1");
      await git(wt, ["add", "file1.txt"]);
      await git(wt, ["commit", "-m", "feature commit 1 - file1"]);

      await write(join(wt, "file2.txt"), "feature2");
      await git(wt, ["add", "file2.txt"]);
      await git(wt, ["commit", "-m", "feature commit 2 - file2"]);

      // Advance main with conflicting changes to BOTH files
      await git(mainRepo, ["checkout", "main"]);
      await write(join(mainRepo, "file1.txt"), "main1");
      await git(mainRepo, ["add", "file1.txt"]);
      await git(mainRepo, ["commit", "-m", "main conflict file1"]);
      await write(join(mainRepo, "file2.txt"), "main2");
      await git(mainRepo, ["add", "file2.txt"]);
      await git(mainRepo, ["commit", "-m", "main conflict file2"]);
      await git(mainRepo, ["push", "origin", "main"]);
      await git(mainRepo, ["checkout", "--detach"]);

      // First rebase → conflicts on file1 (first commit)
      const r1 = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(r1.exitCode).not.toBe(0);

      const record1 = readJson(join(ws, ".arbws/operation.json"));
      expect(record1.status).toBe("in-progress");

      // Resolve first conflict
      await write(join(wt, "file1.txt"), "resolved1");
      await git(wt, ["add", "file1.txt"]);

      // Continue → conflicts on file2 (second commit)
      const r2 = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(r2.exitCode).not.toBe(0);

      const record2 = readJson(join(ws, ".arbws/operation.json"));
      expect(record2.status).toBe("in-progress");

      // Resolve second conflict
      await write(join(wt, "file2.txt"), "resolved2");
      await git(wt, ["add", "file2.txt"]);

      // Continue → completes
      const r3 = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(r3.exitCode).toBe(0);

      const record3 = readJson(join(ws, ".arbws/operation.json"));
      expect(record3.status).toBe("completed");
    }));
});

// ── autostash + conflict + undo ──────────────────────────────────

describe("rebase autostash + conflict + undo", () => {
  test("rebase --autostash with conflict then undo restores dirty files", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      // Create a committed change that will conflict
      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      // Create dirty (uncommitted) file
      await write(join(wt, "dirty.txt"), "uncommitted work");
      await git(wt, ["add", "dirty.txt"]);

      const preHead = (await git(wt, ["rev-parse", "HEAD"])).trim();

      // Advance main with conflicting change
      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      // Rebase with autostash → conflict (git stashes dirty.txt, then conflicts on conflict.txt)
      const r1 = await arb(env, ["rebase", "--yes", "--autostash"], { cwd: ws });
      expect(r1.exitCode).not.toBe(0);

      // Operation record should show stashSha
      const record = readJson(join(ws, ".arbws/operation.json"));
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-a"]?.stashSha).toBeDefined();

      // Undo → should abort rebase and restore HEAD
      const r2 = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(r2.exitCode).toBe(0);

      // HEAD restored
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);

      // dirty.txt should be restored (stash applied back)
      expect(existsSync(join(wt, "dirty.txt"))).toBe(true);
    }));
});

// ── continue-then-undo end-to-end ────────────────────────────────

describe("rebase continue then undo", () => {
  test("conflict → resolve → continue → completed → undo → HEAD back to preHead", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      const preHead = (await git(wt, ["rev-parse", "HEAD"])).trim();
      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      // Rebase → conflict
      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Resolve and continue
      await write(join(wt, "conflict.txt"), "resolved");
      await git(wt, ["add", "conflict.txt"]);
      const continueResult = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(continueResult.exitCode).toBe(0);

      // Record should be completed with postHead
      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.status).toBe("completed");
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-a"]?.postHead).toBeDefined();

      // HEAD has moved from preHead
      const postHead = (await git(wt, ["rev-parse", "HEAD"])).trim();
      expect(postHead).not.toBe(preHead);

      // Undo → HEAD back to preHead
      const undoResult = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(undoResult.exitCode).toBe(0);
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));
});

// ── multi-repo undo where one repo drifted ───────────────────────

describe("multi-repo undo with drift", () => {
  test("2 repos rebased, one drifted → undo refused for entire workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");

      // Both repos: create feature commits
      await write(join(wtA, "feature.txt"), "feature a");
      await git(wtA, ["add", "feature.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await write(join(wtB, "feature.txt"), "feature b");
      await git(wtB, ["add", "feature.txt"]);
      await git(wtB, ["commit", "-m", "feature b"]);

      // Advance main on both
      await advanceMain(env, "repo-a", "main-new.txt", "main advance a");
      await advanceMain(env, "repo-b", "main-new.txt", "main advance b");

      // Rebase both repos
      const rebaseResult = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(rebaseResult.exitCode).toBe(0);

      // Drift: make a new commit in repo-a
      await write(join(wtA, "drift.txt"), "drift");
      await git(wtA, ["add", "drift.txt"]);
      await git(wtA, ["commit", "-m", "drift commit"]);

      // Undo → should refuse because repo-a drifted
      const undoResult = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(undoResult.exitCode).not.toBe(0);
      expect(undoResult.output).toContain("drifted");
    }));
});

// ── 3-repo workspace ─────────────────────────────────────────────

describe("rebase 3-repo workspace", () => {
  test("3 repos, one conflicts, two succeed — continue completes all", () =>
    withEnv(async (env) => {
      // Create a third repo (repo-c) in the test environment
      const repoC = join(env.originDir, "repo-c.git");
      await initBareRepo(env.testDir, repoC, "main");
      await git(env.testDir, ["clone", repoC, join(env.projectDir, ".arb/repos/repo-c")]);
      const repoCDir = join(env.projectDir, ".arb/repos/repo-c");
      await git(repoCDir, ["commit", "--allow-empty", "-m", "init"]);
      await git(repoCDir, ["push"]);

      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "repo-c", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");
      const wtC = join(ws, "repo-c");

      // repo-a: conflicting commit
      await write(join(wtA, "conflict.txt"), "feature version");
      await git(wtA, ["add", "conflict.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      // repo-b: non-conflicting commit
      await write(join(wtB, "feature.txt"), "feature b");
      await git(wtB, ["add", "feature.txt"]);
      await git(wtB, ["commit", "-m", "feature b"]);

      // repo-c: non-conflicting commit
      await write(join(wtC, "feature.txt"), "feature c");
      await git(wtC, ["add", "feature.txt"]);
      await git(wtC, ["commit", "-m", "feature c"]);

      // Advance main on all three — only repo-a has conflicting content
      await advanceMain(env, "repo-a", "conflict.txt", "main version");
      await advanceMain(env, "repo-b", "main-new.txt", "main advance b");

      // For repo-c, advance main manually
      const mainRepoC = join(env.projectDir, ".arb/repos/repo-c");
      await git(mainRepoC, ["checkout", "main"]);
      await write(join(mainRepoC, "main-new.txt"), "main advance c");
      await git(mainRepoC, ["add", "main-new.txt"]);
      await git(mainRepoC, ["commit", "-m", "advance main: repo-c"]);
      await git(mainRepoC, ["push", "origin", "main"]);
      await git(mainRepoC, ["checkout", "--detach"]);

      // Rebase → repo-a conflicts, repo-b and repo-c succeed
      const r1 = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(r1.exitCode).not.toBe(0);

      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.status).toBe("in-progress");
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-b"]?.status).toBe("completed");
      expect(repos["repo-c"]?.status).toBe("completed");
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

// ── sync undo after repo detached ────────────────────────────────

describe("rebase undo after repo detached", () => {
  test("rebase → detach repo → undo skips detached repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");

      // Both repos: create feature commits
      await write(join(wtA, "feature.txt"), "feature a");
      await git(wtA, ["add", "feature.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await write(join(wtB, "feature.txt"), "feature b");
      await git(wtB, ["add", "feature.txt"]);
      await git(wtB, ["commit", "-m", "feature b"]);

      const preHeadB = (await git(wtB, ["rev-parse", "HEAD"])).trim();

      // Advance main on both
      await advanceMain(env, "repo-a", "main-new.txt", "main advance a");
      await advanceMain(env, "repo-b", "main-new.txt", "main advance b");

      // Rebase both
      const rebaseResult = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(rebaseResult.exitCode).toBe(0);

      // Detach repo-a from the workspace
      await arb(env, ["detach", "repo-a", "--yes", "-N"], { cwd: ws });

      // Undo — should succeed, skipping the detached repo-a
      const undoResult = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(undoResult.exitCode).toBe(0);

      // repo-b should be restored
      expect((await git(wtB, ["rev-parse", "HEAD"])).trim()).toBe(preHeadB);

      // Operation record cleaned up
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));
});

// ── continue with --dry-run ──────────────────────────────────────

describe("rebase continue dry-run", () => {
  test("conflict → resolve → arb rebase --dry-run → shows plan but no changes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      // Rebase → conflict
      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Resolve the conflict
      await write(join(wt, "conflict.txt"), "resolved");
      await git(wt, ["add", "conflict.txt"]);

      // Dry-run continue → shows plan but does not execute
      const dryResult = await arb(env, ["rebase", "--dry-run"], { cwd: ws });
      expect(dryResult.exitCode).toBe(0);
      expect(dryResult.output).toContain("Dry run");

      // Operation record should still be in-progress (not completed)
      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.status).toBe("in-progress");

      // Conflict should still exist in git (not continued)
      const repos = record.repos as Record<string, Record<string, unknown>>;
      expect(repos["repo-a"]?.status).toBe("conflicting");
    }));
});
