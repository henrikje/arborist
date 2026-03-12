import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { arb, withEnv } from "./helpers/env";

// ── path ─────────────────────────────────────────────────────────

describe("path", () => {
  test("arb path returns correct path", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "--all-repos"]);
      const result = await arb(env, ["path", "my-feature"]);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature"));
    }));

  test("arb path with no argument returns project root from workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["path"], { cwd: join(env.projectDir, "my-feature/repo-a") });
      expect(result.output.trim()).toBe(env.projectDir);
    }));

  test("arb path with subpath returns repo path", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["path", "my-feature/repo-a"]);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));

  test("arb path with no argument outside workspace returns project root", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["path"]);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(env.projectDir);
    }));

  test("arb path with invalid subpath fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["path", "my-feature/nonexistent"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not found in workspace");
    }));

  test("arb path with nonexistent workspace fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["path", "does-not-exist"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("does not exist");
    }));
});

// ── cd ───────────────────────────────────────────────────────────

describe("cd", () => {
  test("arb cd prints correct workspace path", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "--all-repos"]);
      const result = await arb(env, ["cd", "my-feature"]);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature"));
    }));

  test("arb cd with subpath prints correct repo path", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["cd", "my-feature/repo-a"]);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));

  test("arb cd with nonexistent workspace fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["cd", "does-not-exist"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("does not exist");
    }));

  test("arb cd with nonexistent subpath fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["cd", "my-feature/nonexistent"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not found in workspace");
    }));

  test("arb cd with no arg in non-TTY fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["cd"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Usage: arb cd");
    }));

  test("arb cd rejects non-workspace directory", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "not-a-workspace"), { recursive: true });
      const result = await arb(env, ["cd", "not-a-workspace"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("does not exist");
    }));

  test("arb cd path output is clean when stdout is captured (shell wrapper pattern)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "--all-repos"]);
      const result = await arb(env, ["cd", "my-feature"]);
      expect(result.stdout.trim()).toBe(join(env.projectDir, "my-feature"));
    }));

  test("arb cd subpath output is clean when stdout is captured", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["cd", "my-feature/repo-a"]);
      expect(result.stdout.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));
});

// ── cd scope-aware ───────────────────────────────────────────────

describe("cd scope-aware", () => {
  test("arb cd resolves repo name when inside a workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["cd", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));

  test("arb cd resolves repo from a nested repo directory", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await mkdir(join(env.projectDir, "my-feature/repo-a/src"), { recursive: true });
      const result = await arb(env, ["cd", "repo-b"], { cwd: join(env.projectDir, "my-feature/repo-a/src") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-b"));
    }));

  test("arb cd falls back to workspace when name is not a repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-alpha", "repo-a"]);
      await arb(env, ["create", "ws-beta", "repo-b"]);
      const result = await arb(env, ["cd", "ws-beta"], { cwd: join(env.projectDir, "ws-alpha") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "ws-beta"));
    }));

  test("arb cd prefers repo over workspace when ambiguous", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "repo-a", "repo-b"]);
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["cd", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));

  test("arb cd explicit ws/repo syntax still works from inside a workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-alpha", "repo-a"]);
      await arb(env, ["create", "ws-beta", "repo-b"]);
      const result = await arb(env, ["cd", "ws-beta/repo-b"], { cwd: join(env.projectDir, "ws-alpha") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "ws-beta/repo-b"));
    }));

  test("arb cd error when name matches neither repo nor workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["cd", "nonexistent"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("is not a repo in workspace");
      expect(result.output).toContain("or a workspace");
    }));

  test("arb cd behavior unchanged when at project root", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["cd", "my-feature"], { cwd: env.projectDir });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature"));
    }));
});

// ── path scope-aware ─────────────────────────────────────────────

describe("path scope-aware", () => {
  test("arb path resolves repo name when inside a workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["path", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));

  test("arb path falls back to workspace when not a repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-alpha", "repo-a"]);
      await arb(env, ["create", "ws-beta", "repo-b"]);
      const result = await arb(env, ["path", "ws-beta"], { cwd: join(env.projectDir, "ws-alpha") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "ws-beta"));
    }));

  test("arb path prefers repo over workspace when ambiguous", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "repo-a", "repo-b"]);
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["path", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));
});

// ── -C / --chdir ─────────────────────────────────────────────────

describe("-C / --chdir", () => {
  test("arb -C targets the given directory", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["-C", env.projectDir, "repo", "list"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("arb -C resolves relative paths", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["-C", "project", "repo", "list"], { cwd: env.testDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
    }));

  test("arb -C with non-existent directory fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["-C", "/no/such/directory", "repo", "list"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot change to");
      expect(result.output).toContain("no such directory");
    }));

  test("arb -C with init creates project in target directory", () =>
    withEnv(async (env) => {
      await mkdir(join(env.testDir, "new-root"), { recursive: true });
      const result = await arb(env, ["-C", join(env.testDir, "new-root"), "init"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.testDir, "new-root/.arb"))).toBe(true);
    }));

  test("arb -C with status detects workspace from target directory", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["-C", join(env.projectDir, "my-feature"), "status"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
    }));

  test("arb -C with list shows workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["-C", env.projectDir, "list", "--no-status"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("my-feature");
    }));

  test("arb -C with path prints correct path", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["-C", env.projectDir, "path"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(env.projectDir);
    }));

  test("arb -C with cd outputs correct directory", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["-C", env.projectDir, "cd", "my-feature"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(join(env.projectDir, "my-feature"));
    }));
});
