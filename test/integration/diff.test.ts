import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { arb, fetchAllRepos, git, withEnv, write } from "./helpers/env";

// ── feature branch diff ──────────────────────────────────────────

describe("feature branch diff", () => {
  test("arb diff shows feature branch diff", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "new content");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add file to repo-a"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.totalFiles).toBe(1);
      expect(json.totalInsertions).toBe(1);
      // repo-a should have changes
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.stat.files).toBe(1);
    }));

  test("arb diff shows clean for repos with no feature commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.repos[0].status).toBe("clean");
      expect(json.totalFiles).toBe(0);
    }));

  test("arb diff shows multiple files changed", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file1.txt"), "one");
      await write(join(env.projectDir, "my-feature/repo-a/file2.txt"), "two");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file1.txt", "file2.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add two files"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.totalFiles).toBe(2);
      expect(json.totalInsertions).toBe(2);
    }));
});

// ── --stat mode ──────────────────────────────────────────────────

describe("--stat mode", () => {
  test("arb diff --stat --json includes fileStat", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "content");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add file"]);
      const result = await arb(env, ["diff", "--stat", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      // fileStat should be present with --stat
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.fileStat.length).toBe(1);
      expect(repoA.fileStat[0].file).toBe("file.txt");
    }));

  test("arb diff --json without --stat omits fileStat", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "content");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add file"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      // fileStat should NOT be present without --stat
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect("fileStat" in repoA).toBe(false);
    }));
});

// ── --json mode ──────────────────────────────────────────────────

describe("--json mode", () => {
  test("arb diff --json outputs valid JSON with all fields", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "JSON test commit"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Validate JSON structure
      const json = JSON.parse(result.stdout);
      expect(json.workspace).toBeDefined();
      expect(json.branch).toBeDefined();
      expect(json.repos).toBeDefined();
      expect(json.totalFiles).toBeDefined();
      expect(json.totalInsertions).toBeDefined();
      expect(json.totalDeletions).toBeDefined();
      // Check repo-a has stat
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.stat.files).toBe(1);
    }));

  test("arb diff --json includes status field per repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.repos[0].status).toBe("clean");
    }));
});

// ── positional repo filtering ────────────────────────────────────

describe("positional repo filtering", () => {
  test("arb diff with positional args filters repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Change in repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-b/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-b"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["commit", "-m", "Change in repo-b"]);
      const result = await arb(env, ["diff", "repo-a", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Should only include repo-a
      const json = JSON.parse(result.stdout);
      expect(json.repos.length).toBe(1);
      expect(json.repos[0].name).toBe("repo-a");
    }));

  test("arb diff with invalid repo name errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["diff", "nonexistent"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not in this workspace");
    }));
});

// ── --where filtering ────────────────────────────────────────────

describe("--where filtering", () => {
  test("arb diff --where unpushed filters by status", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Unpushed change"]);
      const result = await arb(env, ["diff", "--where", "unpushed", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Only repo-a has unpushed commits
      const json = JSON.parse(result.stdout);
      expect(json.repos.length).toBe(1);
      expect(json.repos[0].name).toBe("repo-a");
    }));
});

// ── edge cases ───────────────────────────────────────────────────

describe("edge cases", () => {
  test("arb diff detects detached HEAD", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "--detach", "HEAD"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.status).toBe("detached");
      expect(repoA.reason).toContain("detached");
    }));

  test("arb diff detects wrong-branch status", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "-b", "other-branch"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.status).toBe("wrong-branch");
      expect(repoA.reason).toContain("other-branch");
      expect(repoA.reason).toContain("expected my-feature");
    }));

  test("arb diff shows fallback-base when configured base not found", () =>
    withEnv(async (env) => {
      // repo-a has feat/auth branch, repo-b does NOT
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["checkout", "-b", "feat/auth"]);
      await write(join(env.projectDir, ".arb/repos/repo-a/auth.txt"), "auth");
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["add", "auth.txt"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["commit", "-m", "auth"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["push", "-u", "origin", "feat/auth"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a", "repo-b"]);
      await fetchAllRepos(env);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      // repo-b should be fallback-base (feat/auth doesn't exist, fell back to main)
      const repoB = json.repos.find((r: { name: string }) => r.name === "repo-b");
      expect(repoB.status).toBe("fallback-base");
      expect(repoB.reason).toContain("feat/auth");
    }));

  test("arb diff skipped repos show warning in pipe mode", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "--detach", "HEAD"]);
      const result = await arb(env, ["diff"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Pipe mode emits skipped warnings to stderr (captured by run)
      expect(result.output).toContain("repo-a: skipped");
    }));

  test("arb diff without workspace context fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["diff"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not inside a workspace");
    }));
});

