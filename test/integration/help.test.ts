import { describe, expect, test } from "bun:test";
import { arb, withBareEnv } from "./helpers/env";

// ── version & help ───────────────────────────────────────────────

describe("version & help", () => {
  test("arb --version outputs version number", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["--version"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toMatch(/^Arborist (dev\.[0-9a-f]+|[0-9]+\.[0-9]+\.[0-9]+)/);
    }));

  test("arb version is treated as unknown command", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["version"]);
      expect(result.exitCode).not.toBe(0);
    }));

  test("arb -v outputs version number", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["-v"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toMatch(/^Arborist (dev\.[0-9a-f]+|[0-9]+\.[0-9]+\.[0-9]+)/);
    }));
});

// ── bare arb (shows help) ────────────────────────────────────────

describe("bare arb (shows help)", () => {
  test("bare arb shows help with usage and commands", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      expect(result.output).toContain("Usage:");
      expect(result.output).toContain("Commands:");
    }));
});

// ── help ──────────────────────────────────────────────────────────

describe("help", () => {
  test("arb help shows full usage text", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["help"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Usage:");
      expect(result.output).toContain("repo");
    }));

  test("arb --help shows usage", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Usage:");
    }));

  test("arb -h shows usage", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["-h"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Usage:");
    }));

  test("arb help where shows filter syntax reference", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["help", "where"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("WHERE FILTER SYNTAX");
      expect(result.output).toContain("dirty");
      expect(result.output).toContain("unpushed");
      expect(result.output).toContain("synced");
      expect(result.output).toContain("EXAMPLES");
    }));

  test("arb help status shows status command help", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["help", "status"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("arb status");
      expect(result.output).toContain("arb help where");
    }));

  test("arb delete --help shows newer-than option", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["delete", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("--newer-than <duration>");
    }));

  test("arb help remotes shows remote roles reference", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["help", "remotes"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("REMOTE ROLES");
    }));

  test("arb help stacked shows stacked workspaces reference", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["help", "stacked"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("STACKED WORKSPACES");
    }));

  test("arb help templates shows template reference", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["help", "templates"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("TEMPLATE");
    }));

  test("arb help scripting shows scripting reference", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["help", "scripting"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("SCRIPTING");
    }));

  test("arb help nonexistent shows error", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["help", "nonexistent"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Unknown command or topic");
    }));

  test("unknown command shows error", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["nonsense"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("unknown command");
    }));

  test("commands outside project fail with helpful message", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["list"], { cwd: "/tmp" });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not inside a project");
    }));
});
