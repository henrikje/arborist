import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arb, git, withEnv } from "./helpers/env";

// ── branch base ──────────────────────────────────────────────────

describe("branch base", () => {
  test("show mode prints current base", () =>
    withEnv(async (env) => {
      const canonicalA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalA, ["checkout", "-b", "develop"]);
      await git(canonicalA, ["commit", "--allow-empty", "-m", "develop"]);
      await git(canonicalA, ["push", "origin", "develop"]);
      await git(canonicalA, ["checkout", "--detach"]);

      await arb(env, ["create", "my-feature", "--base", "develop", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "base"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("develop");
    }));

  test("show mode with no base configured", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "base"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("tracking repo default");
    }));

  test("set mode sets the base branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "base", "develop"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Base branch set to develop");

      const config = JSON.parse(readFileSync(join(wsDir, ".arbws/config.json"), "utf-8"));
      expect(config.base).toBe("develop");
    }));

  test("set mode changes from one base to another", () =>
    withEnv(async (env) => {
      const canonicalA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalA, ["checkout", "-b", "develop"]);
      await git(canonicalA, ["commit", "--allow-empty", "-m", "develop"]);
      await git(canonicalA, ["push", "origin", "develop"]);
      await git(canonicalA, ["checkout", "--detach"]);

      await arb(env, ["create", "my-feature", "--base", "develop", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "base", "release"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Base branch changed from develop to release");

      const config = JSON.parse(readFileSync(join(wsDir, ".arbws/config.json"), "utf-8"));
      expect(config.base).toBe("release");
    }));

  test("set mode rejects matching remote-qualified input", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "base", "origin/main"], { cwd: wsDir });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("includes the resolved base remote 'origin'");
      expect(result.output).toContain("Use 'main' instead");
    }));

  test("set mode still accepts slash-containing branch names", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "base", "feat/auth"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Base branch set to feat/auth");

      const config = JSON.parse(readFileSync(join(wsDir, ".arbws/config.json"), "utf-8"));
      expect(config.base).toBe("feat/auth");
    }));

  test("set mode rejects workspace's own branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "base", "my-feature"], { cwd: wsDir });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("workspace branch");
    }));

  test("set mode rejects invalid branch names", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "base", "..invalid"], { cwd: wsDir });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Invalid branch name");
    }));

  test("unset mode removes the base", () =>
    withEnv(async (env) => {
      const canonicalA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalA, ["checkout", "-b", "develop"]);
      await git(canonicalA, ["commit", "--allow-empty", "-m", "develop"]);
      await git(canonicalA, ["push", "origin", "develop"]);
      await git(canonicalA, ["checkout", "--detach"]);

      await arb(env, ["create", "my-feature", "--base", "develop", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "base", "--unset"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Base branch removed");

      const config = JSON.parse(readFileSync(join(wsDir, ".arbws/config.json"), "utf-8"));
      expect(config.base).toBeUndefined();
    }));

  test("unset mode with no base is a no-op", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "base", "--unset"], { cwd: wsDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already tracking repo default");
    }));

  test("unset with branch arg is an error", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");

      const result = await arb(env, ["branch", "base", "develop", "--unset"], { cwd: wsDir });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot combine");
    }));
});
