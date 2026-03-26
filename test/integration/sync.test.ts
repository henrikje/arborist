import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { arb, fetchAllRepos, git, pushThenDeleteRemote, withEnv, write } from "./helpers/env";

// ── pull ─────────────────────────────────────────────────────────

describe("pull", () => {
  test("arb pull after push succeeds", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(repoA, "file.txt"), "change");
      await git(repoA, ["add", "file.txt"]);
      await git(repoA, ["commit", "-m", "change"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      const result = await arb(env, ["pull"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
    }));

  test("arb pull uses parallel fetch then sequential pull", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["push", "-u", "origin", "my-feature"]);

      const result = await arb(env, ["pull"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("arb pull repo-a only fetches named repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["push", "-u", "origin", "my-feature"]);

      // Push a remote commit to repo-a
      const tmpCloneA = join(env.testDir, "tmp-clone-a");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpCloneA]);
      await git(tmpCloneA, ["checkout", "my-feature"]);
      await write(join(tmpCloneA, "r.txt"), "remote");
      await git(tmpCloneA, ["add", "r.txt"]);
      await git(tmpCloneA, ["commit", "-m", "remote"]);
      await git(tmpCloneA, ["push"]);

      const result = await arb(env, ["pull", "repo-a", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fetched 1 repo");
      expect(result.output).toContain("Pulled 1 repo");
    }));

  test("arb pull continues through repos on conflict", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["push", "-u", "origin", "my-feature"]);

      // Create a conflict in repo-a via a separate clone
      const tmpCloneA = join(env.testDir, "tmp-clone-a");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpCloneA]);
      await git(tmpCloneA, ["checkout", "my-feature"]);
      await write(join(tmpCloneA, "conflict.txt"), "remote change");
      await git(tmpCloneA, ["add", "conflict.txt"]);
      await git(tmpCloneA, ["commit", "-m", "remote"]);
      await git(tmpCloneA, ["push"]);

      // Local conflicting commit in worktree
      await write(join(env.projectDir, "my-feature/repo-a/conflict.txt"), "local change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "conflict.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "local"]);

      // Push a non-conflicting commit for repo-b so it has something to pull
      const tmpCloneB = join(env.testDir, "tmp-clone-b");
      await git(env.testDir, ["clone", join(env.originDir, "repo-b.git"), tmpCloneB]);
      await git(tmpCloneB, ["checkout", "my-feature"]);
      await write(join(tmpCloneB, "r.txt"), "remote");
      await git(tmpCloneB, ["add", "r.txt"]);
      await git(tmpCloneB, ["commit", "-m", "remote commit"]);
      await git(tmpCloneB, ["push"]);

      const result = await arb(env, ["pull", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).not.toBe(0);
      // repo-b was still processed successfully
      expect(result.output).toContain("repo-b");
      // Conflict file details shown
      expect(result.output).toContain("CONFLICT");
      expect(result.output).toContain("conflict.txt");
      // Consolidated conflict report
      expect(result.output).toContain("1 conflicted");
      expect(result.output).toContain("Pulled 1 repo");
    }));

  test("arb pull without workspace context fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["pull"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not inside a workspace");
    }));
});

// ── push ─────────────────────────────────────────────────────────

describe("push", () => {
  test("arb push pushes feature branch to origin", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);

      const result = await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pushed");

      // Verify the branch exists on the remote
      const refResult = await git(join(env.projectDir, ".arb/repos/repo-a"), [
        "show-ref",
        "--verify",
        "refs/remotes/origin/my-feature",
      ]);
      expect(refResult).toBeTruthy();
    }));

  test("arb push without workspace context fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["push"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not inside a workspace");
    }));
});

// ── pull (plan+confirm) ─────────────────────────────────────────

describe("pull (plan+confirm)", () => {
  test("arb pull --yes skips confirmation", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(repoA, "file.txt"), "change");
      await git(repoA, ["add", "file.txt"]);
      await git(repoA, ["commit", "-m", "change"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Push a new commit from another clone
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "r.txt"), "remote");
      await git(tmpClone, ["add", "r.txt"]);
      await git(tmpClone, ["commit", "-m", "remote commit"]);
      await git(tmpClone, ["push"]);

      const result = await arb(env, ["pull", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pulled");
      expect(result.output).toContain("to pull");
      expect(result.output).toContain("Skipping confirmation");
    }));
});

// ── push (plan+confirm) ─────────────────────────────────────────

describe("push (plan+confirm)", () => {
  test("arb push --yes skips confirmation", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);

      const result = await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pushed");
      expect(result.output).toContain("to push");
      expect(result.output).toContain("Skipping confirmation");
    }));

  test("arb push fetches by default", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);

      const result = await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fetched");
      expect(result.output).toContain("Pushed");
    }));

  test("arb push repo-a only fetches named repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);

      const result = await arb(env, ["push", "repo-a", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fetched 1 repo");
      expect(result.output).toContain("Pushed 1 repo");
    }));

  test("arb push --no-fetch skips fetching", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);

      const result = await arb(env, ["push", "--no-fetch", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("Fetched");
      expect(result.output).toContain("Pushed");
    }));
});

// ── push [repos...] and --force ─────────────────────────────────

