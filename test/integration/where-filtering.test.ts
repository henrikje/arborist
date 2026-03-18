import { describe, expect, test } from "bun:test";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, withEnv, write } from "./helpers/env";

// ── -w as --where short form ──────────────────────────────────────

describe("-w as --where short form", () => {
  test("arb status -w dirty filters repos (short for --where)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      const result = await arb(env, ["status", "-w", "dirty"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb -w as global option is rejected", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["-w", "dirty", "status"]);
      expect(result.exitCode).not.toBe(0);
    }));
});

// ── --where filtering ─────────────────────────────────────────────

describe("--where filtering", () => {
  test("arb status --where dirty filters repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["status", "--where", "dirty"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status --where gone shows only gone repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // Push repo-a, then delete the remote branch to make it "gone"
      await write(join(env.projectDir, "my-feature/repo-a/f.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "f.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "commit"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      await git(join(env.originDir, "repo-a.git"), ["branch", "-D", "my-feature"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["fetch", "--prune"]);
      const result = await arb(env, ["status", "--where", "gone"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status --where dirty --json filters JSON output", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["status", "--where", "dirty", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status --where invalid shows helpful error", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "--where", "invalid"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Unknown filter term: invalid");
      expect(result.output).toContain("Valid terms:");
    }));

  test("arb status --where comma-separated uses OR logic", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["status", "--where", "dirty,gone"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status --dirty --where errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "--dirty", "--where", "dirty"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot combine --dirty with --where");
    }));

  test("arb exec --where dirty runs only in dirty repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["exec", "--where", "dirty", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb exec --where dirty+ahead-share runs only in repos matching both", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // repo-a: dirty only
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      // repo-b: dirty AND ahead-share
      await write(join(env.projectDir, "my-feature/repo-b/dirty.txt"), "dirty");
      await git(join(env.projectDir, "my-feature/repo-b"), ["add", "-A"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["commit", "-m", "unpushed"]);
      await write(join(env.projectDir, "my-feature/repo-b/dirty2.txt"), "more");
      const result = await arb(env, ["exec", "--where", "dirty+ahead-share", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-b");
      expect(result.output).not.toContain("repo-a");
    }));

  test("arb exec --where dirty+ahead-share skips repos matching only one term", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // repo-a: dirty only (no ahead-share commits)
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["exec", "--where", "dirty+ahead-share", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb exec --dirty still works as shortcut", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["exec", "--dirty", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb exec --repo runs only in specified repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "--repo", "repo-a", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb exec --repo with multiple repos runs in all specified", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "--repo", "repo-a", "--repo", "repo-b", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("arb exec --repo with invalid repo name errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["exec", "--repo", "nonexistent", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Repo 'nonexistent' is not in this workspace");
    }));

  test("arb exec --repo combined with --dirty uses AND logic", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      await write(join(env.projectDir, "my-feature/repo-b/dirty.txt"), "dirty");
      const result = await arb(env, ["exec", "--repo", "repo-a", "--dirty", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb open --repo opens only specified repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const spy = join(env.testDir, "editor-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do echo "$arg"; done >> "${env.testDir}/opened-dirs"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", "--repo", "repo-a", spy], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const opened = await readFile(join(env.testDir, "opened-dirs"), "utf8");
      expect(opened).toContain("repo-a");
      expect(opened).not.toContain("repo-b");
    }));

  test("arb open --repo with multiple repos opens all specified", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const spy = join(env.testDir, "editor-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do echo "$arg"; done >> "${env.testDir}/opened-dirs"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", "--repo", "repo-a", "--repo", "repo-b", spy], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const opened = await readFile(join(env.testDir, "opened-dirs"), "utf8");
      expect(opened).toContain("repo-a");
      expect(opened).toContain("repo-b");
    }));

  test("arb open --repo with invalid repo name errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["open", "--repo", "nonexistent", "true"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Repo 'nonexistent' is not in this workspace");
    }));

  test("arb open --repo combined with --dirty uses AND logic", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      await write(join(env.projectDir, "my-feature/repo-b/dirty.txt"), "dirty");
      const spy = join(env.testDir, "editor-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do echo "$arg"; done >> "${env.testDir}/opened-dirs"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", "--repo", "repo-a", "--dirty", spy], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const opened = await readFile(join(env.testDir, "opened-dirs"), "utf8");
      expect(opened).toContain("repo-a");
      expect(opened).not.toContain("repo-b");
    }));
});
