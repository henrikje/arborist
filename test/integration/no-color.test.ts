import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { type TestEnv, arb, withEnv } from "./helpers/env";

const ARB_BIN = resolve(join(import.meta.dir, "../../dist/arb"));

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape codes
const ANSI_RE = /\x1b\[/;

/** Run arb with custom env vars. */
async function arbWithEnv(env: TestEnv, args: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
  const proc = Bun.spawn([ARB_BIN, ...args], {
    cwd: opts?.cwd ?? env.projectDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...opts?.env },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { stdout, stderr, output: stdout + stderr, exitCode };
}

// ── NO_COLOR ────────────────────────────────────────────────────

describe("NO_COLOR", () => {
  test("arb status produces no ANSI codes when NO_COLOR is set", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-color", "-a"]);
      const result = await arbWithEnv(env, ["status", "--no-fetch"], {
        cwd: join(env.projectDir, "ws-color"),
        env: { NO_COLOR: "1" },
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toMatch(ANSI_RE);
    }));

  test("NO_COLOR set to empty string also disables color", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-color-empty", "-a"]);
      const result = await arbWithEnv(env, ["status", "--no-fetch"], {
        cwd: join(env.projectDir, "ws-color-empty"),
        env: { NO_COLOR: "" },
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toMatch(ANSI_RE);
    }));
});

// ── TERM=dumb ───────────────────────────────────────────────────

describe("TERM=dumb", () => {
  test("arb status produces no ANSI codes when TERM=dumb", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-dumb", "-a"]);
      const { NO_COLOR: _, ...envWithoutNoColor } = process.env as Record<string, string>;
      const result = await arbWithEnv(env, ["status", "--no-fetch"], {
        cwd: join(env.projectDir, "ws-dumb"),
        env: { ...envWithoutNoColor, TERM: "dumb" },
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toMatch(ANSI_RE);
    }));
});
