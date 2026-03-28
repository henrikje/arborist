import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, withEnv, write } from "./helpers/env";

// ── Helpers ──

/** Create a workspace with N commits in a single repo. Returns commit SHAs (oldest first). */
async function setupWithCommits(env: { projectDir: string }, wsName: string, commitCount: number): Promise<string[]> {
  await arb(env, ["create", wsName, "-b", wsName, "repo-a"]);
  const shas: string[] = [];
  const wt = join(env.projectDir, wsName, "repo-a");
  for (let i = 1; i <= commitCount; i++) {
    await write(join(wt, `file${i}.txt`), `content ${i}`);
    await git(wt, ["add", `file${i}.txt`]);
    await git(wt, ["commit", "-m", `commit ${i}`]);
    shas.push((await git(wt, ["rev-parse", "HEAD"])).trim());
  }
  return shas;
}

/** Read workspace config JSON. */
async function readConfig(env: { projectDir: string }, wsName: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(join(env.projectDir, wsName, ".arbws/config.json"), "utf-8"));
}

/** Get log output from a worktree. */
async function logOneline(env: { projectDir: string }, wsName: string, repo: string): Promise<string> {
  return git(join(env.projectDir, wsName, repo), ["log", "--oneline"]);
}

// ── Validation ──

describe("extract validation", () => {
  test("errors when no direction flag given", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws", "-b", "ws", "repo-a"]);
      const result = await arb(env, ["extract", "new-ws"], { cwd: join(env.projectDir, "ws") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Specify --ending-with");
    }));

  test("errors when workspace name already exists", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      await arb(env, ["create", "existing", "-b", "existing", "repo-a"]);
      const result = await arb(env, ["extract", "existing", "--ending-with", shas[1] ?? ""], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already exists");
    }));

  test("errors when target branch already exists in a repo", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["branch", "prereq"]);
      const result = await arb(env, ["extract", "prereq", "--ending-with", shas[1] ?? ""], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already exists");
    }));

  test("errors when target branch matches workspace branch", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      const result = await arb(env, ["extract", "other", "-b", "ws", "--ending-with", shas[1] ?? ""], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("current workspace branch");
    }));

  test("blocks when repo is dirty", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      await write(join(env.projectDir, "ws/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["extract", "prereq", "--ending-with", shas[1] ?? "", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("blocked");
    }));

  test("dirty skip reason hints about --autostash", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      await write(join(env.projectDir, "ws/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["extract", "prereq", "--ending-with", shas[1] ?? "", "--dry-run", "--no-fetch"], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.output).toContain("--autostash");
    }));

  test("succeeds with --autostash when repo is dirty", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      await write(join(env.projectDir, "ws/repo-a/dirty.txt"), "dirty");
      const result = await arb(
        env,
        ["extract", "prereq", "--ending-with", shas[1] ?? "", "--yes", "--no-fetch", "--autostash"],
        { cwd: join(env.projectDir, "ws") },
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Extracted");
    }));
});

// ── Prefix extraction (--to) ──

