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

  test("arb -v is not a version alias", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["-v"]);
      expect(result.exitCode).not.toBe(0);
    }));
});

// ── bare arb (basic help) ────────────────────────────────────────

describe("bare arb (basic help)", () => {
  test("shows usage line", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      expect(result.output).toContain("Usage:");
    }));

  test("shows core commands: help, init, repo, create, delete, list, status", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      for (const cmd of ["help", "init", "repo", "create", "delete", "list", "status"]) {
        expect(result.output).toContain(cmd);
      }
    }));

  test("shows sync commands: push, pull, rebase, merge", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      for (const cmd of ["push", "pull", "rebase", "merge"]) {
        expect(result.output).toContain(cmd);
      }
    }));

  test("shows exec command", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      expect(result.output).toContain("exec");
    }));

  test("omits advanced commands: template, rename, path, cd, attach, detach, branch, log, diff, reset, open", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      for (const cmd of ["template", "rename", "attach", "detach", "branch", "log", "diff", "reset", "open"]) {
        expect(result.output).not.toContain(`  ${cmd} `);
      }
    }));

  test("omits help topics section", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      expect(result.output).not.toContain("Help Topics:");
    }));

  test("omits options section", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      expect(result.output).not.toContain("Options:");
    }));

  test("omits etymology and URL", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      expect(result.output).not.toContain("arborist (noun)");
      expect(result.output).not.toContain("github.com/henrikje/arborist");
    }));

  test("indicates this is a subset of commands", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      expect(result.output).toContain("These are common arb commands");
    }));

  test("shows simplified group names", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      expect(result.output).toContain("Getting Started:");
      expect(result.output).toContain("Workspaces:");
      expect(result.output).toContain("Synchronization:");
      expect(result.output).toContain("Execution:");
      expect(result.output).not.toContain("Setup Commands:");
      expect(result.output).not.toContain("Workspace Commands:");
    }));

  test("shows footer pointing to --help", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      expect(result.output).toContain("arb --help");
    }));

  test("writes to stderr (not stdout)", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      expect(result.stderr).toContain("Usage:");
      expect(result.stdout).toBe("");
    }));

  test("exits with code 1", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, []);
      expect(result.exitCode).toBe(1);
    }));
});

// ── full help (--help, -h, help) ─────────────────────────────────

describe("full help", () => {
  test("arb --help shows all commands", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Usage:");
      for (const cmd of ["template", "rename", "attach", "detach", "branch", "log", "diff", "reset", "exec", "open"]) {
        expect(result.output).toContain(cmd);
      }
    }));

  test("arb --help shows help topics", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["--help"]);
      expect(result.output).toContain("Help Topics:");
      expect(result.output).toContain("where");
      expect(result.output).toContain("remotes");
      expect(result.output).toContain("stacked");
    }));

  test("arb --help shows options", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["--help"]);
      expect(result.output).toContain("Options:");
      expect(result.output).toContain("--version");
      expect(result.output).toContain("--debug");
    }));

  test("arb --help shows etymology and URL", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["--help"]);
      expect(result.output).toContain("arborist (noun)");
      expect(result.output).toContain("github.com/henrikje/arborist");
    }));

  test("arb --help uses full group names with descriptions", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["--help"]);
      expect(result.output).toContain("Setup Commands:");
      expect(result.output).toContain("Workspace Commands:");
      expect(result.output).toContain("Inspection Commands:");
      expect(result.output).toContain("Synchronization Commands:");
      expect(result.output).toContain("Execution Commands:");
    }));

  test("arb --help writes to stdout", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["--help"]);
      expect(result.stdout).toContain("Usage:");
    }));

  test("arb -h shows full help", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["-h"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Usage:");
      expect(result.output).toContain("Help Topics:");
      expect(result.output).toContain("Options:");
    }));

  test("arb help shows full help (same as --help)", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["help"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Usage:");
      expect(result.output).toContain("Help Topics:");
      expect(result.output).toContain("Options:");
      expect(result.output).toContain("template");
      expect(result.output).toContain("exec");
    }));

  test("arb help filtering shows filter syntax reference", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["help", "filtering"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("WHERE FILTER SYNTAX");
      expect(result.output).toContain("dirty");
      expect(result.output).toContain("ahead-share");
      expect(result.output).toContain("synced");
      expect(result.output).toContain("EXAMPLES");
    }));

  test("arb help status shows status command help", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["help", "status"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("arb status");
      expect(result.output).toContain("arb help filtering");
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