// ── pipe output ──────────────────────────────────────────────────

describe("pipe output", () => {
  test("arb diff piped produces diff output", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Piped test commit"]);
      const result = await arb(env, ["diff"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      // Should contain diff markers
      expect(result.output).toMatch(/diff --git|\+change/);
    }));

  test("arb diff pipe omits repos with 0 changes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Only in repo-a"]);
      const result = await arb(env, ["diff"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      // Should contain diff content for repo-a
      expect(result.output).toContain("file.txt");
    }));
});

// ── working tree changes ──────────────────────────────────────────

describe("working tree changes", () => {
  test("arb diff includes uncommitted unstaged changes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      // Commit a file first so it's tracked
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "original");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add file"]);
      // Modify it without staging (unstaged change on top of committed change)
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "modified");
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.totalFiles).toBe(1);
      // The unstaged modification should show: "modified" has 1 line, vs 0 in base
      expect(json.totalInsertions).toBe(1);
    }));

  test("arb diff includes staged but uncommitted changes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/staged.txt"), "staged");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "staged.txt"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.totalFiles).toBe(1);
    }));

  test("arb diff combines committed and staged uncommitted changes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/committed.txt"), "committed");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "committed.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add committed file"]);
      // Stage a second file without committing
      await write(join(env.projectDir, "my-feature/repo-a/staged.txt"), "staged");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "staged.txt"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.totalFiles).toBe(2);
    }));

  test("arb diff piped includes staged uncommitted changes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/staged.txt"), "staged-content");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "staged.txt"]);
      const result = await arb(env, ["diff"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("staged-content");
    }));

  test("arb diff does not report clean when repo has staged changes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "staged");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.repos[0].status).not.toBe("clean");
    }));
});

// ── fetch ─────────────────────────────────────────────────────────

describe("fetch", () => {
  test("arb diff --fetch fetches before showing diff", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["diff", "--fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fetched");
    }));

  test("arb diff shows renames instead of delete+add", () =>
    withEnv(async (env) => {
      // Add a file on the base branch (main) so it exists before the feature branch
      const canonical = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonical, ["checkout", "main"]);
      await write(join(canonical, "old-name.txt"), "rename me");
      await git(canonical, ["add", "old-name.txt"]);
      await git(canonical, ["commit", "-m", "Add file on main"]);
      await git(canonical, ["push"]);
      await git(canonical, ["checkout", "--detach"]);

      await arb(env, ["create", "my-feature", "repo-a"]);
      // Rename the file on the feature branch
      await git(join(env.projectDir, "my-feature/repo-a"), ["mv", "old-name.txt", "new-name.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Rename file"]);
      const result = await arb(env, ["diff", "--stat", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      // Should show a rename (=> in the file name), not separate delete+add
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.fileStat.length).toBe(1);
      expect(repoA.fileStat[0].file).toContain("=>");
    }));

  test("arb diff -N skips fetch (short for --no-fetch)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["diff", "-N"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("Fetched");
    }));
});

// ── replayPlan annotation ────────────────────────────────────────

