import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, gitBelow230, withEnv, write } from "./helpers/env";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

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
      const config = await readFile(join(env.projectDir, "PROJ-208/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("PROJ-208");
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
      const config = await readFile(join(env.projectDir, "PROJ-208/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("feat/PROJ-208");
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
      const config = await readFile(join(env.projectDir, "PROJ-208/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).base).toBe("develop");
      expect(JSON.parse(config).branch).toBe("PROJ-208");
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
      const config = await readFile(join(env.projectDir, "PROJ-208/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("feat/PROJ-208");
      expect(JSON.parse(config).base).toBe("develop");
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
      const config = await readFile(join(env.projectDir, "PROJ-208/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("PROJ-208");
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
      const config = await readFile(join(env.projectDir, "my-feature/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("my-feature");
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

  test("arb rename --include-in-progress renames repos with in-progress operations", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const wtA = join(env.projectDir, "my-feature/repo-a");
      let gitDir = (await git(wtA, ["rev-parse", "--git-dir"])).trim();
      if (!gitDir.startsWith("/")) {
        gitDir = join(wtA, gitDir);
      }
      await writeFile(join(gitDir, "MERGE_HEAD"), "");

      const result = await arb(env, ["rename", "PROJ-208", "--yes", "--no-fetch", "--include-in-progress"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Both repos renamed despite in-progress op in repo-a
      const branchA = (await git(join(env.projectDir, "PROJ-208/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      const branchB = (await git(join(env.projectDir, "PROJ-208/repo-b"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("PROJ-208");
      expect(branchB).toBe("PROJ-208");
      const { rm } = await import("node:fs/promises");
      await rm(join(gitDir, "MERGE_HEAD"), { force: true });
    }));
});

// ── operation gate ───────────────────────────────────────────────

describe.skipIf(gitBelow230)("operation gate", () => {
  test("arb rename is blocked during in-progress rebase", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
      const ws = join(env.projectDir, "my-feature");
      const wt = join(ws, "repo-a");
      const mainRepo = join(env.projectDir, ".arb/repos/repo-a");

      // Create a conflict for rebase
      await write(join(wt, "conflict.txt"), "feature");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature"]);
      await git(mainRepo, ["checkout", "main"]);
      await write(join(mainRepo, "conflict.txt"), "main");
      await git(mainRepo, ["add", "conflict.txt"]);
      await git(mainRepo, ["commit", "-m", "main"]);
      await git(mainRepo, ["push", "origin", "main"]);
      await git(mainRepo, ["checkout", "--detach"]);

      await arb(env, ["rebase", "--yes"], { cwd: ws });

      const result = await arb(env, ["rename", "PROJ-208", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("rebase in progress");
    }));
});

// ── undo ─────────────────────────────────────────────────────────

describe.skipIf(gitBelow230)("rename undo", () => {
  test("arb undo after arb rename reverses directory, branches, and config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const ws = join(env.projectDir, "my-feature");

      const result = await arb(env, ["rename", "PROJ-208", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).toBe(0);

      // Workspace renamed
      expect(existsSync(join(env.projectDir, "PROJ-208"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);

      // Undo from the NEW workspace dir
      const undoResult = await arb(env, ["undo", "--yes"], { cwd: join(env.projectDir, "PROJ-208") });
      expect(undoResult.exitCode).toBe(0);

      // Directory reversed
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
      expect(existsSync(join(env.projectDir, "PROJ-208"))).toBe(false);

      // Branches reversed
      const branchA = (
        await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      const branchB = (
        await git(join(env.projectDir, "my-feature/repo-b"), ["symbolic-ref", "--short", "HEAD"])
      ).trim();
      expect(branchA).toBe("my-feature");
      expect(branchB).toBe("my-feature");

      // Config restored
      const config = JSON.parse(await readFile(join(env.projectDir, "my-feature/.arbws/config.json"), "utf8"));
      expect(config.branch).toBe("my-feature");

      // Operation record finalized
      const op = readJson(join(env.projectDir, "my-feature/.arbws/operation.json")) as Record<string, unknown>;
      expect(op.status).toBe("completed");
      expect(op.outcome).toBe("undone");
    }));

  test("arb undo refuses when target directory already exists", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      await arb(env, ["rename", "PROJ-208", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });

      // Manually create the old directory name
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(env.projectDir, "my-feature"));

      const result = await arb(env, ["undo", "--yes"], { cwd: join(env.projectDir, "PROJ-208") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already exists");
    }));

  test("arb undo refuses when target branch already exists in a repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      await arb(env, ["rename", "PROJ-208", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });

      // Manually create the old branch name in a repo
      await git(join(env.projectDir, "PROJ-208/repo-a"), ["branch", "my-feature"]);

      const result = await arb(env, ["undo", "--yes"], { cwd: join(env.projectDir, "PROJ-208") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already exists");
    }));
});

// ── --continue/--abort with no operation ─────────────────────────

describe.skipIf(gitBelow230)("rename --continue/--abort with no operation", () => {
  test("--continue with no operation errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");

      const result = await arb(env, ["rename", "--continue", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Nothing to continue");
    }));

  test("--abort with no operation errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const ws = join(env.projectDir, "my-feature");

      const result = await arb(env, ["rename", "--abort", "--yes", "--no-fetch"], { cwd: ws });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Nothing to abort");
    }));
});