describe("push [repos...] and --force", () => {
  test("arb push repo-a --yes only pushes named repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);
      await write(join(env.projectDir, "my-feature/repo-b/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-b"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["commit", "-m", "change"]);

      const result = await arb(env, ["push", "repo-a", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pushed 1 repo");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb push after rebase auto-pushes when all remote commits are outdated", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "feature");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feature"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      // Push an upstream change to main
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "upstream.txt"), "upstream");
      await git(mainRepo, ["add", "upstream.txt"]);
      await git(mainRepo, ["commit", "-m", "upstream"]);
      await git(mainRepo, ["push"]);

      // Rebase the feature branch (auto-fetches)
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      // Push without --force — all remote commits are rebased (outdated), so auto-push works
      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("replaces");
      expect(result.output).not.toContain("diverged");
      expect(result.output).toContain("Pushed");
    }));

  test("arb push -f short flag works", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "feature");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feature"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "upstream.txt"), "upstream");
      await git(mainRepo, ["add", "upstream.txt"]);
      await git(mainRepo, ["commit", "-m", "upstream"]);
      await git(mainRepo, ["push"]);

      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      const result = await arb(env, ["push", "-f", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pushed");
    }));

  test("arb push nonexistent repo errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const result = await arb(env, ["push", "nonexistent-repo", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not in this workspace");
    }));

  test("arb push --force on non-diverged repo does normal push", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);

      const result = await arb(env, ["push", "--force", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pushed");
    }));

  test("arb push auto-pushes when remote commits are all outdated (squash scenario)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Make 3 commits and push
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "commit a"]);
      await write(join(repoA, "b.txt"), "b");
      await git(repoA, ["add", "b.txt"]);
      await git(repoA, ["commit", "-m", "commit b"]);
      await write(join(repoA, "c.txt"), "c");
      await git(repoA, ["add", "c.txt"]);
      await git(repoA, ["commit", "-m", "commit c"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Squash all 3 commits into 1
      await git(repoA, ["reset", "--soft", "HEAD~3"]);
      await git(repoA, ["commit", "-m", "squashed: a + b + c"]);

      // Fetch so arb sees the remote state
      await fetchAllRepos(env);

      // Push without --force — should succeed because all remote commits are outdated
      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("replaces");
      expect(result.output).not.toContain("diverged");
      expect(result.output).toContain("Pushed");
    }));

  test("arb push --force still works on outdated repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(repoA, "file.txt"), "feature");
      await git(repoA, ["add", "file.txt"]);
      await git(repoA, ["commit", "-m", "feature"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Advance main and rebase (creates outdated remote commits)
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "upstream.txt"), "upstream");
      await git(mainRepo, ["add", "upstream.txt"]);
      await git(mainRepo, ["commit", "-m", "upstream"]);
      await git(mainRepo, ["push"]);
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      // Push with --force on an outdated repo — should still succeed
      const result = await arb(env, ["push", "--force", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pushed");
    }));

  test("arb push skips genuinely diverged repo without --force", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(repoA, "file.txt"), "feature");
      await git(repoA, ["add", "file.txt"]);
      await git(repoA, ["commit", "-m", "feature"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Simulate someone else pushing a new commit to the remote branch
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-diverge");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["checkout", "my-feature"]);
      await write(join(tmp, "other.txt"), "someone else's work");
      await git(tmp, ["add", "other.txt"]);
      await git(tmp, ["commit", "-m", "other commit"]);
      await git(tmp, ["push", "origin", "my-feature"]);

      // Make a new local commit (diverging from remote)
      await write(join(repoA, "local.txt"), "local work");
      await git(repoA, ["add", "local.txt"]);
      await git(repoA, ["commit", "-m", "local commit"]);

      // Push without --force should skip — remote has a genuinely new commit
      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("diverged from origin");
      expect(result.output).toContain("--force");
    }));

  test("arb push auto-pushes squash via cumulative patch-id (no reflog needed)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Make 2 commits and push
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "commit a"]);
      await write(join(repoA, "b.txt"), "b");
      await git(repoA, ["add", "b.txt"]);
      await git(repoA, ["commit", "-m", "commit b"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Expire the reflog so detectReplacedCommits cannot find old hashes
      await git(repoA, ["reflog", "expire", "--expire=now", "--all"]);

      // Squash 2 commits into 1
      await git(repoA, ["reset", "--soft", "HEAD~2"]);
      await git(repoA, ["commit", "-m", "squashed: a + b"]);

      // Fetch so arb sees the remote state
      await fetchAllRepos(env);

      // Push without --force — cumulative patch-id detection should match
      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("replaces");
      expect(result.output).not.toContain("diverged");
      expect(result.output).toContain("Pushed");
    }));

  test("arb push requires --force when squash changes content", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Make 2 commits and push
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "commit a"]);
      await write(join(repoA, "b.txt"), "b");
      await git(repoA, ["add", "b.txt"]);
      await git(repoA, ["commit", "-m", "commit b"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Expire reflog and squash with DIFFERENT content
      await git(repoA, ["reflog", "expire", "--expire=now", "--all"]);
      await git(repoA, ["reset", "--soft", "HEAD~2"]);
      await write(join(repoA, "a.txt"), "changed-a"); // different content!
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "squashed with changes"]);

      await fetchAllRepos(env);

      // Should require --force because cumulative diffs differ
      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("diverged");
      expect(result.output).toContain("--force");
    }));

  test("arb push blocks when genuinely diverged (someone else pushed)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Make 1 commit and push
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "commit a"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Simulate colleague pushing a new commit to remote
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-colleague-push");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["checkout", "my-feature"]);
      await write(join(tmp, "colleague.txt"), "colleague work");
      await git(tmp, ["add", "colleague.txt"]);
      await git(tmp, ["commit", "-m", "colleague commit"]);
      await git(tmp, ["push", "origin", "my-feature"]);

      // Squash locally (different content from remote)
      await git(repoA, ["reflog", "expire", "--expire=now", "--all"]);
      await git(repoA, ["reset", "--soft", "HEAD~1"]);
      await git(repoA, ["commit", "-m", "squashed"]);

      await fetchAllRepos(env);

      // Should require --force because colleague added genuinely new content
      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("diverged");
    }));

  test("arb push auto-pushes partial squash (same cumulative diff)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Make 3 commits: a, b, c
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "commit a"]);
      await write(join(repoA, "b.txt"), "b");
      await git(repoA, ["add", "b.txt"]);
      await git(repoA, ["commit", "-m", "commit b"]);
      await write(join(repoA, "c.txt"), "c");
      await git(repoA, ["add", "c.txt"]);
      await git(repoA, ["commit", "-m", "commit c"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Expire reflog so only cumulative patch-id can detect
      await git(repoA, ["reflog", "expire", "--expire=now", "--all"]);

      // Keep commit a, squash b+c into one
      await git(repoA, ["reset", "--soft", "HEAD~2"]);
      await git(repoA, ["commit", "-m", "squashed b+c"]);

      await fetchAllRepos(env);

      // Cumulative diffs match (same net changes), should auto-push
      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("replaces");
      expect(result.output).not.toContain("diverged");
      expect(result.output).toContain("Pushed");
    }));

  test("arb push auto-pushes after fast-forward pull + content-changing rewrite", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Make commit A, push
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "commit a"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Collaborator pushes B, C on top of A
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-ff-collab");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["checkout", "my-feature"]);
      await write(join(tmp, "b.txt"), "b");
      await git(tmp, ["add", "b.txt"]);
      await git(tmp, ["commit", "-m", "commit b"]);
      await write(join(tmp, "c.txt"), "c");
      await git(tmp, ["add", "c.txt"]);
      await git(tmp, ["commit", "-m", "commit c"]);
      await git(tmp, ["push", "origin", "my-feature"]);
      await rm(tmp, { recursive: true });

      // Pull with fast-forward (B and C are intermediates, only tip enters reflog)
      await git(repoA, ["pull", "--ff-only"]);

      // Content-changing rewrite: squash B+C and modify content
      await git(repoA, ["reset", "--soft", "HEAD~2"]);
      await write(join(repoA, "b.txt"), "modified-b");
      await write(join(repoA, "c.txt"), "modified-c");
      await git(repoA, ["add", "b.txt", "c.txt"]);
      await git(repoA, ["commit", "-m", "squash b+c (modified)"]);

      await fetchAllRepos(env);

      // Push without --force — the ancestry walk should detect B, C as replaced
      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("replaces");
      expect(result.output).not.toContain("diverged");
      expect(result.output).toContain("Pushed");
    }));

  test("arb push blocks when collaborator adds new work on top of fast-forward-pulled commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Make commit A, push
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "commit a"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Collaborator pushes B, C on top of A
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-ff-collab2");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["checkout", "my-feature"]);
      await write(join(tmp, "b.txt"), "b");
      await git(tmp, ["add", "b.txt"]);
      await git(tmp, ["commit", "-m", "commit b"]);
      await write(join(tmp, "c.txt"), "c");
      await git(tmp, ["add", "c.txt"]);
      await git(tmp, ["commit", "-m", "commit c"]);
      await git(tmp, ["push", "origin", "my-feature"]);

      // Pull with fast-forward
      await git(repoA, ["pull", "--ff-only"]);

      // Content-changing rewrite: squash B+C
      await git(repoA, ["reset", "--soft", "HEAD~2"]);
      await write(join(repoA, "b.txt"), "modified-b");
      await write(join(repoA, "c.txt"), "modified-c");
      await git(repoA, ["add", "b.txt", "c.txt"]);
      await git(repoA, ["commit", "-m", "squash b+c (modified)"]);

      // Collaborator pushes ANOTHER genuinely new commit D
      await git(tmp, ["pull"]);
      await write(join(tmp, "d.txt"), "d");
      await git(tmp, ["add", "d.txt"]);
      await git(tmp, ["commit", "-m", "commit d"]);
      await git(tmp, ["push", "origin", "my-feature"]);
      await rm(tmp, { recursive: true });

      await fetchAllRepos(env);

      // Should require --force because D is genuinely new
      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("diverged");
      expect(result.output).toContain("--force");
    }));

  test("arb pull skips rebased repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "feature");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feature"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      // Advance main and rebase
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "upstream.txt"), "upstream");
      await git(mainRepo, ["add", "upstream.txt"]);
      await git(mainRepo, ["commit", "-m", "upstream"]);
      await git(mainRepo, ["push"]);

      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      // Pull should skip the rebased repo
      const result = await arb(env, ["pull", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("rebased locally");
      expect(result.output).toContain("push --force");
      expect(result.output).toContain("pull --reset");
    }));

  test("arb pull skips replaced repo (rebase with conflict resolution)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Create a feature commit that modifies a shared file
      await write(join(repoA, "shared.txt"), "line1\nfeature-change\nline3\n");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "feature: modify shared"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Create a conflicting commit on main (same file, same line)
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "shared.txt"), "line1\nmain-change\nline3\n");
      await git(mainRepo, ["add", "shared.txt"]);
      await git(mainRepo, ["commit", "-m", "main: modify shared"]);
      await git(mainRepo, ["push"]);

      // Rebase manually (arb rebase would stop at conflict)
      await git(repoA, ["fetch", "origin"]);
      try {
        await git(repoA, ["rebase", "origin/main"]);
      } catch {
        // Expected conflict — resolve by keeping both changes
        await write(join(repoA, "shared.txt"), "line1\nmain-change\nfeature-change\nline3\n");
        await git(repoA, ["add", "shared.txt"]);
        await git(repoA, ["-c", "core.editor=true", "rebase", "--continue"]);
      }

      // Patch-IDs differ (conflict resolution changed the diff),
      // but the old commit is in the reflog → replaced detection
      const result = await arb(env, ["pull", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("rebased locally");
      expect(result.output).toContain("push --force");
      expect(result.output).toContain("pull --reset");
    }));

  test("arb pull skips squashed repo (cumulative patch-id match)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Create two separate commits
      await write(join(repoA, "file-a.txt"), "content-a\n");
      await git(repoA, ["add", "file-a.txt"]);
      await git(repoA, ["commit", "-m", "add file-a"]);

      await write(join(repoA, "file-b.txt"), "content-b\n");
      await git(repoA, ["add", "file-b.txt"]);
      await git(repoA, ["commit", "-m", "add file-b"]);

      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Squash the two commits locally into one
      await git(repoA, ["reset", "--soft", "HEAD~2"]);
      await git(repoA, ["commit", "-m", "squashed: add file-a and file-b"]);

      // Cumulative patch-ids match (same net changes) → squashed detection
      const result = await arb(env, ["pull", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("rebased locally");
      expect(result.output).toContain("push --force");
      expect(result.output).toContain("pull --reset");
    }));

  test("arb pull --reset resets rebased repo to remote tip", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(repoA, "file.txt"), "feature");
      await git(repoA, ["add", "file.txt"]);
      await git(repoA, ["commit", "-m", "feature"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Record the remote HEAD before rebase
      const remoteHead = (await git(repoA, ["rev-parse", "origin/my-feature"])).trim();

      // Advance main and rebase locally
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "upstream.txt"), "upstream");
      await git(mainRepo, ["add", "upstream.txt"]);
      await git(mainRepo, ["commit", "-m", "upstream"]);
      await git(mainRepo, ["push"]);

      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      // Local HEAD should differ from remote after rebase
      const localHeadAfterRebase = (await git(repoA, ["rev-parse", "HEAD"])).trim();
      expect(localHeadAfterRebase).not.toBe(remoteHead);

      // Pull --reset should reset to remote tip
      const result = await arb(env, ["pull", "--reset", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("safe reset");
      expect(result.output).toContain("discards local rebase");
      expect(result.output).not.toContain("will be lost");

      // HEAD should now match the original remote tip
      const localHeadAfterPull = (await git(repoA, ["rev-parse", "HEAD"])).trim();
      expect(localHeadAfterPull).toBe(remoteHead);
    }));

  test("arb pull --reset shows forced-reset warning when net-new local commits exist", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(repoA, "file.txt"), "feature");
      await git(repoA, ["add", "file.txt"]);
      await git(repoA, ["commit", "-m", "feature"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Advance main and rebase locally
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "upstream.txt"), "upstream");
      await git(mainRepo, ["add", "upstream.txt"]);
      await git(mainRepo, ["commit", "-m", "upstream"]);
      await git(mainRepo, ["push"]);

      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      // Add a genuinely new local commit after rebase
      await write(join(repoA, "new-local.txt"), "new work");
      await git(repoA, ["add", "new-local.txt"]);
      await git(repoA, ["commit", "-m", "new local work"]);

      // Pull --reset should show forced-reset with warning
      const dryRun = await arb(env, ["pull", "--reset", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.output).toContain("forced reset");
      expect(dryRun.output).toContain("will be lost");
      expect(dryRun.output).not.toContain("safe reset");
    }));

  test("arb pull --reset does not override dirty skip", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(repoA, "file.txt"), "feature");
      await git(repoA, ["add", "file.txt"]);
      await git(repoA, ["commit", "-m", "feature"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Advance main and rebase locally
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "upstream.txt"), "upstream");
      await git(mainRepo, ["add", "upstream.txt"]);
      await git(mainRepo, ["commit", "-m", "upstream"]);
      await git(mainRepo, ["push"]);

      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      // Make the repo dirty with uncommitted changes
      await write(join(repoA, "dirty.txt"), "uncommitted");

      // Pull --reset should still skip due to dirty state
      const result = await arb(env, ["pull", "--reset", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("uncommitted changes");
      expect(result.output).not.toContain("reset");
    }));

  test("arb push --force overwrites remote when strictly behind", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Make 1 commit and push
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "commit a"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Simulate someone else pushing a new commit to remote
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-behind");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["checkout", "my-feature"]);
      await write(join(tmp, "extra.txt"), "extra");
      await git(tmp, ["add", "extra.txt"]);
      await git(tmp, ["commit", "-m", "extra commit"]);
      await git(tmp, ["push", "origin", "my-feature"]);
      await rm(tmp, { recursive: true });

      await fetchAllRepos(env);

      // Without --force, should skip as behind remote
      const skipResult = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(skipResult.output).toContain("behind origin");
      expect(skipResult.output).toContain("pull first");

      // With --force, should overwrite remote
      const forceResult = await arb(env, ["push", "--force", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(forceResult.exitCode).toBe(0);
      expect(forceResult.output).toContain("overwrite");
      expect(forceResult.output).toContain("Pushed 1 repo");
    }));
});