describe("extract --to (prefix)", () => {
  test("extracts prefix commits into new workspace", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 5);

      const result = await arb(env, ["extract", "prereq", "--ending-with", shas[2] ?? "", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Extracted");
      expect(result.output).toContain("New workspace: prereq");

      // New workspace exists
      expect(existsSync(join(env.projectDir, "prereq/.arbws/config.json"))).toBe(true);

      // New workspace has commits 1-3
      const prereqLog = await logOneline(env, "prereq", "repo-a");
      expect(prereqLog).toContain("commit 1");
      expect(prereqLog).toContain("commit 2");
      expect(prereqLog).toContain("commit 3");
      expect(prereqLog).not.toContain("commit 4");

      // Original has commits 4-5 (rebased onto prereq)
      const wsLog = await logOneline(env, "ws", "repo-a");
      expect(wsLog).toContain("commit 4");
      expect(wsLog).toContain("commit 5");

      // Config updated
      const wsConfig = await readConfig(env, "ws");
      expect(wsConfig.base).toBe("prereq");

      const prereqConfig = await readConfig(env, "prereq");
      expect(prereqConfig.branch).toBe("prereq");
    }));

  test("dry-run shows plan without executing", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      const result = await arb(env, ["extract", "prereq", "--ending-with", shas[1] ?? "", "--dry-run", "--no-fetch"], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("EXTRACTED (prereq)");
      expect(result.output).toContain("STAYS (ws)");
      expect(result.output).toContain("Dry run");

      // Workspace should NOT be created
      expect(existsSync(join(env.projectDir, "prereq"))).toBe(false);
    }));

  test("explicit branch name with -b", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      const result = await arb(
        env,
        ["extract", "prereq", "-b", "feat/prereq", "--ending-with", shas[1] ?? "", "--yes", "--no-fetch"],
        { cwd: join(env.projectDir, "ws") },
      );
      expect(result.exitCode).toBe(0);
      const config = await readConfig(env, "prereq");
      expect(config.branch).toBe("feat/prereq");
    }));

  test("extracts all commits when boundary is HEAD", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      // Extract all 3 commits (boundary = HEAD)
      const result = await arb(env, ["extract", "prereq", "--ending-with", shas[2] ?? "", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.exitCode).toBe(0);

      // prereq has all 3 commits, ws is rebased on top with nothing new
      const prereqLog = await logOneline(env, "prereq", "repo-a");
      expect(prereqLog).toContain("commit 3");
      expect(prereqLog).toContain("commit 1");
    }));
});

// ── Suffix extraction (--starting-with) ──

describe("extract --starting-with (suffix)", () => {
  test("extracts suffix commits into new workspace", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 5);
      // Extract commits 4 and 5 (boundary = shas[3], inclusive)
      const result = await arb(env, ["extract", "cont", "--starting-with", shas[3] ?? "", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Extracted");
      expect(result.output).toContain("New workspace: cont");

      // Original should have commits 1-3
      const wsLog = await logOneline(env, "ws", "repo-a");
      expect(wsLog).toContain("commit 1");
      expect(wsLog).toContain("commit 2");
      expect(wsLog).toContain("commit 3");
      expect(wsLog).not.toContain("commit 4");

      // New workspace should have commits 4-5 (plus the full history)
      const contLog = await logOneline(env, "cont", "repo-a");
      expect(contLog).toContain("commit 4");
      expect(contLog).toContain("commit 5");

      // New workspace stacks on original
      const contConfig = await readConfig(env, "cont");
      expect(contConfig.base).toBe("ws");

      // Original config unchanged
      const wsConfig = await readConfig(env, "ws");
      expect(wsConfig.base).toBeUndefined();
    }));

  test("extracts single commit at tip", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      const result = await arb(env, ["extract", "tip", "--starting-with", shas[2] ?? "", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.exitCode).toBe(0);

      // Original should have commits 1-2
      const wsLog = await logOneline(env, "ws", "repo-a");
      expect(wsLog).toContain("commit 2");
      expect(wsLog).not.toContain("commit 3");
    }));
});

// ── Split point syntax ──

