import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, withEnv } from "./helpers/env";

// ── basic rename ──────────────────────────────────────────────────

describe("basic rename", () => {
  test("arb branch rename renames branch in all repos and updates config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Config updated
      const config = await readFile(join(env.projectDir, "my-feature/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("feat/new-name");
      // branch_rename_from cleared on success
      expect(JSON.parse(config).branch_rename_from).toBeUndefined();
      // Both repos on new branch
      const branchA = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      const branchB = (
        await git(join(env.projectDir, "my-feature/repo-b"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("feat/new-name");
      expect(branchB).toBe("feat/new-name");
    }));

  test("arb branch rename shows renamed repos in output", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Renamed");
    }));

  test("arb branch rename preserves base in config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const config = await readFile(join(env.projectDir, "my-feature/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).base).toBe("main");
    }));
});

// ── no-op guard ───────────────────────────────────────────────────

describe("no-op guard", () => {
  test("arb branch rename same-name is a no-op", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "rename", "my-feature", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("nothing to do");
    }));
});

// ── validation ────────────────────────────────────────────────────

describe("validation", () => {
  test("arb branch rename rejects invalid branch name", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "rename", "invalid..name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Invalid branch name");
    }));

  test("arb branch rename outside workspace fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["branch", "rename", "feat/new-name"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not inside a workspace");
    }));

  test("arb branch rename without new-name arg fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "rename", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("required");
    }));
});

// ── dry-run ───────────────────────────────────────────────────────

describe("dry-run", () => {
  test("arb branch rename --dry-run shows plan without changes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["branch", "rename", "feat/new-name", "--dry-run", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Dry run");
      // Config not changed
      const config = await readFile(join(env.projectDir, "my-feature/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("my-feature");
      // Branch not renamed
      const branchA = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("my-feature");
    }));
});

// ── already-on-new ────────────────────────────────────────────────

describe("already-on-new", () => {
  test("arb branch rename skips repos already on new branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // Manually rename repo-a to the target branch
      await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "feat/new-name"]);
      const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // repo-b should be renamed, repo-a was already there
      const branchA = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      const branchB = (
        await git(join(env.projectDir, "my-feature/repo-b"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("feat/new-name");
      expect(branchB).toBe("feat/new-name");
      expect(result.output).toContain("already renamed");
    }));
});

// ── skip-missing ─────────────────────────────────────────────────

describe("skip-missing", () => {
  test("arb branch rename skips repos where old branch is absent", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // Manually switch repo-b to a different branch so the expected branch is gone
      await git(join(env.projectDir, "my-feature/repo-b"), ["checkout", "-b", "other-branch"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["branch", "-D", "my-feature"]);
      const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // repo-a renamed, repo-b skipped
      const branchA = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("feat/new-name");
      expect(result.output).toContain("skip");
    }));
});

// ── skip-in-progress ─────────────────────────────────────────────