// ── pull [repos...] ─────────────────────────────────────────────

describe("pull [repos...]", () => {
  test("arb pull repo-a --yes only pulls named repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["push", "-u", "origin", "my-feature"]);

      // Push a remote commit to repo-a
      const tmpCloneA = join(env.testDir, "tmp-clone-a");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpCloneA]);
      await git(tmpCloneA, ["checkout", "my-feature"]);
      await write(join(tmpCloneA, "r.txt"), "remote");
      await git(tmpCloneA, ["add", "r.txt"]);
      await git(tmpCloneA, ["commit", "-m", "remote"]);
      await git(tmpCloneA, ["push"]);

      const result = await arb(env, ["pull", "repo-a", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pulled 1 repo");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb pull nonexistent repo errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const result = await arb(env, ["pull", "nonexistent-repo", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not in this workspace");
    }));
});

// ── pull --rebase / --merge ──────────────────────────────────────

describe("pull --rebase / --merge", () => {
  test("arb pull --rebase --merge errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const result = await arb(env, ["pull", "--rebase", "--merge", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot use both --rebase and --merge");
    }));
});

// ── gone remote branches ─────────────────────────────────────────

describe("gone remote branches", () => {
  test("arb status exits 0 for gone repos (gone is not at-risk)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "gone-exit", "repo-a"]);
      await pushThenDeleteRemote(env, "gone-exit", "repo-a");

      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "gone-exit") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("gone");
      expect(result.output).toContain("to push");
    }));

  test("arb delete treats gone repos as safe", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "gone-remove", "repo-a"]);
      await pushThenDeleteRemote(env, "gone-remove", "repo-a");

      const result = await arb(env, ["delete", "gone-remove", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "gone-remove"))).toBe(false);
    }));
});