describe("extract split point syntax", () => {
  test("repo:commit-ish syntax", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      const result = await arb(
        env,
        ["extract", "prereq", "--ending-with", `repo-a:${shas[1] ?? ""}`, "--yes", "--no-fetch"],
        {
          cwd: join(env.projectDir, "ws"),
        },
      );
      expect(result.exitCode).toBe(0);

      const prereqLog = await logOneline(env, "prereq", "repo-a");
      expect(prereqLog).toContain("commit 1");
      expect(prereqLog).toContain("commit 2");
      expect(prereqLog).not.toContain("commit 3");
    }));

  test("bare SHA auto-detects repo", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      // Use a full SHA without repo prefix — should auto-detect repo-a
      const result = await arb(env, ["extract", "prereq", "--ending-with", shas[0] ?? "", "--dry-run", "--no-fetch"], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("EXTRACTED (prereq)");
    }));

  test("non-existent SHA gives clear error", () =>
    withEnv(async (env) => {
      await setupWithCommits(env, "ws", 3);
      const result = await arb(
        env,
        ["extract", "prereq", "--ending-with", "deadbeef00000000", "--dry-run", "--no-fetch"],
        { cwd: join(env.projectDir, "ws") },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("cannot resolve");
    }));

  test("non-existent repo prefix gives clear error", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      const result = await arb(
        env,
        ["extract", "prereq", "--ending-with", `nonexistent:${shas[0] ?? ""}`, "--dry-run", "--no-fetch"],
        { cwd: join(env.projectDir, "ws") },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not in this workspace");
    }));

  test("duplicate repo in split points gives clear error", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 3);
      const result = await arb(
        env,
        [
          "extract",
          "prereq",
          "--ending-with",
          `repo-a:${shas[0] ?? ""},repo-a:${shas[1] ?? ""}`,
          "--dry-run",
          "--no-fetch",
        ],
        { cwd: join(env.projectDir, "ws") },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("duplicate");
    }));
});

// ── Abort / continue validation ──

describe("extract --abort/--continue validation", () => {
  test("--abort errors when no extract in progress", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws", "-b", "ws", "repo-a"]);
      const result = await arb(env, ["extract", "x", "--abort"], { cwd: join(env.projectDir, "ws") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No extract in progress");
    }));

  test("--continue errors when no extract in progress", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws", "-b", "ws", "repo-a"]);
      const result = await arb(env, ["extract", "x", "--continue"], { cwd: join(env.projectDir, "ws") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No extract in progress");
    }));

  test("--abort rejects --ending-with flag", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws", "-b", "ws", "repo-a"]);
      const result = await arb(env, ["extract", "x", "--abort", "--ending-with", "abc"], {
        cwd: join(env.projectDir, "ws"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("does not accept");
    }));
});

// ── Undo ──

describe("arb undo (extract)", () => {
  test("undo reverses a completed prefix extraction", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 4);
      const preSha = (await git(join(env.projectDir, "ws/repo-a"), ["rev-parse", "HEAD"])).trim();

      await arb(env, ["extract", "prereq", "--ending-with", shas[1] ?? "", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "ws"),
      });

      // Verify extract worked
      expect(existsSync(join(env.projectDir, "prereq/.arbws/config.json"))).toBe(true);

      // Undo
      const undoResult = await arb(env, ["undo", "--yes"], { cwd: join(env.projectDir, "ws") });
      expect(undoResult.exitCode).toBe(0);

      // Original HEAD should be restored
      const postSha = (await git(join(env.projectDir, "ws/repo-a"), ["rev-parse", "HEAD"])).trim();
      expect(postSha).toBe(preSha);

      // Config should be restored (no base)
      const wsConfig = await readConfig(env, "ws");
      expect(wsConfig.base).toBeUndefined();

      // Branch should be cleaned up in canonical repo
      const branchList = await git(join(env.projectDir, ".arb/repos/repo-a"), ["branch", "--list", "prereq"]);
      expect(branchList.trim()).toBe("");
    }));

  test("undo reverses a completed suffix extraction", () =>
    withEnv(async (env) => {
      const shas = await setupWithCommits(env, "ws", 4);
      const preSha = (await git(join(env.projectDir, "ws/repo-a"), ["rev-parse", "HEAD"])).trim();

      await arb(env, ["extract", "cont", "--starting-with", shas[2] ?? "", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "ws"),
      });

      const undoResult = await arb(env, ["undo", "--yes"], { cwd: join(env.projectDir, "ws") });
      expect(undoResult.exitCode).toBe(0);

      // Original HEAD restored
      const postSha = (await git(join(env.projectDir, "ws/repo-a"), ["rev-parse", "HEAD"])).trim();
      expect(postSha).toBe(preSha);

      // Branch cleaned up
      const branchList = await git(join(env.projectDir, ".arb/repos/repo-a"), ["branch", "--list", "cont"]);
      expect(branchList.trim()).toBe("");
    }));
});
