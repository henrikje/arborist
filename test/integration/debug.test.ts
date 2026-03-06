import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { type TestEnv, arb, withEnv } from "./helpers/env";

const ARB_BIN = resolve(join(import.meta.dir, "../../dist/arb"));

/** Run arb with extra env vars (needed for ARB_DEBUG). */
async function arbWithEnv(env: TestEnv, args: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
  const proc = Bun.spawn([ARB_BIN, ...args], {
    cwd: opts?.cwd ?? env.projectDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", ...opts?.env },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { stdout, stderr, output: stdout + stderr, exitCode };
}

// ── --debug flag ─────────────────────────────────────────────────

describe("--debug flag", () => {
  test("arb --debug status logs git calls to stderr", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "debug-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arb(env, ["--debug", "status", "--no-fetch"], {
        cwd: join(env.projectDir, "debug-ws/repo-a"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("[git]");
      expect(result.output).toContain("exit 0");
    }));

  test("arb --debug logs project root", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "debug-root-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arb(env, ["--debug", "status", "--no-fetch"], {
        cwd: join(env.projectDir, "debug-root-ws/repo-a"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("[debug]");
      expect(result.output).toContain("project:");
    }));

  test("arb --debug logs workspace", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "debug-ws-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arb(env, ["--debug", "status", "--no-fetch"], {
        cwd: join(env.projectDir, "debug-ws-ws/repo-a"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("workspace: debug-ws-ws");
    }));

  test("arb --debug prints git call count summary", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "debug-count-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arb(env, ["--debug", "status", "--no-fetch"], {
        cwd: join(env.projectDir, "debug-count-ws/repo-a"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("git call");
    }));
});

// ── ARB_DEBUG env var ────────────────────────────────────────────

describe("ARB_DEBUG env var", () => {
  test("ARB_DEBUG=1 activates debug output", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "debug-env-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arbWithEnv(env, ["status", "--no-fetch"], {
        cwd: join(env.projectDir, "debug-env-ws/repo-a"),
        env: { ARB_DEBUG: "1" },
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("[git]");
    }));
});

// ── debug off by default ────────────────────────────────────────

describe("debug off by default", () => {
  test("arb status without --debug does not log git calls", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "debug-off-ws", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arb(env, ["status", "--no-fetch"], {
        cwd: join(env.projectDir, "debug-off-ws/repo-a"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("[git]");
      expect(result.output).not.toContain("[debug]");
    }));
});

// ── debug on error paths ────────────────────────────────────────

describe("debug on error paths", () => {
  test("arb --debug prints summary even on error", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["--debug", "status"], { cwd: "/tmp" });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("git call");
    }));
});