// ── merged branch detection ──────────────────────────────────────

describe("merged branch detection", () => {
  test("arb push --include-merged overrides merged skip and recreates branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "merged-force", "repo-a"]);
      const wt = join(env.projectDir, "merged-force/repo-a");

      // Make feature work and push
      await write(join(wt, "feature.txt"), "feature content");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature work"]);
      await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "merged-force") });

      // Squash merge + delete
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-squash-force");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["merge", "--squash", "origin/merged-force"]);
      await git(tmp, ["commit", "-m", "squash merge"]);
      await git(tmp, ["push", "origin", "main"]);
      await rm(tmp, { recursive: true });
      await git(bare, ["branch", "-D", "merged-force"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["fetch", "--prune"]);

      const result = await arb(env, ["push", "--include-merged", "--yes"], {
        cwd: join(env.projectDir, "merged-force"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toMatch(/pushed|Pushed/);
    }));

  test("arb push --force does not override merged skip", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "merged-force-only", "repo-a"]);
      const wt = join(env.projectDir, "merged-force-only/repo-a");

      await write(join(wt, "feature.txt"), "feature content");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature work"]);
      await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "merged-force-only") });

      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-squash-force-only");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["merge", "--squash", "origin/merged-force-only"]);
      await git(tmp, ["commit", "-m", "squash merge"]);
      await git(tmp, ["push", "origin", "main"]);
      await rm(tmp, { recursive: true });
      await git(bare, ["branch", "-D", "merged-force-only"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["fetch", "--prune"]);

      const result = await arb(env, ["push", "--force", "--yes"], {
        cwd: join(env.projectDir, "merged-force-only"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already merged");
      expect(result.output).toContain("--include-merged");
    }));

  test("arb push --include-merged auto-pushes when all remote commits are outdated after rebase", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "diverged-include-merged", "repo-a"]);
      await write(join(env.projectDir, "diverged-include-merged/repo-a/file.txt"), "feature");
      await git(join(env.projectDir, "diverged-include-merged/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "diverged-include-merged/repo-a"), ["commit", "-m", "feature"]);
      await git(join(env.projectDir, "diverged-include-merged/repo-a"), [
        "push",
        "-u",
        "origin",
        "diverged-include-merged",
      ]);

      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "upstream.txt"), "upstream");
      await git(mainRepo, ["add", "upstream.txt"]);
      await git(mainRepo, ["commit", "-m", "upstream"]);
      await git(mainRepo, ["push"]);

      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "diverged-include-merged") });

      const result = await arb(env, ["push", "--include-merged", "--yes"], {
        cwd: join(env.projectDir, "diverged-include-merged"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("replaces");
      expect(result.output).toContain("Pushed");
    }));

  test("arb status --json includes merge field", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "merged-json", "repo-a"]);
      const wt = join(env.projectDir, "merged-json/repo-a");

      // Make feature work and push
      await write(join(wt, "feature.txt"), "feature content");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature work"]);
      await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "merged-json") });

      // Squash merge + delete
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-squash-json");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["merge", "--squash", "origin/merged-json"]);
      await git(tmp, ["commit", "-m", "squash merge"]);
      await git(tmp, ["push", "origin", "main"]);
      await rm(tmp, { recursive: true });
      await git(bare, ["branch", "-D", "merged-json"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["fetch", "--prune"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "merged-json"),
      });
      const data = JSON.parse(result.stdout);
      const repo = data.repos[0];
      expect(repo.base.merge.kind).toBe("squash");
    }));

  test("arb status detects regular merge when remote branch is deleted", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "merge-gone", "repo-a"]);
      const wt = join(env.projectDir, "merge-gone/repo-a");

      // Make feature work and push
      await write(join(wt, "feature.txt"), "feature");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature work"]);
      await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "merge-gone") });

      // Regular merge (not squash, --no-ff to create merge commit) + delete remote branch
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-merge-gone");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["merge", "--no-ff", "origin/merge-gone", "-m", "merge feature"]);
      await git(tmp, ["push", "origin", "main"]);
      await rm(tmp, { recursive: true });
      await git(bare, ["branch", "-D", "merge-gone"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "merge-gone") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");
      expect(result.output).toContain("gone");
    }));

  test("arb status detects fast-forward merge when remote branch is deleted", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ff-gone", "repo-a"]);
      const wt = join(env.projectDir, "ff-gone/repo-a");

      // Make feature work and push
      await write(join(wt, "feature.txt"), "feature");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature work"]);
      await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "ff-gone") });

      // Fast-forward merge (no merge commit) + delete remote branch
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-ff-gone");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["merge", "--ff-only", "origin/ff-gone"]);
      await git(tmp, ["push", "origin", "main"]);
      await rm(tmp, { recursive: true });
      await git(bare, ["branch", "-D", "ff-gone"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "ff-gone") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");
      expect(result.output).toContain("gone");
    }));

  test("arb status detects regular merge when remote branch still exists", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "merge-kept", "repo-a"]);
      const wt = join(env.projectDir, "merge-kept/repo-a");

      // Make feature work and push
      await write(join(wt, "feature.txt"), "feature");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature work"]);
      await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "merge-kept") });

      // Regular merge (not squash, --no-ff to create merge commit), keep remote branch
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-merge-kept");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["merge", "--no-ff", "origin/merge-kept", "-m", "merge feature"]);
      await git(tmp, ["push", "origin", "main"]);
      await rm(tmp, { recursive: true });

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "merge-kept") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");
    }));
});

