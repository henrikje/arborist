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
      const result = await arb(env, ["rebase", "--continue", "--yes"], { cwd: ws });
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
      await git(wt, ["-c", "core.editor=true", "rebase", "--continue"]);

      const result = await arb(env, ["rebase", "--continue", "--yes"], { cwd: ws });
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

      const result = await arb(env, ["rebase", "--continue", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("manually aborted");
    }));

  test("--continue without resolving shows still-conflicting", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      await advanceMain(env, "repo-a", "conflict.txt", "main version");
      await arb(env, ["rebase", "--yes"], { cwd: ws });

      const result = await arb(env, ["rebase", "--continue", "--yes"], { cwd: ws });
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

      const r2 = await arb(env, ["rebase", "--continue", "--yes"], { cwd: ws });
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
      const op = readJson(join(ws, ".arbws/operation.json")) as Record<string, unknown>;
      expect(op.status).toBe("completed");
      expect(op.outcome).toBe("undone");
    }));

  test("undo --verbose --dry-run shows commit subjects", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "feature.txt"), "feature");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature"]);

      await advanceMain(env, "repo-a", "upstream-one.txt", "one");
      await advanceMain(env, "repo-a", "upstream-two.txt", "two");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      const result = await arb(env, ["undo", "--verbose", "--dry-run"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Rolling back");
      expect(result.output).toContain("advance main: upstream-one.txt");
      expect(result.output).toContain("advance main: upstream-two.txt");
      expect(result.output).toContain("files changed");
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

  test("undo --force overrides drift on sync undo (rebase with post-operation commit)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "feature.txt"), "feature");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "main-new.txt", "main");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Capture pre-operation HEAD from the record
      const op = readJson(join(ws, ".arbws/operation.json"));
      const repoState = (op.repos as Record<string, { preHead: string }>)["repo-a"];
      const preHead = repoState.preHead;

      // Drift: make a new commit after rebase
      await write(join(wt, "drift.txt"), "drift");
      await git(wt, ["add", "drift.txt"]);
      await git(wt, ["commit", "-m", "drift"]);

      // --force should override drift and reset to preHead
      const result = await arb(env, ["undo", "--force", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Undone");
      expect(result.output).toContain("force reset");

      // HEAD should be at the pre-operation state
      const currentHead = (await git(wt, ["rev-parse", "HEAD"])).trim();
      expect(currentHead).toBe(preHead);
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

      const r2 = await arb(env, ["merge", "--continue", "--yes"], { cwd: ws });
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
      const r2 = await arb(env, ["rebase", "--continue", "--yes"], { cwd: ws });
      expect(r2.exitCode).not.toBe(0);

      const record2 = readJson(join(ws, ".arbws/operation.json"));
      expect(record2.status).toBe("in-progress");

      // Resolve second conflict
      await write(join(wt, "file2.txt"), "resolved2");
      await git(wt, ["add", "file2.txt"]);

      // Continue → completes
      const r3 = await arb(env, ["rebase", "--continue", "--yes"], { cwd: ws });
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
      const continueResult = await arb(env, ["rebase", "--continue", "--yes"], { cwd: ws });
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
      const op = readJson(join(ws, ".arbws/operation.json")) as Record<string, unknown>;
      expect(op.status).toBe("completed");
      expect(op.outcome).toBe("undone");
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

  test("2 repos rebased, one drifted → --force undoes both", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");

      await write(join(wtA, "feature.txt"), "feature a");
      await git(wtA, ["add", "feature.txt"]);
      await git(wtA, ["commit", "-m", "feature a"]);

      await write(join(wtB, "feature.txt"), "feature b");
      await git(wtB, ["add", "feature.txt"]);
      await git(wtB, ["commit", "-m", "feature b"]);

      await advanceMain(env, "repo-a", "main-new.txt", "main advance a");
      await advanceMain(env, "repo-b", "main-new.txt", "main advance b");

      const rebaseResult = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(rebaseResult.exitCode).toBe(0);

      const op = readJson(join(ws, ".arbws/operation.json"));
      const preHeadA = (op.repos as Record<string, { preHead: string }>)["repo-a"].preHead;
      const preHeadB = (op.repos as Record<string, { preHead: string }>)["repo-b"].preHead;

      // Drift repo-a only
      await write(join(wtA, "drift.txt"), "drift");
      await git(wtA, ["add", "drift.txt"]);
      await git(wtA, ["commit", "-m", "drift commit"]);

      // --force undoes both (force-resets drifted repo-a, normal undo for repo-b)
      const forceResult = await arb(env, ["undo", "--force", "--yes"], { cwd: ws });
      expect(forceResult.exitCode).toBe(0);
      expect(forceResult.output).toContain("Undone 2 repos");

      expect((await git(wtA, ["rev-parse", "HEAD"])).trim()).toBe(preHeadA);
      expect((await git(wtB, ["rev-parse", "HEAD"])).trim()).toBe(preHeadB);
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

      const r2 = await arb(env, ["rebase", "--continue", "--yes"], { cwd: ws });
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

      // Operation record finalized
      const op = readJson(join(ws, ".arbws/operation.json")) as Record<string, unknown>;
      expect(op.status).toBe("completed");
      expect(op.outcome).toBe("undone");
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
      const dryResult = await arb(env, ["rebase", "--continue", "--dry-run"], { cwd: ws });
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

// ── bare command blocked during in-progress ──────────────────────

describe("rebase bare command blocked", () => {
  test("bare arb rebase during in-progress is blocked with guidance", () =>
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
      expect(result.output).toContain("in progress");
      expect(result.output).toContain("--continue");
    }));

  test("bare arb merge during in-progress is blocked with guidance", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      await arb(env, ["merge", "--yes"], { cwd: ws });

      const result = await arb(env, ["merge", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("in progress");
      expect(result.output).toContain("--continue");
    }));
});

// ── --continue/--abort with no operation ─────────────────────────

describe("rebase --continue/--abort with no operation", () => {
  test("--continue with no operation errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");

      const result = await arb(env, ["rebase", "--continue", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Nothing to continue");
    }));

  test("--abort with no operation errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");

      const result = await arb(env, ["rebase", "--abort", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Nothing to abort");
    }));

  test("merge --continue with no operation errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");

      const result = await arb(env, ["merge", "--continue", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Nothing to continue");
    }));

  test("merge --abort with no operation errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");

      const result = await arb(env, ["merge", "--abort", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Nothing to abort");
    }));
});

