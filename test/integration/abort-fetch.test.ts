import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { arb, withEnv } from "./helpers/env";

// ── escape-to-cancel background fetch ────────────────────────────

describe("escape-to-cancel background fetch", () => {
  test("arb status --no-fetch produces output without fetching", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
    }));

  test("arb list --no-fetch produces output without fetching", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["list", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("my-feature");
    }));

  test("arb status piped to cat produces clean output", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const proc = Bun.spawn(["bash", "-c", `'${join(import.meta.dir, "../../dist/arb")}' status | cat`], {
        cwd: join(env.projectDir, "my-feature"),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NO_COLOR: "1" },
      });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const exitCode = await proc.exited;
      const output = stdout + stderr;
      expect(exitCode).toBe(0);
      expect(output).toContain("repo-a");
      expect(output).not.toContain("<Esc to cancel>");
    }));

  test("arb list piped to cat produces clean output", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const proc = Bun.spawn(["bash", "-c", `'${join(import.meta.dir, "../../dist/arb")}' list | cat`], {
        cwd: join(env.projectDir, "my-feature"),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NO_COLOR: "1" },
      });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const exitCode = await proc.exited;
      const output = stdout + stderr;
      expect(exitCode).toBe(0);
      expect(output).toContain("my-feature");
      expect(output).not.toContain("<Esc to cancel>");
    }));

  test("arb status with piped stdin still works", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const proc = Bun.spawn(
        ["bash", "-c", `echo "repo-a" | '${join(import.meta.dir, "../../dist/arb")}' status --no-fetch`],
        {
          cwd: join(env.projectDir, "my-feature"),
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, NO_COLOR: "1" },
        },
      );
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const exitCode = await proc.exited;
      const output = stdout + stderr;
      expect(exitCode).toBe(0);
      expect(output).toContain("repo-a");
      expect(output).not.toContain("repo-b");
    }));

  test("arb branch --verbose --no-fetch produces output", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "--verbose", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
    }));
});