describe("skip-in-progress", () => {
  test("arb branch rename skips repos with in-progress git operation", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // Workspace repos are linked worktrees — .git is a file, not a directory.
      // Use git rev-parse --git-dir to find the actual git dir for this worktree.
      const wtA = join(env.projectDir, "my-feature/repo-a");
      let gitDir = (await git(wtA, ["rev-parse", "--git-dir"])).trim();
      if (!gitDir.startsWith("/")) {
        gitDir = join(wtA, gitDir);
      }
      await writeFile(join(gitDir, "MERGE_HEAD"), "");

      const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // repo-a skipped, repo-b renamed
      const branchA = (await git(wtA, ["symbolic-ref", "--short", "HEAD"])).trim();
      const branchB = (
        await git(join(env.projectDir, "my-feature/repo-b"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("my-feature");
      expect(branchB).toBe("feat/new-name");
      expect(result.output).toContain("in progress");
      const { rm } = await import("node:fs/promises");
      await rm(join(gitDir, "MERGE_HEAD"), { force: true });
    }));

  test("arb branch rename --include-in-progress renames repos with in-progress operations", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const wtA = join(env.projectDir, "my-feature/repo-a");
      let gitDir = (await git(wtA, ["rev-parse", "--git-dir"])).trim();
      if (!gitDir.startsWith("/")) {
        gitDir = join(wtA, gitDir);
      }
      await writeFile(join(gitDir, "MERGE_HEAD"), "");

      const result = await arb(
        env,
        ["branch", "rename", "feat/new-name", "--yes", "--no-fetch", "--include-in-progress"],
        {
          cwd: join(env.projectDir, "my-feature"),
        },
      );
      expect(result.exitCode).toBe(0);
      // Both repos renamed despite in-progress op in repo-a
      const branchA = (await git(wtA, ["symbolic-ref", "--short", "HEAD"])).trim();
      const branchB = (
        await git(join(env.projectDir, "my-feature/repo-b"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("feat/new-name");
      expect(branchB).toBe("feat/new-name");
      const { rm } = await import("node:fs/promises");
      await rm(join(gitDir, "MERGE_HEAD"), { force: true });
    }));
});

// ── operation-based continue ─────────────────────────────────────
// Branch rename uses .arbws/operation.json for in-progress state.
// Re-running 'arb branch rename --continue' continues a partial rename.
// 'arb undo' or 'arb branch rename --abort' rolls back.

describe("operation continue", () => {
  test("arb branch rename --continue resumes partial rename", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause failure in repo-a by creating blocking branch
      await git(repoA, ["branch", "feat/new-name"]);
      const r1 = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });
      expect(r1.exitCode).not.toBe(0);

      // Fix and continue with --continue
      await git(repoA, ["branch", "-D", "feat/new-name"]);
      const r2 = await arb(env, ["branch", "rename", "--continue", "--yes", "--no-fetch"], { cwd: ws });
      expect(r2.exitCode).toBe(0);

      // Both repos on new branch
      const branchA = (await git(repoA, ["symbolic-ref", "--short", "HEAD"])).trim();
      const branchB = (await git(join(ws, "repo-b"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("feat/new-name");
      expect(branchB).toBe("feat/new-name");
    }));

  test("arb undo rolls back partial rename", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause failure in repo-a
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Undo
      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // repo-b rolled back, repo-a unchanged (rename didn't complete)
      const branchA = (await git(repoA, ["symbolic-ref", "--short", "HEAD"])).trim();
      const branchB = (await git(join(ws, "repo-b"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("my-feature");
      expect(branchB).toBe("my-feature");

      // Config restored
      const config = JSON.parse(await readFile(join(ws, ".arbws/config.json"), "utf8"));
      expect(config.branch).toBe("my-feature");
    }));

  test("arb undo with no operation record fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["undo", "--yes"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Nothing to undo");
    }));

  test("arb branch rename without args and no operation fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "rename", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("required");
    }));

  test("arb branch rename blocks any rename when operation is in progress", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause failure in repo-a
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Try a different target — blocked
      const result = await arb(env, ["branch", "rename", "feat/other-name", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("in progress");
    }));

  test("arb branch rename with same target as in-progress is also blocked (use --continue)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause failure in repo-a
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Same target without --continue — blocked
      const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("in progress");
    }));
});

// ── undo dry-run ─────────────────────────────────────────────────

describe("undo dry-run", () => {
  test("arb undo --dry-run shows plan without changes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      const result = await arb(env, ["undo", "--dry-run"], { cwd: ws });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Dry run");
      // Nothing changed
      const branchA = (await git(repoA, ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("feat/new-name");
    }));
});

// ── remote ────────────────────────────────────────────────────────

describe("remote", () => {
  test("arb branch rename --delete-remote deletes old remote branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      // Push the old branch to remote first
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      // Verify it exists
      await git(join(env.originDir, "repo-a.git"), ["rev-parse", "--verify", "my-feature"]);

      const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--delete-remote"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Old remote branch deleted
      const verifyProc = Bun.spawn(
        ["git", "-C", join(env.originDir, "repo-a.git"), "rev-parse", "--verify", "my-feature"],
        { stdout: "pipe", stderr: "pipe" },
      );
      await verifyProc.exited;
      expect(await verifyProc.exited).not.toBe(0);
      // Local branch renamed
      const branchA = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("feat/new-name");
    }));

  test("arb branch rename hints about arb push when old remote branch exists", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("arb push");
      // Old remote branch NOT deleted
      await git(join(env.originDir, "repo-a.git"), ["rev-parse", "--verify", "my-feature"]);
    }));
});

// ── workspace rename behavior ────────────────────────────────────

describe("workspace rename hint", () => {
  test("arb branch rename does not rename workspace directory", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["branch", "rename", "short-name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Workspace directory NOT renamed
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
      expect(existsSync(join(env.projectDir, "short-name"))).toBe(false);
      // Branch still renamed
      const branchA = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("short-name");
    }));

  test("arb branch rename does not rename workspace when names differ", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-ws", "-b", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "rename", "short-name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-ws"),
      });
      expect(result.exitCode).toBe(0);
      // Workspace stays because ws name (my-ws) != old branch (my-feature)
      expect(existsSync(join(env.projectDir, "my-ws"))).toBe(true);
      expect(existsSync(join(env.projectDir, "short-name"))).toBe(false);
      // Branch still renamed
      const branchA = (await git(join(env.projectDir, "my-ws/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("short-name");
    }));

  test("arb branch rename shows hint about arb rename in plan", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "rename", "short-name", "--dry-run", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("arb rename");
    }));
});