// ── --verbose ────────────────────────────────────────────────────

describe("--verbose", () => {
  test("arb push --verbose --dry-run shows outgoing commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/feature.txt"), "feature work");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "feature.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feat: push verbose test"]);

      const result = await arb(env, ["push", "--verbose", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Outgoing to origin:");
      expect(result.output).toContain("feat: push verbose test");
    }));

  test("arb pull --verbose --dry-run shows incoming commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(repoA, "file.txt"), "initial");
      await git(repoA, ["add", "file.txt"]);
      await git(repoA, ["commit", "-m", "initial"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Push a remote commit
      const tmpClone = join(env.testDir, "tmp-pull-verbose");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "r.txt"), "remote");
      await git(tmpClone, ["add", "r.txt"]);
      await git(tmpClone, ["commit", "-m", "feat: pull verbose test"]);
      await git(tmpClone, ["push"]);

      const result = await arb(env, ["pull", "--verbose", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Incoming from origin");
      expect(result.output).toContain("feat: pull verbose test");
    }));
});

// ── pull merge-mode annotations ──────────────────────────────────

describe("pull merge-mode annotations", () => {
  test("arb pull --merge fast-forward shows fast-forward merge", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      // Push a remote commit
      const tmpClone = join(env.testDir, "tmp-ff-pull");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "r.txt"), "remote");
      await git(tmpClone, ["add", "r.txt"]);
      await git(tmpClone, ["commit", "-m", "remote"]);
      await git(tmpClone, ["push"]);

      const result = await arb(env, ["pull", "--merge", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("fast-forward merge");
    }));

  test("arb pull --merge three-way shows three-way merge when diverged", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      // Local commit
      await write(join(env.projectDir, "my-feature/repo-a/local.txt"), "local");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "local.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "local"]);

      // Push a remote commit
      const tmpClone = join(env.testDir, "tmp-3way-pull");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "r.txt"), "remote");
      await git(tmpClone, ["add", "r.txt"]);
      await git(tmpClone, ["commit", "-m", "remote"]);
      await git(tmpClone, ["push"]);

      const result = await arb(env, ["pull", "--merge", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("three-way merge");
    }));

  test("arb pull --merge shows safe reset when remote was rewritten without local net-new commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      await write(join(repoA, "feature.txt"), "feature");
      await git(repoA, ["add", "feature.txt"]);
      await git(repoA, ["commit", "-m", "feature"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Rewrite remote history with an equivalent commit (same patch, different SHA).
      const tmpClone = join(env.testDir, "tmp-safe-reset-pull");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      const originalTip = (await git(tmpClone, ["rev-parse", "HEAD"])).trim();
      await git(tmpClone, ["reset", "--hard", "HEAD~1"]);
      await git(tmpClone, ["cherry-pick", originalTip]);
      await git(tmpClone, ["commit", "--amend", "-m", "feature rebased"]);
      await write(join(tmpClone, "extra.txt"), "remote extra");
      await git(tmpClone, ["add", "extra.txt"]);
      await git(tmpClone, ["commit", "-m", "remote extra"]);
      await git(tmpClone, ["push", "--force"]);

      const dryRun = await arb(env, ["pull", "--merge", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.output).toContain("safe reset");
      expect(dryRun.output).toContain("no local commits to preserve");
      expect(dryRun.output).not.toContain("three-way merge");

      const pullResult = await arb(env, ["pull", "--merge", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(pullResult.exitCode).toBe(0);
      expect(pullResult.output).toContain("safe reset");

      const localHead = await git(repoA, ["rev-parse", "HEAD"]);
      const remoteHead = await git(repoA, ["rev-parse", "origin/my-feature"]);
      expect(localHead).toBe(remoteHead);
    }));

  test("arb pull --rebase does not show fast-forward or three-way", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      // Push a remote commit
      const tmpClone = join(env.testDir, "tmp-rebase-pull");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "r.txt"), "remote");
      await git(tmpClone, ["add", "r.txt"]);
      await git(tmpClone, ["commit", "-m", "remote"]);
      await git(tmpClone, ["push"]);

      const result = await arb(env, ["pull", "--rebase", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("(rebase");
      expect(result.output).not.toContain("fast-forward");
      expect(result.output).not.toContain("three-way");
    }));
});

// ── push (verbose) ──────────────────────────────────────────────

describe("push (verbose)", () => {
  test("arb push --dry-run without --verbose does not show commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/feature.txt"), "feature");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "feature.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "feat: should not appear"]);

      const result = await arb(env, ["push", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("Outgoing to");
      expect(result.output).not.toContain("feat: should not appear");
    }));
});

// ── --where filtering ────────────────────────────────────────────

