import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, withEnv } from "./helpers/env";

// ── repo default ────────────────────────────────────────────────

describe("repo default", () => {
  test("arb repo default with no defaults shows hint", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "default"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.output).toContain("No default repos configured");
    }));

  test("arb repo default adds repos to defaults", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "default", "repo-a"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Added");

      const config = await readFile(join(env.projectDir, ".arb/config.json"), "utf8");
      expect(JSON.parse(config).defaults).toEqual(["repo-a"]);
    }));

  test("arb repo default adds multiple repos", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a", "repo-b"]);

      const config = await readFile(join(env.projectDir, ".arb/config.json"), "utf8");
      expect(JSON.parse(config).defaults).toEqual(["repo-a", "repo-b"]);
    }));

  test("arb repo default incrementally adds repos", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a"]);
      await arb(env, ["repo", "default", "repo-b"]);

      const config = await readFile(join(env.projectDir, ".arb/config.json"), "utf8");
      expect(JSON.parse(config).defaults).toEqual(["repo-a", "repo-b"]);
    }));

  test("arb repo default skips already-added repos", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a"]);
      const result = await arb(env, ["repo", "default", "repo-a"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already");

      const config = await readFile(join(env.projectDir, ".arb/config.json"), "utf8");
      const parsed = JSON.parse(config);
      expect(parsed.defaults).toEqual(["repo-a"]);
      // Should not have duplicates
      expect(parsed.defaults.filter((r: string) => r === "repo-a").length).toBe(1);
    }));

  test("arb repo default lists current defaults", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a", "repo-b"]);
      const result = await arb(env, ["repo", "default"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("repo-a\nrepo-b\n");
    }));

  test("arb repo default --remove removes repos from defaults", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a", "repo-b"]);
      const result = await arb(env, ["repo", "default", "--remove", "repo-a"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Removed");

      const config = await readFile(join(env.projectDir, ".arb/config.json"), "utf8");
      expect(JSON.parse(config).defaults).toEqual(["repo-b"]);
    }));

  test("arb repo default rejects unknown repos", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "default", "nonexistent"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not cloned");
    }));

  test("arb repo default --remove with no names fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "default", "--remove"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No repos specified");
    }));

  test("arb repo default --remove rejects repos not in defaults", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a"]);
      const result = await arb(env, ["repo", "default", "--remove", "repo-b"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not a default");
    }));
});

// ── create with defaults ────────────────────────────────────────

describe("create with defaults", () => {
  test("arb create uses defaults when no repos specified in non-TTY", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a"]);
      const result = await arb(env, ["create", "my-feature"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(false);
    }));

  test("arb create with defaults uses all default repos", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a", "repo-b"]);
      const result = await arb(env, ["create", "my-feature"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
    }));

  test("arb create with explicit repos ignores defaults", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a"]);
      const result = await arb(env, ["create", "my-feature", "repo-b"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(false);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
    }));

  test("arb create with --all-repos ignores defaults", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a"]);
      const result = await arb(env, ["create", "my-feature", "--all-repos"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
    }));

  test("arb create defaults filter out removed repos", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a", "repo-b"]);
      await arb(env, ["repo", "remove", "repo-b", "--yes"]);
      const result = await arb(env, ["create", "my-feature"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
    }));
});

// ── create --yes ────────────────────────────────────────────────

describe("create --yes", () => {
  test("arb create --yes uses default repos", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a"]);
      const result = await arb(env, ["create", "my-feature", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(false);
    }));

  test("arb create -y uses default repos", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a", "repo-b"]);
      const result = await arb(env, ["create", "my-feature", "-y"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
    }));

  test("arb create --yes fails when no defaults configured", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "my-feature", "--yes"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No default repos configured");
    }));

  test("arb create --yes with no name fails", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a"]);
      const result = await arb(env, ["create", "--yes"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Usage:");
    }));

  test("arb create --yes with explicit repos ignores defaults", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a"]);
      const result = await arb(env, ["create", "my-feature", "repo-b", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(false);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
    }));

  test("arb create --yes with --all-repos includes all repos", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a"]);
      const result = await arb(env, ["create", "my-feature", "--yes", "--all-repos"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
    }));
});

// ── repo remove leaves defaults unchanged ────────────────────────

describe("repo remove leaves defaults unchanged", () => {
  test("arb repo remove does not remove repo from defaults", () =>
    withEnv(async (env) => {
      await arb(env, ["repo", "default", "repo-a", "repo-b"]);
      await arb(env, ["repo", "remove", "repo-a", "--yes"]);

      const result = await arb(env, ["repo", "default"]);
      expect(result.stdout).toBe("repo-a\nrepo-b\n");
    }));
});