// ── tracking cleanup ─────────────────────────────────────────────

describe("tracking cleanup", () => {
  test("arb branch rename clears tracking so push sees new branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      // Push the old branch to set up tracking
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      // Verify tracking exists
      const merge = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["config", "branch.my-feature.merge"])
      ).trim();
      expect(merge).toBe("refs/heads/my-feature");

      const result = await arb(env, ["branch", "rename", "new-name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);

      // Tracking cleared
      const verifyMerge = Bun.spawn(
        ["git", "-C", join(env.projectDir, "my-feature/repo-a"), "config", "branch.new-name.merge"],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await verifyMerge.exited).not.toBe(0);
      const verifyRemote = Bun.spawn(
        ["git", "-C", join(env.projectDir, "my-feature/repo-a"), "config", "branch.new-name.remote"],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await verifyRemote.exited).not.toBe(0);
    }));

  test("arb push after branch rename pushes new branch name", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      // Make a commit so there's something to push
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "--allow-empty", "-m", "test commit"]);
      // Push old branch
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      await arb(env, ["branch", "rename", "new-name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });

      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // New remote branch exists
      await git(join(env.originDir, "repo-a.git"), ["rev-parse", "--verify", "new-name"]);
      // Tracking now points to new branch
      const trackingMerge = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["config", "branch.new-name.merge"])
      ).trim();
      expect(trackingMerge).toBe("refs/heads/new-name");
    }));

  test("arb branch rename clears stale tracking for already-renamed repos on continue", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");
      const repoB = join(ws, "repo-b");

      // Push repo-a to set up tracking
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Cause failure in repo-b by creating blocking branch
      await git(repoB, ["branch", "new-name"]);

      const r1 = await arb(env, ["branch", "rename", "new-name", "--yes", "--no-fetch"], { cwd: ws });
      expect(r1.exitCode).not.toBe(0);

      // repo-a was renamed (completed), repo-b failed
      // Fix repo-b and continue with --continue
      await git(repoB, ["branch", "-D", "new-name"]);
      const r2 = await arb(env, ["branch", "rename", "--continue", "--yes", "--no-fetch"], { cwd: ws });
      expect(r2.exitCode).toBe(0);

      // repo-a (already renamed in first run) should have tracking cleared
      const verifyMerge = Bun.spawn(["git", "-C", repoA, "config", "branch.new-name.merge"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await verifyMerge.exited).not.toBe(0);
    }));

  test("arb branch rename --delete-remote plus push creates clean remote state", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "--allow-empty", "-m", "test"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      await arb(env, ["branch", "rename", "new-name", "--yes", "--delete-remote", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });

      const result = await arb(env, ["push", "--yes"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Old remote gone
      const verifyOld = Bun.spawn(
        ["git", "-C", join(env.originDir, "repo-a.git"), "rev-parse", "--verify", "my-feature"],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await verifyOld.exited).not.toBe(0);
      // New remote exists
      await git(join(env.originDir, "repo-a.git"), ["rev-parse", "--verify", "new-name"]);
    }));

  test("arb branch rename plan shows remote status in REMOTE column", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      const result = await arb(env, ["branch", "rename", "new-name", "--dry-run", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("leave");
      expect(result.output).toContain("in place");
    }));
});

// ── zero attached repos (config-only rename) ─────────────────────