// ── --abort cancels in-progress ──────────────────────────────────

describe("rebase --abort cancels in-progress", () => {
  test("--abort cancels in-progress rebase", () =>
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

      const result = await arb(env, ["rebase", "--abort", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);
      const op851 = readJson(join(ws, ".arbws/operation.json")) as Record<string, unknown>;
      expect(op851.status).toBe("completed");
      expect(op851.outcome).toBe("aborted");
    }));

  test("--abort cancels in-progress merge", () =>
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

      const result = await arb(env, ["merge", "--abort", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect((await git(wt, ["rev-parse", "HEAD"])).trim()).toBe(preHead);
      const op872 = readJson(join(ws, ".arbws/operation.json")) as Record<string, unknown>;
      expect(op872.status).toBe("completed");
      expect(op872.outcome).toBe("aborted");
    }));
});

// ── auto-complete ───────────────────────────────────────────────

describe("operation auto-complete", () => {
  test("gate auto-completes when user resolved via git rebase --continue", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      // Rebase conflicts
      const r1 = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(r1.exitCode).not.toBe(0);

      const record1 = readJson(join(ws, ".arbws/operation.json"));
      expect(record1.status).toBe("in-progress");

      // User resolves via git directly
      await write(join(wt, "conflict.txt"), "resolved");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["-c", "core.editor=true", "rebase", "--continue"]);

      // Running a gated command should auto-complete the record, not block
      const r2 = await arb(env, ["push", "--dry-run", "--no-fetch"], { cwd: ws });
      expect(r2.exitCode).toBe(0);
      expect(r2.output).not.toContain("rebase in progress");

      const record2 = readJson(join(ws, ".arbws/operation.json"));
      expect(record2.status).toBe("completed");
    }));

  test("gate auto-completes multi-repo when all resolved via git", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wtA = join(ws, "repo-a");
      const wtB = join(ws, "repo-b");

      // Both repos: conflicting commits
      await write(join(wtA, "conflict.txt"), "feature-a");
      await git(wtA, ["add", "conflict.txt"]);
      await git(wtA, ["commit", "-m", "feature-a"]);

      await write(join(wtB, "conflict.txt"), "feature-b");
      await git(wtB, ["add", "conflict.txt"]);
      await git(wtB, ["commit", "-m", "feature-b"]);

      await advanceMain(env, "repo-a", "conflict.txt", "main-a");
      await advanceMain(env, "repo-b", "conflict.txt", "main-b");

      const r1 = await arb(env, ["rebase", "--yes"], { cwd: ws });
      expect(r1.exitCode).not.toBe(0);

      // Resolve both via git
      await write(join(wtA, "conflict.txt"), "resolved-a");
      await git(wtA, ["add", "conflict.txt"]);
      await git(wtA, ["-c", "core.editor=true", "rebase", "--continue"]);

      await write(join(wtB, "conflict.txt"), "resolved-b");
      await git(wtB, ["add", "conflict.txt"]);
      await git(wtB, ["-c", "core.editor=true", "rebase", "--continue"]);

      // A gated command should auto-complete
      const r2 = await arb(env, ["push", "--dry-run", "--no-fetch"], { cwd: ws });
      expect(r2.exitCode).toBe(0);

      const record2 = readJson(join(ws, ".arbws/operation.json"));
      expect(record2.status).toBe("completed");
    }));

  test("gate does NOT auto-complete when conflicts remain", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Do NOT resolve — try to run a gated command
      const r2 = await arb(env, ["push", "--dry-run", "--no-fetch"], { cwd: ws });
      expect(r2.exitCode).not.toBe(0);
      expect(r2.output).toContain("rebase in progress");

      const record = readJson(join(ws, ".arbws/operation.json"));
      expect(record.status).toBe("in-progress");
    }));

  test("gate does NOT auto-complete when user git rebase --abort (manually aborted)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "conflict.txt"), "feature version");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "conflict.txt", "main version");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // User aborts via git directly
      await git(wt, ["rebase", "--abort"]);

      // Gate should still block — manually-aborted is not a no-op
      const r2 = await arb(env, ["push", "--dry-run", "--no-fetch"], { cwd: ws });
      expect(r2.exitCode).not.toBe(0);
      expect(r2.output).toContain("rebase in progress");
    }));

  test("gate does NOT auto-complete when configAfter is present even if all repos completed", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");

      await write(join(wt, "feature.txt"), "feature");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await advanceMain(env, "repo-a", "main-new.txt", "main advance");

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      // Manually inject configAfter into the (completed) operation record
      const recordPath = join(ws, ".arbws/operation.json");
      const record = readJson(recordPath);
      record.configAfter = { branch: "my-feature", base: "new-base" };
      record.status = "in-progress";
      const { writeFileSync } = await import("node:fs");
      writeFileSync(recordPath, JSON.stringify(record, null, 2));

      // Gate should block — configAfter needs explicit --continue
      const r2 = await arb(env, ["push", "--dry-run", "--no-fetch"], { cwd: ws });
      expect(r2.exitCode).not.toBe(0);
      expect(r2.output).toContain("in progress");
    }));
});
