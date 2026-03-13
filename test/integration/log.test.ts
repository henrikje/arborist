import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { arb, fetchAllRepos, git, withEnv, write } from "./helpers/env";

// ── default mode (feature branch commits) ────────────────────────

describe("default mode (feature branch commits)", () => {
  test("arb log shows feature branch commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change-a");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add feature to repo-a"]);
      // Use --json to verify structure
      const result = await arb(env, ["log", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.totalCommits).toBe(1);
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.commits[0].subject).toBe("Add feature to repo-a");
      // repo-b should have 0 commits
      const repoB = json.repos.find((r: { name: string }) => r.name === "repo-b");
      expect(repoB.commits.length).toBe(0);
    }));

  test("arb log shows no commits ahead of base for clean repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["log", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.totalCommits).toBe(0);
      expect(json.repos[0].commits.length).toBe(0);
    }));

  test("arb log shows multiple commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "one");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "First commit"]);
      await write(join(env.projectDir, "my-feature/repo-a/file2.txt"), "two");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file2.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Second commit"]);
      const result = await arb(env, ["log", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.repos[0].commits.length).toBe(2);
      // Verify both subjects present
      const subjects = json.repos[0].commits.map((c: { subject: string }) => c.subject);
      expect(subjects).toContain("First commit");
      expect(subjects).toContain("Second commit");
    }));
});

// ── positional repo filtering ────────────────────────────────────

describe("positional repo filtering", () => {
  test("arb log with positional args filters repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Change in repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-b/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-b"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["commit", "-m", "Change in repo-b"]);
      const result = await arb(env, ["log", "repo-a", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Should only include repo-a
      const json = JSON.parse(result.stdout);
      expect(json.repos.length).toBe(1);
      expect(json.repos[0].name).toBe("repo-a");
    }));

  test("arb log with invalid repo name errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["log", "nonexistent"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not in this workspace");
    }));
});

// ── --max-count / -n ─────────────────────────────────────────────

describe("--max-count / -n", () => {
  test("arb log -n 0 rejects invalid max-count", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["log", "-n", "0"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("--max-count must be a positive integer");
    }));

  test("arb log -n abc rejects non-numeric max-count", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["log", "-n", "abc"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("--max-count must be a positive integer");
    }));

  test("arb log -n limits commits per repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      for (let i = 1; i <= 5; i++) {
        await write(join(env.projectDir, `my-feature/repo-a/file${i}.txt`), `${i}`);
        await git(join(env.projectDir, "my-feature/repo-a"), ["add", `file${i}.txt`]);
        await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", `Commit ${i}`]);
      }
      const result = await arb(env, ["log", "-n", "2", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.repos[0].commits.length).toBe(2);
      // Most recent commits should be shown
      const subjects = json.repos[0].commits.map((c: { subject: string }) => c.subject);
      expect(subjects).toContain("Commit 5");
      expect(subjects).toContain("Commit 4");
    }));
});

// ── --json mode ──────────────────────────────────────────────────

describe("--json mode", () => {
  test("arb log --json outputs valid JSON with all fields", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "JSON test commit"]);
      const result = await arb(env, ["log", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Validate JSON structure
      const json = JSON.parse(result.stdout);
      expect(json.workspace).toBeDefined();
      expect(json.branch).toBeDefined();
      expect(json.repos).toBeDefined();
      expect(json.totalCommits).toBeDefined();
      // Check repo-a has the commit
      expect(json.repos[0].commits[0].subject).toBe("JSON test commit");
      // Check full hash is present (40 chars)
      expect(json.repos[0].commits[0].hash.length).toBe(40);
    }));

  test("arb log --json includes status field per repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["log", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.repos[0].status).toBe("ok");
    }));

  test("arb log --json shows empty commits array for repos with no feature commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["log", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.repos[0].commits.length).toBe(0);
    }));
});

// ── edge cases ───────────────────────────────────────────────────

