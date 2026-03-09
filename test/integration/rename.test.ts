import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, gitBelow230, withEnv } from "./helpers/env";

// ── basic rename ──────────────────────────────────────────────────

describe.skipIf(gitBelow230)("basic rename", () => {
  test("arb rename renames workspace dir + branch across all repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["rename", "PROJ-208", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Workspace directory renamed
      expect(existsSync(join(env.projectDir, "PROJ-208"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
      // Config at new path
      const config = await readFile(join(env.projectDir, "PROJ-208/.arbws/config"), "utf8");
      expect(config).toContain("branch = PROJ-208");
      expect(config).not.toContain("branch_rename_from");
      // Both repos on new branch
      const branchA = (await git(join(env.projectDir, "PROJ-208/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      const branchB = (await git(join(env.projectDir, "PROJ-208/repo-b"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("PROJ-208");
      expect(branchB).toBe("PROJ-208");
      // Stdout contains new path for shell cd
      expect(result.output).toContain(join(env.projectDir, "PROJ-208"));
    }));

  test("arb rename with --branch sets different workspace name and branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["rename", "PROJ-208", "--branch", "feat/PROJ-208", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Workspace directory renamed
      expect(existsSync(join(env.projectDir, "PROJ-208"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
      // Branch set differently from workspace name
      const branchA = (await git(join(env.projectDir, "PROJ-208/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("feat/PROJ-208");
      // Config
      const config = await readFile(join(env.projectDir, "PROJ-208/.arbws/config"), "utf8");
      expect(config).toContain("branch = feat/PROJ-208");
    }));

  test("arb rename --branch derives workspace name from branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["rename", "--branch", "feat/PROJ-208", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Workspace name derived from branch (last segment)
      expect(existsSync(join(env.projectDir, "PROJ-208"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
      // Branch
      const branchA = (await git(join(env.projectDir, "PROJ-208/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("feat/PROJ-208");
    }));

  test("arb rename with --base changes base", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const result = await arb(env, ["rename", "PROJ-208", "--base", "develop", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const config = await readFile(join(env.projectDir, "PROJ-208/.arbws/config"), "utf8");
      expect(config).toContain("base = develop");
      expect(config).toContain("branch = PROJ-208");
    }));

  test("arb rename with all three: name, --branch, --base", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const result = await arb(
        env,
        ["rename", "PROJ-208", "--branch", "feat/PROJ-208", "--base", "develop", "--yes", "--no-fetch"],
        { cwd: join(env.projectDir, "my-feature") },
      );
      expect(result.exitCode).toBe(0);
      const config = await readFile(join(env.projectDir, "PROJ-208/.arbws/config"), "utf8");
      expect(config).toContain("branch = feat/PROJ-208");
      expect(config).toContain("base = develop");
      expect(existsSync(join(env.projectDir, "PROJ-208"))).toBe(true);
    }));
});

// ── zero-repos case ──────────────────────────────────────────────

describe.skipIf(gitBelow230)("zero-repos case", () => {
  test("arb rename with no attached repos renames dir + updates config", () =>
    withEnv(async (env) => {
      // Create with repos, then detach all to get a zero-repos workspace
      await arb(env, ["create", "my-feature", "repo-a"]);
      await arb(env, ["detach", "repo-a", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const result = await arb(env, ["rename", "PROJ-208", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "PROJ-208"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
      const config = await readFile(join(env.projectDir, "PROJ-208/.arbws/config"), "utf8");
      expect(config).toContain("branch = PROJ-208");
    }));
});

// ── no-op guard ──────────────────────────────────────────────────

describe.skipIf(gitBelow230)("no-op guard", () => {
  test("arb rename to same name is a no-op", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["rename", "my-feature", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("nothing to do");
    }));
});

// ── validation ───────────────────────────────────────────────────

describe("validation", () => {
  test("arb rename rejects invalid workspace name (slashes)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["rename", "bad/name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("must not contain '/'");
    }));

  test("arb rename rejects invalid workspace name (dots)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["rename", ".hidden", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
    }));

  test("arb rename rejects invalid branch name via --branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["rename", "good-name", "--branch", "invalid..name", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Invalid branch name");
    }));

  test("arb rename without arguments fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["rename", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("required");
    }));

  test("arb rename rejects existing target directory", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await arb(env, ["create", "other-ws", "repo-b"]);
      const result = await arb(env, ["rename", "other-ws", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already exists");
    }));
});

// ── dry-run ──────────────────────────────────────────────────────

describe.skipIf(gitBelow230)("dry-run", () => {
  test("arb rename --dry-run shows plan without executing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["rename", "PROJ-208", "--dry-run", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Dry run");
      expect(result.output).toContain("Renaming workspace");
      // Config not changed
      const config = await readFile(join(env.projectDir, "my-feature/.arbws/config"), "utf8");
      expect(config).toContain("branch = my-feature");
      // Workspace not renamed
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
      expect(existsSync(join(env.projectDir, "PROJ-208"))).toBe(false);
    }));
});

// ── delete remote ────────────────────────────────────────────────

describe.skipIf(gitBelow230)("delete remote", () => {
  test("arb rename --delete-remote removes old remote branches", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      const result = await arb(env, ["rename", "PROJ-208", "--yes", "--delete-remote"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Old remote branch deleted
      const verifyProc = Bun.spawn(
        ["git", "-C", join(env.originDir, "repo-a.git"), "rev-parse", "--verify", "my-feature"],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await verifyProc.exited).not.toBe(0);
    }));
});

// ── skip in-progress ─────────────────────────────────────────────

describe.skipIf(gitBelow230)("skip in-progress", () => {
  test("arb rename skips repos with in-progress git operation", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const wtA = join(env.projectDir, "my-feature/repo-a");
      let gitDir = (await git(wtA, ["rev-parse", "--git-dir"])).trim();
      if (!gitDir.startsWith("/")) {
        gitDir = join(wtA, gitDir);
      }
      await writeFile(join(gitDir, "MERGE_HEAD"), "");

      const result = await arb(env, ["rename", "PROJ-208", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // repo-a skipped (still on old branch), repo-b renamed
      const branchA = (await git(join(env.projectDir, "PROJ-208/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      const branchB = (await git(join(env.projectDir, "PROJ-208/repo-b"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("my-feature");
      expect(branchB).toBe("PROJ-208");
      expect(result.output).toContain("in progress");
      const { rm } = await import("node:fs/promises");
      await rm(join(gitDir, "MERGE_HEAD"), { force: true });
    }));
});

// ── recovery: arb rename → arb rename ────────────────────────────

describe.skipIf(gitBelow230)("recovery: arb rename → arb rename", () => {
  test("arb rename partial failure → arb rename --continue completes + renames workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // Simulate partial: config updated with workspace_rename_to, repo-a renamed, repo-b not yet
      await writeFile(
        join(env.projectDir, "my-feature/.arbws/config"),
        "branch = PROJ-208\nbranch_rename_from = my-feature\nworkspace_rename_to = PROJ-208\n",
      );
      await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "PROJ-208"]);

      const result = await arb(env, ["rename", "--continue", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Workspace directory renamed
      expect(existsSync(join(env.projectDir, "PROJ-208"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
      const branchA = (await git(join(env.projectDir, "PROJ-208/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      const branchB = (await git(join(env.projectDir, "PROJ-208/repo-b"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("PROJ-208");
      expect(branchB).toBe("PROJ-208");
      // Migration state cleared
      const config = await readFile(join(env.projectDir, "PROJ-208/.arbws/config"), "utf8");
      expect(config).not.toContain("branch_rename_from");
      expect(config).not.toContain("workspace_rename_to");
    }));

  test("arb rename partial failure → arb rename --abort rolls back", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await writeFile(
        join(env.projectDir, "my-feature/.arbws/config"),
        "branch = PROJ-208\nbranch_rename_from = my-feature\n",
      );
      await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "PROJ-208"]);

      const result = await arb(env, ["rename", "--abort", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const branchA = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      const branchB = (
        await git(join(env.projectDir, "my-feature/repo-b"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("my-feature");
      expect(branchB).toBe("my-feature");
      const config = await readFile(join(env.projectDir, "my-feature/.arbws/config"), "utf8");
      expect(config).toContain("branch = my-feature");
      expect(config).not.toContain("branch_rename_from");
    }));

  test("arb rename re-run with same target treats as resume", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await writeFile(
        join(env.projectDir, "my-feature/.arbws/config"),
        "branch = PROJ-208\nbranch_rename_from = my-feature\n",
      );
      await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "PROJ-208"]);

      const result = await arb(env, ["rename", "PROJ-208", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Workspace renamed to PROJ-208
      const branchB = (await git(join(env.projectDir, "PROJ-208/repo-b"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchB).toBe("PROJ-208");
    }));

  test("arb rename --abort when no rename in progress fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["rename", "--abort", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No rename in progress");
    }));

  test("arb rename --continue when no rename in progress fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["rename", "--continue", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No rename in progress");
    }));
});

// ── cross-command recovery: arb branch rename → arb rename ───────

describe.skipIf(gitBelow230)("cross-command recovery: branch rename → rename", () => {
  test("arb branch rename partial → arb rename --continue completes (no workspace rename without stored target)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // arb branch rename does NOT write workspace_rename_to
      await writeFile(
        join(env.projectDir, "my-feature/.arbws/config"),
        "branch = PROJ-208\nbranch_rename_from = my-feature\n",
      );
      await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "PROJ-208"]);

      // Using arb rename --continue on state created by arb branch rename — no workspace_rename_to stored
      const result = await arb(env, ["rename", "--continue", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const branchB = (
        await git(join(env.projectDir, "my-feature/repo-b"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchB).toBe("PROJ-208");
      // Workspace directory NOT renamed (no workspace_rename_to in config from branch rename)
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
      const config = await readFile(join(env.projectDir, "my-feature/.arbws/config"), "utf8");
      expect(config).not.toContain("branch_rename_from");
    }));

  test("arb branch rename partial → arb rename --abort rolls back", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await writeFile(
        join(env.projectDir, "my-feature/.arbws/config"),
        "branch = PROJ-208\nbranch_rename_from = my-feature\n",
      );
      await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "PROJ-208"]);

      const result = await arb(env, ["rename", "--abort", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const branchA = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("my-feature");
    }));
});

// ── cross-command recovery: arb rename → arb branch rename ───────

describe.skipIf(gitBelow230)("cross-command recovery: rename → branch rename", () => {
  test("arb rename partial → arb branch rename --continue completes (no workspace rename)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await writeFile(
        join(env.projectDir, "my-feature/.arbws/config"),
        "branch = PROJ-208\nbranch_rename_from = my-feature\n",
      );
      await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "PROJ-208"]);

      const result = await arb(env, ["branch", "rename", "--continue", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Branches renamed
      const branchB = (
        await git(join(env.projectDir, "my-feature/repo-b"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchB).toBe("PROJ-208");
      // Workspace directory NOT renamed (branch rename doesn't touch it)
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
    }));

  test("arb rename partial → arb branch rename --abort rolls back", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await writeFile(
        join(env.projectDir, "my-feature/.arbws/config"),
        "branch = PROJ-208\nbranch_rename_from = my-feature\n",
      );
      await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "PROJ-208"]);

      const result = await arb(env, ["branch", "rename", "--abort", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const branchA = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("my-feature");
      const config = await readFile(join(env.projectDir, "my-feature/.arbws/config"), "utf8");
      expect(config).toContain("branch = my-feature");
    }));
});

// ── conflicting target ───────────────────────────────────────────

describe("conflicting target", () => {
  test("arb rename with different target while rename in progress fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await writeFile(
        join(env.projectDir, "my-feature/.arbws/config"),
        "branch = PROJ-208\nbranch_rename_from = my-feature\n",
      );
      const result = await arb(env, ["rename", "PROJ-209", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already in progress");
    }));
});
