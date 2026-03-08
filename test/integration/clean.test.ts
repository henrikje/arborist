import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, gitBelow230, withEnv, write } from "./helpers/env";

// ── non-workspace directory cleanup ─────────────────────────────

describe("non-workspace directory cleanup", () => {
  test("arb clean --yes removes non-workspace directories", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "leftover/.idea"), { recursive: true });
      await mkdir(join(env.projectDir, "empty-dir"), { recursive: true });
      const result = await arb(env, ["clean", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "leftover"))).toBe(false);
      expect(existsSync(join(env.projectDir, "empty-dir"))).toBe(false);
      expect(result.output).toContain("Removed 2 directories");
    }));

  test("arb clean --dry-run shows but does not remove", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "leftover/.idea"), { recursive: true });
      const result = await arb(env, ["clean", "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "leftover"))).toBe(true);
      expect(result.output).toContain("leftover");
      expect(result.output).toContain("Dry run");
    }));

  test("arb clean with no debris shows nothing-to-clean message", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["clean", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Nothing to clean up");
    }));

  test("arb clean <name> --yes removes only named directories", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "remove-me"), { recursive: true });
      await mkdir(join(env.projectDir, "keep-me"), { recursive: true });
      const result = await arb(env, ["clean", "remove-me", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "remove-me"))).toBe(false);
      expect(existsSync(join(env.projectDir, "keep-me"))).toBe(true);
      expect(result.output).toContain("Removed 1 directory");
    }));

  test("arb clean <workspace-name> errors with guidance to use arb delete", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "my-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arb(env, ["clean", "my-ws", "--yes"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("is a workspace");
      expect(result.output).toContain("arb delete");
    }));

  test("arb clean without --yes fails in non-TTY", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "leftover"), { recursive: true });
      const result = await arb(env, ["clean"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not a terminal");
    }));

  test("arb clean shows content descriptions correctly", () =>
    withEnv(async (env) => {
      // empty directory
      await mkdir(join(env.projectDir, "empty-dir"), { recursive: true });
      // single entry directory
      await mkdir(join(env.projectDir, "idea-only/.idea"), { recursive: true });
      // multiple entries directory
      await mkdir(join(env.projectDir, "multi-item/subdir"), { recursive: true });
      await writeFile(join(env.projectDir, "multi-item/file1.txt"), "");
      await writeFile(join(env.projectDir, "multi-item/file2.txt"), "");

      const result = await arb(env, ["clean", "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("empty-dir");
      expect(result.output).toContain("empty");
      expect(result.output).toContain("idea-only");
      expect(result.output).toContain("only .idea/");
      expect(result.output).toContain("multi-item");
      expect(result.output).toContain("3 items");
    }));
});

// ── .arbignore ──────────────────────────────────────────────────

describe(".arbignore", () => {
  test("directories in .arbignore are excluded from arb clean", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "leftover"), { recursive: true });
      await mkdir(join(env.projectDir, "keep-this"), { recursive: true });
      await writeFile(join(env.projectDir, ".arbignore"), "keep-this");
      const result = await arb(env, ["clean", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "leftover"))).toBe(false);
      expect(existsSync(join(env.projectDir, "keep-this"))).toBe(true);
      expect(result.output).toContain("Removed 1 directory");
    }));

  test(".arbignore with comments and empty lines works correctly", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "leftover"), { recursive: true });
      await mkdir(join(env.projectDir, "ignored-dir"), { recursive: true });
      await writeFile(join(env.projectDir, ".arbignore"), "# This is a comment\n\nignored-dir\n\n# Another comment\n");
      const result = await arb(env, ["clean", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "leftover"))).toBe(false);
      expect(existsSync(join(env.projectDir, "ignored-dir"))).toBe(true);
    }));

  test("arb clean --dry-run notes .arbignore exclusions", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "leftover"), { recursive: true });
      await mkdir(join(env.projectDir, "ignored-a"), { recursive: true });
      await mkdir(join(env.projectDir, "ignored-b"), { recursive: true });
      await writeFile(join(env.projectDir, ".arbignore"), "ignored-a\nignored-b\n");
      const result = await arb(env, ["clean", "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("2 directories excluded by .arbignore");
    }));
});

// ── git cleanup ─────────────────────────────────────────────────