describe("edge cases", () => {
  test("arb log detects detached HEAD", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "--detach", "HEAD"]);
      const result = await arb(env, ["log", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.status).toBe("detached");
      expect(repoA.reason).toContain("detached");
    }));

  test("arb log detects wrong-branch status", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "-b", "other-branch"]);
      const result = await arb(env, ["log", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.status).toBe("wrong-branch");
      expect(repoA.reason).toContain("other-branch");
      expect(repoA.reason).toContain("expected my-feature");
    }));

  test("arb log skipped repos show warning in pipe mode", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "--detach", "HEAD"]);
      const result = await arb(env, ["log"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Pipe mode emits skipped warnings to stderr (captured by run)
      expect(result.output).toContain("repo-a: skipped");
    }));

  test("arb log shows fallback-base when configured base not found", () =>
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
      const result = await arb(env, ["log", "--json"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      // repo-a should be ok (base feat/auth exists)
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      expect(repoA.status).toBe("ok");
      // repo-b should be fallback-base (feat/auth doesn't exist, fell back to main)
      const repoB = json.repos.find((r: { name: string }) => r.name === "repo-b");
      expect(repoB.status).toBe("fallback-base");
      expect(repoB.reason).toContain("feat/auth");
    }));

  test("arb log without workspace context fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["log"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not inside a workspace");
    }));
});

// ── pipe output ──────────────────────────────────────────────────

describe("pipe output", () => {
  test("arb log piped produces tab-separated output", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Piped test commit"]);
      const result = await arb(env, ["log"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      // Should be tab-separated: repo<TAB>hash<TAB>subject
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("Piped test commit");
      // Should contain tabs
      const tabCount = (result.output.match(/\t/g) || []).length;
      expect(tabCount).toBeGreaterThanOrEqual(2);
    }));

  test("arb log pipe omits repos with 0 commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Only in repo-a"]);
      const result = await arb(env, ["log"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      // repo-a should appear, repo-b should not (no commits)
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb log --fetch fetches before showing log", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["log", "--fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fetched");
    }));

  test("arb log -N skips fetch (short for --no-fetch)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["log", "-N"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("Fetched");
    }));

  test("arb log --schema outputs valid JSON Schema without requiring workspace", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["log", "--schema"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.$schema).toBeDefined();
      expect(json.properties.repos).toBeDefined();
      expect(json.properties.totalCommits).toBeDefined();
    }));
});

// ── verbose mode ─────────────────────────────────────────────────

describe("verbose mode", () => {
  test("arb log --json --verbose includes body and files for commits with body", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "hello");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), [
        "commit",
        "-m",
        "Add feature\n\nThis adds the feature body.",
      ]);
      const result = await arb(env, ["log", "--json", "--verbose"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
      const commit = repoA.commits[0];
      expect(commit.subject).toBe("Add feature");
      expect(commit.body).toBe("This adds the feature body.");
      expect(commit.files).toEqual(["file.txt"]);
    }));

  test("arb log --json --verbose includes files even for commits without body", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/alpha.ts"), "a");
      await write(join(env.projectDir, "my-feature/repo-a/beta.ts"), "b");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "alpha.ts", "beta.ts"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "Add two files"]);
      const result = await arb(env, ["log", "--json", "--verbose"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const commit = json.repos[0].commits[0];
      expect(commit.body).toBe("");
      expect(commit.files).toContain("alpha.ts");
      expect(commit.files).toContain("beta.ts");
    }));

  test("arb log --json --verbose with multiple files lists all changed files", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/first.ts"), "x");
      await write(join(env.projectDir, "my-feature/repo-a/second.ts"), "y");
      await write(join(env.projectDir, "my-feature/repo-a/third.ts"), "z");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "first.ts", "second.ts", "third.ts"]);
      await git(join(env.projectDir, "my-feature/repo-a"), [
        "commit",
        "-m",
        "Add three files\n\nIntroduces three new modules.",
      ]);
      const result = await arb(env, ["log", "--json", "--verbose"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const commit = json.repos[0].commits[0];
      expect(commit.subject).toBe("Add three files");
      expect(commit.body).toBe("Introduces three new modules.");
      expect(commit.files).toHaveLength(3);
      expect(commit.files).toContain("first.ts");
      expect(commit.files).toContain("second.ts");
      expect(commit.files).toContain("third.ts");
    }));
});