describe("zero attached repos", () => {
  test("arb branch rename updates config when no repos are attached", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");
      const repoDir = join(wsDir, "repo-a");

      // Remove .git file and prune (simulate post-auto-repair state)
      await rm(join(repoDir, ".git"));
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "prune"]);

      const result = await arb(env, ["branch", "rename", "new-branch", "--yes", "--no-fetch"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Workspace branch set to 'new-branch'");
      expect(result.output).toContain("arb attach");

      // Config updated
      const config = JSON.parse(await readFile(join(wsDir, ".arbws/config.json"), "utf8"));
      expect(config.branch).toBe("new-branch");
      // No migration state needed
      expect(config.branch_rename_from).toBeUndefined();
    }));

  test("arb branch rename --dry-run with zero repos does not write config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");
      const repoDir = join(wsDir, "repo-a");

      await rm(join(repoDir, ".git"));
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "prune"]);

      const result = await arb(env, ["branch", "rename", "new-branch", "--dry-run", "--no-fetch"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Dry run");

      // Config not changed
      const config = JSON.parse(await readFile(join(wsDir, ".arbws/config.json"), "utf8"));
      expect(config.branch).toBe("my-feature");
    }));

  test("full workspace copy recovery: rename branch then attach", () =>
    withEnv(async (env) => {
      // Create original workspace
      await arb(env, ["create", "ws-original", "repo-a"]);
      const origDir = join(env.projectDir, "ws-original");
      const copyDir = join(env.projectDir, "ws-copy");

      // Add a file so we can verify it survives the recovery
      writeFileSync(join(origDir, "repo-a/local-work.txt"), "important work");

      // Copy the workspace directory
      await cp(origDir, copyDir, { recursive: true });
      writeFileSync(join(copyDir, ".arbws/config.json"), JSON.stringify({ branch: "ws-original" }));

      // Run status in the copy — triggers shared-entry detection
      const statusResult = await arb(env, ["status", "-N"], { cwd: copyDir });
      expect(statusResult.output).toContain("removed stale worktree reference");
      expect(statusResult.output).toContain("arb branch rename");

      // Rename branch in the copy
      const renameResult = await arb(env, ["branch", "rename", "ws-copy", "--yes", "--no-fetch"], { cwd: copyDir });
      expect(renameResult.exitCode).toBe(0);

      // Attach repos in the copy
      const attachResult = await arb(env, ["attach", "repo-a"], { cwd: copyDir });
      expect(attachResult.exitCode).toBe(0);

      // Verify the copy has a valid worktree on the new branch
      const copyRepoBranch = (await git(join(copyDir, "repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(copyRepoBranch).toBe("ws-copy");

      // Verify the copy's worktree has valid bidirectional refs
      const copyGit = readFileSync(join(copyDir, "repo-a/.git"), "utf-8").trim();
      expect(copyGit.startsWith("gitdir: ")).toBe(true);
      const copyGitdir = copyGit.slice("gitdir: ".length);
      const copyBackRef = readFileSync(join(copyGitdir, "gitdir"), "utf-8").trim();
      expect(copyBackRef).toBe(join(copyDir, "repo-a/.git"));

      // Verify original workspace is unaffected
      const origResult = await arb(env, ["status", "-N"], { cwd: origDir });
      expect(origResult.exitCode).toBe(0);
      const origBranch = (await git(join(origDir, "repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(origBranch).toBe("ws-original");

      // Verify user's file survived in the copy
      expect(readFileSync(join(copyDir, "repo-a/local-work.txt"), "utf-8")).toBe("important work");
    }));
});

// ── undo collision detection ──────────────────────────────────────

describe("undo collision detection", () => {
  test("arb undo refuses when target branch already exists", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");

      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Manually create the old branch name
      await git(join(ws, "repo-a"), ["branch", "my-feature"]);

      const result = await arb(env, ["undo", "--yes"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already exists");
    }));
});

// ── bare command blocked during in-progress ──────────────────────

describe("branch rename bare command blocked", () => {
  test("bare arb branch rename during in-progress is blocked with guidance", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause failure in repo-a
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      // Bare command (no --continue) should be blocked
      const result = await arb(env, ["branch", "rename", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("in progress");
      expect(result.output).toContain("--continue");
    }));
});

// ── --continue/--abort with no operation ─────────────────────────

describe("branch rename --continue/--abort with no operation", () => {
  test("--continue with no operation errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "rename", "--continue", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Nothing to continue");
    }));

  test("--abort with no operation errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "rename", "--abort", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Nothing to abort");
    }));
});

// ── --abort cancels in-progress ──────────────────────────────────

describe("branch rename --abort cancels in-progress", () => {
  test("--abort cancels in-progress branch rename and restores config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");
      const repoA = join(ws, "repo-a");

      // Cause failure in repo-a
      await git(repoA, ["branch", "feat/new-name"]);
      await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], { cwd: ws });

      const result = await arb(env, ["branch", "rename", "--abort", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // Config restored
      const config = JSON.parse(await readFile(join(ws, ".arbws/config.json"), "utf8"));
      expect(config.branch).toBe("my-feature");

      // Operation record cleaned up
      expect(existsSync(join(ws, ".arbws/operation.json"))).toBe(false);
    }));
});