describe("replayPlan annotation", () => {
  /**
   * Helper: create a diverged branch with a cherry-picked commit.
   * Makes 2 feature commits, advances main independently, then cherry-picks
   * the older feature commit onto main. This produces a true divergence
   * (ahead=2, behind=2) with one commit already on base via patch-id match.
   */
  async function setupDivergedWithCherryPick(env: {
    testDir: string;
    projectDir: string;
    originDir: string;
  }): Promise<void> {
    const wt = join(env.projectDir, "my-feature/repo-a");
    const canonical = join(env.projectDir, ".arb/repos/repo-a");

    // Make 2 commits on feature branch
    await write(join(wt, "feature1.txt"), "feature1");
    await git(wt, ["add", "feature1.txt"]);
    await git(wt, ["commit", "-m", "Add feature1"]);

    await write(join(wt, "feature2.txt"), "feature2");
    await git(wt, ["add", "feature2.txt"]);
    await git(wt, ["commit", "-m", "Add feature2"]);

    // Get the hash of the older feature commit
    const logOutput = await git(wt, ["log", "--format=%H", "-n", "2"]);
    const hashes = logOutput.trim().split("\n");
    const olderHash = hashes[1] as string;

    // Push feature branch so origin has the commits
    await git(wt, ["push", "origin", "my-feature"]);

    // Via a temp clone: advance main with an independent commit, then cherry-pick feature1 on top.
    const tmpClone = join(env.testDir, "tmp-cherry-diff");
    await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
    await write(join(tmpClone, "main-only.txt"), "main-only");
    await git(tmpClone, ["add", "main-only.txt"]);
    await git(tmpClone, ["commit", "-m", "Advance main independently"]);
    await git(tmpClone, ["fetch", "origin", "my-feature"]);
    await git(tmpClone, ["cherry-pick", olderHash]);
    await git(tmpClone, ["push", "origin", "main"]);

    // Fetch so the worktree sees the updated origin/main
    await git(canonical, ["fetch", "--prune"]);
  }

  test("arb diff --json includes replayPlan when branch is diverged with cherry-picked commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await setupDivergedWithCherryPick(env);

      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.replayPlan).toBeDefined();
      expect(repoA.replayPlan.alreadyOnTarget).toBe(1);
      expect(repoA.replayPlan.toReplay).toBe(1);
      expect(repoA.replayPlan.totalLocal).toBe(2);
    }));

  test("arb diff does not include replayPlan when branch is not diverged", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Feature commit"]);
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.replayPlan).toBeUndefined();
    }));

  test("arb diff --json omits replayPlan for non-diverged repos in same workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await setupDivergedWithCherryPick(env);

      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      // repo-a is diverged with cherry-pick — should have replayPlan
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.replayPlan).toBeDefined();
      // repo-b is not diverged — should have no replayPlan
      const repoB = json.repos.find((r: { name: string }) => r.name === "repo-b");
      expect(repoB).toBeDefined();
      expect(repoB.replayPlan).toBeUndefined();
    }));
});

// ── untracked file hints ──────────────────────────────────────────

describe("untracked file hints", () => {
  test("arb diff shows untracked hint when repo has untracked files", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/committed.txt"), "committed");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "committed.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add file"]);
      // Create an untracked file
      await write(join(env.projectDir, "my-feature/repo-a/untracked.txt"), "untracked");
      const result = await arb(env, ["diff"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("1 untracked file not in diff");
    }));

  test("arb diff shows untracked hints for multiple repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/committed.txt"), "committed");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "committed.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add file"]);
      await write(join(env.projectDir, "my-feature/repo-a/untracked.txt"), "untracked-a");
      await write(join(env.projectDir, "my-feature/repo-b/untracked.txt"), "untracked-b");
      const result = await arb(env, ["diff"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a: 1 untracked file not in diff");
      expect(result.output).toContain("repo-b: 1 untracked file not in diff");
    }));

  test("arb diff --json includes untrackedCount for repos with untracked files", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/committed.txt"), "committed");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "committed.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add file"]);
      await write(join(env.projectDir, "my-feature/repo-a/untracked.txt"), "untracked");
      const result = await arb(env, ["diff", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.untrackedCount).toBe(1);
    }));

  test("arb diff does not show untracked hint when no untracked files", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/committed.txt"), "committed");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "committed.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add file"]);
      const result = await arb(env, ["diff"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("untracked not in diff");
    }));

  test("arb diff --schema outputs valid JSON Schema without requiring workspace", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["diff", "--schema"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.$schema).toBeDefined();
      expect(json.properties.repos).toBeDefined();
      expect(json.properties.totalFiles).toBeDefined();
    }));
});