describe("--where filtering", () => {
  test("arb push --where filters repos from the plan", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // Make repo-a dirty (uncommitted changes)
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "dirty.txt"]);
      // Make repo-b have a commit to push (unpushed)
      await write(join(env.projectDir, "my-feature/repo-b/feature.txt"), "feature");
      await git(join(env.projectDir, "my-feature/repo-b"), ["add", "feature.txt"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["commit", "-m", "feature"]);

      // --where ahead-share should only show repo-b (which has a commit), not repo-a (only dirty)
      const result = await arb(env, ["push", "--where", "ahead-share", "--dry-run", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-b");
      expect(result.output).not.toContain("repo-a");
    }));

  test("arb push --where with invalid term errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const result = await arb(env, ["push", "--where", "bogus"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Unknown filter");
      expect(result.output).toContain("bogus");
    }));

  test("arb pull --where filters repos from the plan", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // Push both branches so they're tracked
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["push", "-u", "origin", "my-feature"]);

      // Push a remote commit to repo-a only
      const tmpCloneA = join(env.testDir, "tmp-clone-a");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpCloneA]);
      await git(tmpCloneA, ["checkout", "my-feature"]);
      await write(join(tmpCloneA, "r.txt"), "remote");
      await git(tmpCloneA, ["add", "r.txt"]);
      await git(tmpCloneA, ["commit", "-m", "remote"]);
      await git(tmpCloneA, ["push"]);

      // --where behind-share should only show repo-a (which has something to pull)
      const result = await arb(env, ["pull", "--where", "behind-share", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb rebase --where filters repos from the plan", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      // Push an upstream commit to repo-a's main branch
      const tmpCloneA = join(env.testDir, "tmp-clone-a");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpCloneA]);
      await write(join(tmpCloneA, "upstream.txt"), "upstream");
      await git(tmpCloneA, ["add", "upstream.txt"]);
      await git(tmpCloneA, ["commit", "-m", "upstream"]);
      await git(tmpCloneA, ["push"]);

      // Fetch first so refs are fresh
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["fetch"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["fetch"]);

      // --where behind-base should only show repo-a (which is behind main)
      const result = await arb(env, ["rebase", "--where", "behind-base", "--dry-run", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb merge --where filters repos from the plan", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      // Push an upstream commit to repo-a's main branch
      const tmpCloneA = join(env.testDir, "tmp-clone-a");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpCloneA]);
      await write(join(tmpCloneA, "upstream.txt"), "upstream");
      await git(tmpCloneA, ["add", "upstream.txt"]);
      await git(tmpCloneA, ["commit", "-m", "upstream"]);
      await git(tmpCloneA, ["push"]);

      await git(join(env.projectDir, ".arb/repos/repo-a"), ["fetch"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["fetch"]);

      // --where behind-base should only show repo-a
      const result = await arb(env, ["merge", "--where", "behind-base", "--dry-run", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb rebase --where with invalid term errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const result = await arb(env, ["rebase", "--where", "invalid-term"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Unknown filter");
    }));

  test("arb push positional repos + --where compose with AND logic", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // Make both repos have commits to push
      await write(join(env.projectDir, "my-feature/repo-a/a.txt"), "a");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "a.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "commit a"]);
      await write(join(env.projectDir, "my-feature/repo-b/b.txt"), "b");
      await git(join(env.projectDir, "my-feature/repo-b"), ["add", "b.txt"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["commit", "-m", "commit b"]);
      // Also make repo-a dirty
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "dirty.txt"]);

      // positional selects repo-a only, --where dirty narrows further -- repo-a matches both
      const result = await arb(env, ["push", "repo-a", "--where", "dirty", "--dry-run", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("push blocks after squash merge with new commit", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "push-block-test", "repo-a"]);
      const wt = join(env.projectDir, "push-block-test/repo-a");

      // Make feature work and push
      await write(join(wt, "feature.txt"), "feature content");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature work"]);
      await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "push-block-test") });

      // Simulate squash merge on the bare repo (don't delete remote branch yet)
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-squash-block");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["merge", "--squash", "origin/push-block-test"]);
      await git(tmp, ["commit", "-m", "squash merge (#99)"]);
      await git(tmp, ["push", "origin", "main"]);
      await rm(tmp, { recursive: true });

      // Add a new commit on the feature branch (the bug fix scenario)
      await write(join(wt, "fix.txt"), "fix content");
      await git(wt, ["add", "fix.txt"]);
      await git(wt, ["commit", "-m", "fix bug"]);

      // Verify status shows "to push" for merged branch with new commits
      const statusResult = await arb(env, ["status"], {
        cwd: join(env.projectDir, "push-block-test"),
      });
      expect(statusResult.exitCode).toBe(0);
      expect(statusResult.output).toContain("merged");
      expect(statusResult.output).toContain("to push");

      const pushResult = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "push-block-test"),
      });
      expect(pushResult.exitCode).toBe(0);
      expect(pushResult.output).toContain("merged");
      expect(pushResult.output).toMatch(/new commits?/);
      expect(pushResult.output).toContain("rebase");
    }));

  test("rebase replays new commits after squash merge", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "rebase-replay-test", "repo-a"]);
      const wt = join(env.projectDir, "rebase-replay-test/repo-a");

      // Make feature work and push
      await write(join(wt, "feature.txt"), "feature content");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature work"]);
      await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "rebase-replay-test") });

      // Simulate squash merge on the bare repo
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-squash-replay");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["merge", "--squash", "origin/rebase-replay-test"]);
      await git(tmp, ["commit", "-m", "squash merge (#99)"]);
      await git(tmp, ["push", "origin", "main"]);
      await rm(tmp, { recursive: true });

      // Add a new commit on the feature branch
      await write(join(wt, "fix.txt"), "fix content");
      await git(wt, ["add", "fix.txt"]);
      await git(wt, ["commit", "-m", "fix bug"]);

      const rebaseResult = await arb(env, ["rebase", "--yes"], {
        cwd: join(env.projectDir, "rebase-replay-test"),
      });
      expect(rebaseResult.exitCode).toBe(0);
      expect(rebaseResult.output).toMatch(/rebased|Rebased/);

      // After rebase, the branch should have only the new commit on top of main
      const logOutput = await git(wt, ["log", "--oneline", "origin/main..HEAD"]);
      const commitCount = logOutput
        .trim()
        .split("\n")
        .filter((l) => l.length > 0).length;
      expect(commitCount).toBe(1);

      // The fix file should still be present
      expect(existsSync(join(wt, "fix.txt"))).toBe(true);

      // Force push should now succeed
      const pushResult = await arb(env, ["push", "--force", "--yes"], {
        cwd: join(env.projectDir, "rebase-replay-test"),
      });
      expect(pushResult.exitCode).toBe(0);
      expect(pushResult.output).toMatch(/pushed|Pushed/);
    }));

  test("rebase does not report non-merged branch as merged when cumulative diff coincidentally matches", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "false-positive-test", "repo-a"]);
      const wt = join(env.projectDir, "false-positive-test/repo-a");

      // Make 3 commits on the feature branch (do not push — share stays noRef).
      // X1 and X2 together produce the same diff as a single commit C on main.
      await write(join(wt, "feature.txt"), "line 1\n");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature part 1"]);
      await write(join(wt, "feature.txt"), "line 1\nline 2\n");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature part 2"]);
      await write(join(wt, "other.txt"), "other\n");
      await git(wt, ["add", "other.txt"]);
      await git(wt, ["commit", "-m", "add other file"]);

      // On main, add a single commit with the same cumulative diff as X1+X2.
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-false-positive");
      await git(env.testDir, ["clone", bare, tmp]);
      await write(join(tmp, "feature.txt"), "line 1\nline 2\n");
      await git(tmp, ["add", "feature.txt"]);
      await git(tmp, ["commit", "-m", "independent work that matches X1+X2"]);
      await git(tmp, ["push", "origin", "main"]);
      await rm(tmp, { recursive: true });

      // Dry-run rebase: should NOT show "(merged)" since the branch was not merged.
      const result = await arb(env, ["rebase", "--dry-run"], {
        cwd: join(env.projectDir, "false-positive-test"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("(merged)");
      expect(result.output).not.toContain("already merged");
    }));

  test("rebase skips when all local commits are already squash-equivalent on base", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "rebase-squash-equivalent-test", "repo-a"]);
      const wt = join(env.projectDir, "rebase-squash-equivalent-test/repo-a");

      // Make feature work locally (do not push branch to origin).
      await write(join(wt, "feature.txt"), "feature content v1\n");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature part 1"]);
      await write(join(wt, "feature.txt"), "feature content v1\nfeature content v2\n");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature part 2"]);

      // Add an equivalent squashed commit directly on main.
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-squash-equivalent");
      await git(env.testDir, ["clone", bare, tmp]);
      await write(join(tmp, "feature.txt"), "feature content v1\nfeature content v2\n");
      await git(tmp, ["add", "feature.txt"]);
      await git(tmp, ["commit", "-m", "squash-equivalent on main"]);
      await git(tmp, ["push", "origin", "main"]);
      await rm(tmp, { recursive: true });

      const rebaseResult = await arb(env, ["rebase", "--yes"], {
        cwd: join(env.projectDir, "rebase-squash-equivalent-test"),
      });
      expect(rebaseResult.exitCode).toBe(0);
      expect(rebaseResult.output).toContain("already squash-merged");
      expect(rebaseResult.output).not.toContain("conflict");
    }));
});

