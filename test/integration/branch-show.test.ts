import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { arb, git, withEnv, write } from "./helpers/env";

// ── basic output ──────────────────────────────────────────────────

describe("basic output", () => {
  test("arb branch shows branch name", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("BRANCH");
      expect(result.output).toContain("my-feature");
    }));

  test("arb branch shows base when configured", () =>
    withEnv(async (env) => {
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["checkout", "-b", "feat/auth"]);
      await write(join(env.projectDir, ".arb/repos/repo-a/auth.txt"), "auth");
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["add", "auth.txt"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["commit", "-m", "auth"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["push", "-u", "origin", "feat/auth"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);
      const result = await arb(env, ["branch"], {
        cwd: join(env.projectDir, "stacked"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("BRANCH");
      expect(result.output).toContain("BASE");
      expect(result.output).toContain("feat/auth-ui");
      expect(result.output).toContain("feat/auth");
    }));

  test("arb branch shows resolved default base with (default) suffix", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("BASE");
      expect(result.output).toContain("SHARE");
      expect(result.output).toContain("(default)");
      expect(result.output).toContain("origin/main");
    }));
});

// ── quiet mode ────────────────────────────────────────────────────

describe("quiet mode", () => {
  test("arb branch -q outputs just the branch name", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "-q"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe("my-feature");
    }));
});

// ── json mode ─────────────────────────────────────────────────────

describe("json mode", () => {
  test("arb branch --json outputs valid JSON with branch, base, and repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["branch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.branch).toBe("my-feature");
      expect(json.base).toBe(null);
      expect(json.repos.length).toBe(2);
      expect(json.repos[0].branch).toBe("my-feature");
    }));
});

// ── deviations ────────────────────────────────────────────────────

describe("deviations", () => {
  test("arb branch detects wrong branch repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "-b", "experiment"]);
      const result = await arb(env, ["branch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Repos on a different branch");
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("experiment");
    }));

  test("arb branch detects detached repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "--detach"]);
      const result = await arb(env, ["branch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Repos on a different branch");
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("(detached)");
    }));
});

// ── verbose mode ──────────────────────────────────────────────────

describe("verbose mode", () => {
  test("arb branch -v shows per-repo table with REPO, BASE, and SHARE headers", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["branch", "-v"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("REPO");
      expect(result.output).toContain("BRANCH");
      expect(result.output).toContain("BASE");
      expect(result.output).toContain("SHARE");
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("arb branch -v detects wrong branch repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "-b", "experiment"]);
      const result = await arb(env, ["branch", "-v"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("experiment");
    }));

  test("arb branch -v detects detached repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "--detach"]);
      const result = await arb(env, ["branch", "-v"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("(detached)");
    }));

  test("arb branch -v shows local only for unpushed repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "-v"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("(local only)");
    }));

  test("arb branch --verbose --json includes base, share, and refMode fields", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["branch", "--verbose", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.branch).toBe("my-feature");
      expect(json.repos.length).toBe(2);
      expect(json.repos[0].refMode).toBeDefined();
      expect("base" in json.repos[0]).toBe(true);
      expect("share" in json.repos[0]).toBe(true);
    }));

  test("arb branch -q -v errors with Cannot combine", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "-q", "-v"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Cannot combine");
    }));
});

// ── schema mode ──────────────────────────────────────────────────

describe("schema mode", () => {
  test("arb branch --schema outputs valid JSON Schema without requiring workspace", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["branch", "--schema"], { cwd: env.testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.$schema).toBeDefined();
      expect(json.properties.branch).toBeDefined();
      expect(json.properties.repos).toBeDefined();
    }));

  test("arb branch --schema conflicts with --json", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["branch", "--schema", "--json"]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Cannot combine");
    }));
});

// ── explicit show subcommand ──────────────────────────────────────

describe("explicit show subcommand", () => {
  test("arb branch show outputs same as arb branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const branchResult = await arb(env, ["branch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const showResult = await arb(env, ["branch", "show"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(showResult.exitCode).toBe(0);
      expect(showResult.output).toBe(branchResult.output);
    }));

  test("arb branch show -q outputs just the branch name", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "show", "-q"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe("my-feature");
    }));

  test("arb branch show --json outputs valid JSON", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "show", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.branch).toBe("my-feature");
    }));

  test("arb branch show --verbose shows per-repo table", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["branch", "show", "--verbose"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("REPO");
      expect(result.output).toContain("BRANCH");
    }));

  test("arb branch show --schema outputs JSON Schema", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["branch", "show", "--schema"], { cwd: env.testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.$schema).toBeDefined();
    }));

  test("arb branch --help shows show subcommand", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["branch", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("show");
    }));
});

// ── error handling ────────────────────────────────────────────────

describe("error handling", () => {
  test("arb branch outside a workspace errors", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["branch"]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Not inside a workspace");
    }));
});