describe("git cleanup", () => {
  test("arb clean --yes prunes stale worktree refs", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "stale-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);
      await rm(join(env.projectDir, "stale-ws"), { recursive: true });

      // Verify stale refs exist
      const wtList = await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "list"]);
      expect(wtList).toContain("stale-ws");

      const result = await arb(env, ["clean", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("pruned");

      // Verify stale refs are gone
      const wtListAfter = await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "list"]);
      expect(wtListAfter).not.toContain("stale-ws");
    }));

  test("arb clean --yes removes orphaned local branches", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "orphan-test", "-a"]);
      expect(createResult.exitCode).toBe(0);

      // Remove workspace and prune worktrees but leave branches
      await rm(join(env.projectDir, "orphan-test"), { recursive: true });
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "prune"]);
      await git(join(env.projectDir, ".arb/repos/repo-b"), ["worktree", "prune"]);

      // Verify branches still exist
      const branchList = await git(join(env.projectDir, ".arb/repos/repo-a"), ["branch", "--list", "orphan-test"]);
      expect(branchList).toContain("orphan-test");

      const result = await arb(env, ["clean", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("orphaned branch");

      // Verify branches are gone
      const branchListAfter = await git(join(env.projectDir, ".arb/repos/repo-a"), ["branch", "--list", "orphan-test"]);
      expect(branchListAfter.trim() === "" || !branchListAfter.includes("orphan-test")).toBe(true);
    }));

  test("arb clean --yes skips unmerged orphaned branches without --force", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "unmerged-test", "-a"]);
      expect(createResult.exitCode).toBe(0);
      await write(join(env.projectDir, "unmerged-test/repo-a/unmerged.txt"), "unmerged content");
      await git(join(env.projectDir, "unmerged-test/repo-a"), ["add", "unmerged.txt"]);
      await git(join(env.projectDir, "unmerged-test/repo-a"), ["commit", "-m", "unmerged work"]);

      await rm(join(env.projectDir, "unmerged-test"), { recursive: true });
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "prune"]);
      await git(join(env.projectDir, ".arb/repos/repo-b"), ["worktree", "prune"]);

      const result = await arb(env, ["clean", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("skipped");
      expect(result.output).toContain("--force");

      // Unmerged branch in repo-a should still exist
      const branchList = await git(join(env.projectDir, ".arb/repos/repo-a"), ["branch", "--list", "unmerged-test"]);
      expect(branchList).toContain("unmerged-test");
    }));

  test("arb clean --yes --force deletes unmerged orphaned branches", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "force-test", "-a"]);
      expect(createResult.exitCode).toBe(0);
      await write(join(env.projectDir, "force-test/repo-a/force.txt"), "force content");
      await git(join(env.projectDir, "force-test/repo-a"), ["add", "force.txt"]);
      await git(join(env.projectDir, "force-test/repo-a"), ["commit", "-m", "force work"]);

      await rm(join(env.projectDir, "force-test"), { recursive: true });
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "prune"]);
      await git(join(env.projectDir, ".arb/repos/repo-b"), ["worktree", "prune"]);

      const result = await arb(env, ["clean", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("orphaned branch");

      // Branch should be gone
      const branchList = await git(join(env.projectDir, ".arb/repos/repo-a"), ["branch", "--list", "force-test"]);
      expect(branchList.trim() === "" || !branchList.includes("force-test")).toBe(true);
    }));

  test("arb clean --dry-run shows merge status annotations", () =>
    withEnv(async (env) => {
      // Create a merged orphan (no extra commits)
      const createMerged = await arb(env, ["create", "merged-orphan", "-a"]);
      expect(createMerged.exitCode).toBe(0);
      await rm(join(env.projectDir, "merged-orphan"), { recursive: true });
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "prune"]);
      await git(join(env.projectDir, ".arb/repos/repo-b"), ["worktree", "prune"]);

      // Create an unmerged orphan (with a commit)
      const createUnmerged = await arb(env, ["create", "unmerged-orphan", "-a"]);
      expect(createUnmerged.exitCode).toBe(0);
      await write(join(env.projectDir, "unmerged-orphan/repo-a/orphan.txt"), "orphan work");
      await git(join(env.projectDir, "unmerged-orphan/repo-a"), ["add", "orphan.txt"]);
      await git(join(env.projectDir, "unmerged-orphan/repo-a"), ["commit", "-m", "orphan work"]);
      await rm(join(env.projectDir, "unmerged-orphan"), { recursive: true });
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "prune"]);
      await git(join(env.projectDir, ".arb/repos/repo-b"), ["worktree", "prune"]);

      const result = await arb(env, ["clean", "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("(merged)");
      expect(result.output).toContain("ahead)");
    }));

  test("arb clean does not remove branches belonging to existing workspaces", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "active-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);

      // Verify branches exist
      const branchList = await git(join(env.projectDir, ".arb/repos/repo-a"), ["branch", "--list", "active-ws"]);
      expect(branchList).toContain("active-ws");

      const result = await arb(env, ["clean", "--yes"]);
      expect(result.exitCode).toBe(0);

      // Branches should still exist
      const branchListAfter = await git(join(env.projectDir, ".arb/repos/repo-a"), ["branch", "--list", "active-ws"]);
      expect(branchListAfter).toContain("active-ws");
    }));

  test("arb clean does not remove the default branch from canonical repos", () =>
    withEnv(async (env) => {
      // Verify main branch exists
      const mainBranch = await git(join(env.projectDir, ".arb/repos/repo-a"), ["branch", "--list", "main"]);
      expect(mainBranch).toContain("main");

      // Create a non-workspace dir so arb clean has something to do
      await mkdir(join(env.projectDir, "leftover"), { recursive: true });
      const result = await arb(env, ["clean", "--yes"]);
      expect(result.exitCode).toBe(0);

      // Default branch must survive
      const mainBranchA = await git(join(env.projectDir, ".arb/repos/repo-a"), ["branch", "--list", "main"]);
      expect(mainBranchA).toContain("main");
      const mainBranchB = await git(join(env.projectDir, ".arb/repos/repo-b"), ["branch", "--list", "main"]);
      expect(mainBranchB).toContain("main");
    }));

  test("arb clean -N skips fetch", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "leftover"), { recursive: true });
      const result = await arb(env, ["clean", "--yes", "-N"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Removed");
      expect(existsSync(join(env.projectDir, "leftover"))).toBe(false);
    }));
});