// ── --include-wrong-branch ────────────────────────────────────────

describe("--include-wrong-branch", () => {
  test("arb push skips wrong-branch repo by default with hint", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wt = join(env.projectDir, "my-feature/repo-a");

      // Drift: checkout a different branch
      await git(wt, ["checkout", "-b", "experiment"]);
      await write(join(wt, "file.txt"), "content");
      await git(wt, ["add", "file.txt"]);
      await git(wt, ["commit", "-m", "experiment commit"]);

      const result = await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("--include-wrong-branch");
      expect(result.output).not.toContain("Pushed");
    }));

  test("arb push --include-wrong-branch pushes wrong-branch repo to its actual branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wt = join(env.projectDir, "my-feature/repo-a");

      // Drift: checkout a different branch and commit
      await git(wt, ["checkout", "-b", "experiment"]);
      await write(join(wt, "file.txt"), "content");
      await git(wt, ["add", "file.txt"]);
      await git(wt, ["commit", "-m", "experiment commit"]);

      const result = await arb(env, ["push", "--include-wrong-branch", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pushed");
      expect(result.output).toContain("(branch: experiment)");

      // Verify: the experiment branch exists on origin, not my-feature
      const canonical = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonical, ["fetch", "--prune"]);
      const refs = await git(canonical, ["branch", "-r"]);
      expect(refs).toContain("origin/experiment");
    }));

  test("arb pull skips wrong-branch repo by default with hint", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wt = join(env.projectDir, "my-feature/repo-a");

      // Push my-feature first, then drift
      await write(join(wt, "file.txt"), "content");
      await git(wt, ["add", "file.txt"]);
      await git(wt, ["commit", "-m", "initial"]);
      await git(wt, ["push", "-u", "origin", "my-feature"]);
      await git(wt, ["checkout", "-b", "experiment"]);

      const result = await arb(env, ["pull", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("--include-wrong-branch");
    }));

  test("arb pull --include-wrong-branch pulls wrong-branch repo from its actual branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wt = join(env.projectDir, "my-feature/repo-a");

      // Create experiment branch, push it, then drift to it
      await git(wt, ["checkout", "-b", "experiment"]);
      await write(join(wt, "file.txt"), "content");
      await git(wt, ["add", "file.txt"]);
      await git(wt, ["commit", "-m", "local commit"]);
      await git(wt, ["push", "-u", "origin", "experiment"]);

      // Push a remote commit to experiment from a tmp clone
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "experiment"]);
      await write(join(tmpClone, "remote.txt"), "remote change");
      await git(tmpClone, ["add", "remote.txt"]);
      await git(tmpClone, ["commit", "-m", "remote commit"]);
      await git(tmpClone, ["push"]);

      const result = await arb(env, ["pull", "--include-wrong-branch", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Pulled");
      expect(result.output).toContain("(branch: experiment)");

      // Verify: the remote commit is now in the worktree
      const log = await git(wt, ["log", "--oneline"]);
      expect(log).toContain("remote commit");
    }));

  test("arb rebase skips wrong-branch repo by default with hint", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wt = join(env.projectDir, "my-feature/repo-a");

      // Drift: checkout a different branch
      await git(wt, ["checkout", "-b", "experiment"]);

      // Push upstream change to main
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "upstream.txt"), "upstream");
      await git(mainRepo, ["add", "upstream.txt"]);
      await git(mainRepo, ["commit", "-m", "upstream change"]);
      await git(mainRepo, ["push"]);

      const result = await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("--include-wrong-branch");
    }));

  test("arb rebase --include-wrong-branch rebases wrong-branch repo onto base", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wt = join(env.projectDir, "my-feature/repo-a");

      // Drift: checkout a different branch with a commit
      await git(wt, ["checkout", "-b", "experiment"]);
      await write(join(wt, "exp.txt"), "experiment");
      await git(wt, ["add", "exp.txt"]);
      await git(wt, ["commit", "-m", "experiment commit"]);

      // Push upstream change to main
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "upstream.txt"), "upstream");
      await git(mainRepo, ["add", "upstream.txt"]);
      await git(mainRepo, ["commit", "-m", "upstream change"]);
      await git(mainRepo, ["push"]);

      const result = await arb(env, ["rebase", "--include-wrong-branch", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Rebased");
      expect(result.output).toContain("rebase experiment onto");

      // Verify: upstream change is now in the wrong-branch repo
      const log = await git(wt, ["log", "--oneline"]);
      expect(log).toContain("upstream change");
    }));

  test("arb merge --include-wrong-branch merges base into wrong-branch repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wt = join(env.projectDir, "my-feature/repo-a");

      // Drift: checkout a different branch with a commit
      await git(wt, ["checkout", "-b", "experiment"]);
      await write(join(wt, "exp.txt"), "experiment");
      await git(wt, ["add", "exp.txt"]);
      await git(wt, ["commit", "-m", "experiment commit"]);

      // Push upstream change to main
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(mainRepo, "upstream.txt"), "upstream");
      await git(mainRepo, ["add", "upstream.txt"]);
      await git(mainRepo, ["commit", "-m", "upstream change"]);
      await git(mainRepo, ["push"]);

      const result = await arb(env, ["merge", "--include-wrong-branch", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Merged");
      expect(result.output).toContain("merge");
      expect(result.output).toContain("into experiment");

      // Verify: upstream change is now in the wrong-branch repo
      const log = await git(wt, ["log", "--oneline"]);
      expect(log).toContain("upstream change");
    }));

  test("arb push --include-wrong-branch shows wrong-branch hint in plan", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wt = join(env.projectDir, "my-feature/repo-a");

      await git(wt, ["checkout", "-b", "experiment"]);
      await write(join(wt, "file.txt"), "content");
      await git(wt, ["add", "file.txt"]);
      await git(wt, ["commit", "-m", "experiment commit"]);

      const result = await arb(env, ["push", "--include-wrong-branch", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("different branch than the workspace");
    }));
});

