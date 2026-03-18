import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { arb, withEnv } from "./helpers/env";

const ARB_BIN = join(import.meta.dir, "../../dist/arb");

/** Run arb with custom env vars merged into the base test env. */
function arbWithEnv(
  cwd: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; output: string; exitCode: number }> {
  const proc = Bun.spawn([ARB_BIN, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  return Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]).then(
    ([stdout, stderr, exitCode]) => ({ stdout, stderr, output: stdout + stderr, exitCode }),
  );
}

describe("ARB_NO_FETCH environment variable", () => {
  test("ARB_NO_FETCH suppresses fetch in arb status", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");
      const result = await arbWithEnv(wsDir, ["status"], { ARB_NO_FETCH: "1" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("Fetching");
    }));

  test("ARB_NO_FETCH accepts any non-empty value", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");
      const result = await arbWithEnv(wsDir, ["status"], { ARB_NO_FETCH: "yes" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("Fetching");
    }));

  test("explicit --fetch overrides ARB_NO_FETCH", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");
      const result = await arbWithEnv(wsDir, ["status", "--fetch"], { ARB_NO_FETCH: "1" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
    }));

  test("ARB_NO_FETCH suppresses fetch in arb list", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsDir = join(env.projectDir, "my-feature");
      const result = await arbWithEnv(wsDir, ["list"], { ARB_NO_FETCH: "1" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("my-feature");
      expect(result.output).not.toContain("Fetching");
    }));
});