// ── workspace rename detection ──────────────────────────────────

describe("workspace rename detection", () => {
  test("arb clean does not prune renamed workspaces", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "old-name", "-a"]);
      expect(createResult.exitCode).toBe(0);

      // Manually rename the workspace directory
      renameSync(join(env.projectDir, "old-name"), join(env.projectDir, "new-name"));

      // Verify the gitdir back-ref is stale (still points to old path)
      const gitFile = readFileSync(join(env.projectDir, "new-name/repo-a/.git"), "utf-8").trim();
      const gitdirPath = gitFile.slice("gitdir: ".length);
      const backRef = readFileSync(join(gitdirPath, "gitdir"), "utf-8").trim();
      expect(backRef).toContain("old-name");

      // arb clean should NOT show stale worktree references
      const result = await arb(env, ["clean", "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("Stale worktree");
      expect(result.output).toContain("Nothing to clean up");
    }));

  test.skipIf(gitBelow230)("arb clean still prunes genuinely deleted workspaces after repair", () =>
    withEnv(async (env) => {
      const createRenamed = await arb(env, ["create", "renamed-ws", "-a"]);
      expect(createRenamed.exitCode).toBe(0);
      const createDeleted = await arb(env, ["create", "deleted-ws", "-a"]);
      expect(createDeleted.exitCode).toBe(0);

      // Rename one workspace, delete the other
      renameSync(join(env.projectDir, "renamed-ws"), join(env.projectDir, "moved-ws"));
      await rm(join(env.projectDir, "deleted-ws"), { recursive: true });

      // arb clean should repair the renamed workspace and prune the deleted one
      const result = await arb(env, ["clean", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("pruned");

      // Verify the renamed workspace's worktree refs are intact
      const wtList = await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "list"]);
      expect(wtList).toContain("moved-ws");
      expect(wtList).not.toContain("deleted-ws");
    }),
  );

  test("workspace command works after manual mv", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "feature-login", "-a"]);
      expect(createResult.exitCode).toBe(0);

      // Manually rename
      renameSync(join(env.projectDir, "feature-login"), join(env.projectDir, "feature-auth"));

      // arb status from inside the renamed workspace should work
      const statusResult = await arb(env, ["status"], { cwd: join(env.projectDir, "feature-auth") });
      expect(statusResult.exitCode).toBe(0);
    }));
});

// ── detection hint in arb delete ────────────────────────────────

describe("detection hint in arb delete", () => {
  test("arb delete hints when non-workspace directories exist", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "hint-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);
      await mkdir(join(env.projectDir, "leftover-shell"), { recursive: true });
      const result = await arb(env, ["delete", "hint-ws", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("non-workspace director");
      expect(result.output).toContain("arb clean");
    }));

  test("arb delete does not hint when no non-workspace directories exist", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "no-hint-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arb(env, ["delete", "no-hint-ws", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("arb clean");
    }));
});