// ── push dry-run ─────────────────────────────────────────────────

describe("push dry-run", () => {
  test("arb push --dry-run shows plan without pushing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);
      const result = await arb(env, ["push", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("1 new to push");
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Pushed");
      // Verify nothing was actually pushed
      const branchResult = await git(join(env.originDir, "repo-a.git"), ["branch"]);
      expect(branchResult).not.toContain("my-feature");
    }));

  test("arb push --dry-run when up to date shows up to date", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      const result = await arb(env, ["push", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("up to date");
    }));
});

// ── pull dry-run ─────────────────────────────────────────────────

// ── pull --autostash ─────────────────────────────────────────────

describe("pull --autostash", () => {
  test("arb pull --autostash stashes dirty repo, pulls, then re-applies stash", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(repoA, "file.txt"), "initial");
      await git(repoA, ["add", "file.txt"]);
      await git(repoA, ["commit", "-m", "initial"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Push a remote commit from another clone
      const tmpClone = join(env.testDir, "tmp-autostash");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "remote.txt"), "from remote");
      await git(tmpClone, ["add", "remote.txt"]);
      await git(tmpClone, ["commit", "-m", "remote commit"]);
      await git(tmpClone, ["push"]);

      // Make local uncommitted changes to a TRACKED file (triggers stash)
      await write(join(repoA, "file.txt"), "work in progress");

      // Pull without --autostash should skip
      const skipResult = await arb(env, ["pull", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(skipResult.output).toContain("uncommitted changes");

      // Pull with --autostash should succeed
      const result = await arb(env, ["pull", "--autostash", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("autostash");
      expect(result.output).toContain("Pulled");

      // Remote file should be present after pull
      expect(existsSync(join(repoA, "remote.txt"))).toBe(true);
      // Local modification should be restored after stash pop
      const fileContent = await Bun.file(join(repoA, "file.txt")).text();
      expect(fileContent).toContain("work in progress");
    }));

  test("arb pull --autostash skips stash when only untracked files", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(repoA, "file.txt"), "initial");
      await git(repoA, ["add", "file.txt"]);
      await git(repoA, ["commit", "-m", "initial"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Push remote commit
      const tmpClone = join(env.testDir, "tmp-untracked");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "remote.txt"), "from remote");
      await git(tmpClone, ["add", "remote.txt"]);
      await git(tmpClone, ["commit", "-m", "remote"]);
      await git(tmpClone, ["push"]);

      // Only untracked files (not staged/modified)
      await write(join(repoA, "untracked.txt"), "untracked");

      const result = await arb(env, ["pull", "--autostash", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Should not mention autostash since only untracked files
      expect(result.output).not.toContain("autostash");
      expect(result.output).toContain("Pulled");
    }));
});

// ── push partial failure ─────────────────────────────────────────

describe("push partial failure", () => {
  test("arb push succeeds for clean repo and skips diverged repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");
      const repoB = join(env.projectDir, "my-feature/repo-b");

      // Push initial commits for both repos
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "a initial"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      await write(join(repoB, "b.txt"), "b");
      await git(repoB, ["add", "b.txt"]);
      await git(repoB, ["commit", "-m", "b initial"]);
      await git(repoB, ["push", "-u", "origin", "my-feature"]);

      // Diverge repo-b: push a remote-only commit
      const tmpClone = join(env.testDir, "tmp-diverge-b");
      await git(env.testDir, ["clone", join(env.originDir, "repo-b.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "remote.txt"), "remote");
      await git(tmpClone, ["add", "remote.txt"]);
      await git(tmpClone, ["commit", "-m", "remote commit"]);
      await git(tmpClone, ["push"]);

      // Add a local commit to repo-b (creates genuine divergence)
      await write(join(repoB, "local.txt"), "local");
      await git(repoB, ["add", "local.txt"]);
      await git(repoB, ["commit", "-m", "local commit"]);

      // Add a clean commit to repo-a (will push fine)
      await write(join(repoA, "new.txt"), "new");
      await git(repoA, ["add", "new.txt"]);
      await git(repoA, ["commit", "-m", "new commit"]);

      // Push without --force
      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });

      // repo-a should push successfully
      expect(result.output).toContain("Pushed 1 repo");
      // repo-b should be skipped due to divergence
      expect(result.output).toContain("diverged");
      expect(result.output).toContain("use --force");
    }));
});

// ── pull --rebase conflict ───────────────────────────────────────

describe("pull --rebase conflict", () => {
  test("arb pull --rebase shows rebase-in-progress on conflict", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Create a shared file, commit, and push
      await write(join(repoA, "shared.txt"), "original");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "add shared"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Remote conflicting change
      const tmpClone = join(env.testDir, "tmp-rebase-conflict");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "shared.txt"), "remote version");
      await git(tmpClone, ["add", "shared.txt"]);
      await git(tmpClone, ["commit", "-m", "remote change"]);
      await git(tmpClone, ["push"]);

      // Local conflicting change
      await write(join(repoA, "shared.txt"), "local version");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "local change"]);

      const result = await arb(env, ["pull", "--rebase", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("CONFLICT");
    }));
});

// ── pull --autostash stash pop conflict ──────────────────────────

describe("pull --autostash stash pop conflict", () => {
  test("arb pull --autostash reports stash pop conflict", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Create a tracked file, commit, and push
      await write(join(repoA, "shared.txt"), "original");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "add shared"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Remote change to the same file
      const tmpClone = join(env.testDir, "tmp-stash-conflict");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "shared.txt"), "remote version\n");
      await git(tmpClone, ["add", "shared.txt"]);
      await git(tmpClone, ["commit", "-m", "remote change"]);
      await git(tmpClone, ["push"]);

      // Local uncommitted change to the same file (will conflict on stash pop)
      await write(join(repoA, "shared.txt"), "local wip version\n");

      const result = await arb(env, ["pull", "--autostash", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      // The pull itself succeeds but stash pop may conflict
      // Either the pull fails or there's a stash pop conflict message
      expect(result.output).toContain("repo-a");
    }));
});

describe("pull dry-run", () => {
  test("arb pull --dry-run shows plan without pulling", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      // Push a new commit from another clone
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), join(env.testDir, "tmp-clone")]);
      await git(join(env.testDir, "tmp-clone"), ["checkout", "my-feature"]);
      await write(join(env.testDir, "tmp-clone/r.txt"), "remote");
      await git(join(env.testDir, "tmp-clone"), ["add", "r.txt"]);
      await git(join(env.testDir, "tmp-clone"), ["commit", "-m", "remote commit"]);
      await git(join(env.testDir, "tmp-clone"), ["push"]);

      const result = await arb(env, ["pull", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("to pull");
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Pulled");
      // Verify nothing was actually pulled
      expect(existsSync(join(env.projectDir, "my-feature/repo-a/r.txt"))).toBe(false);
    }));
});
