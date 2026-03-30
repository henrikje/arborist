import { describe, expect, test } from "bun:test";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { arb, type TestEnv, withEnv } from "./helpers/env";

const ARB_BIN = resolve(join(import.meta.dir, "../../dist/arb"));

/** Resolve the real git binary path so the wrapper can delegate to it. */
const REAL_GIT = Bun.spawnSync(["which", "git"]).stdout.toString().trim();

/** Run arb with extra env vars (needed for ARB_GIT_TIMEOUT + PATH override). */
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

/**
 * Create a git wrapper script that hangs (exec sleep) when any argument
 * contains the given substring, and delegates to the real git otherwise.
 * Returns the directory containing the wrapper (prepend to PATH) and a cleanup function.
 */
async function createHangingGitWrapper(
  matchSubstring: string,
): Promise<{ binDir: string; cleanup: () => Promise<void> }> {
  const binDir = join(tmpdir(), `arb-git-hang-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(binDir, { recursive: true });
  const script = join(binDir, "git");
  await writeFile(
    script,
    `#!/bin/bash
for arg in "$@"; do
  if [[ "$arg" == *"${matchSubstring}"* ]]; then
    exec sleep 60
  fi
done
exec ${REAL_GIT} "$@"
`,
  );
  await chmod(script, 0o755);
  return { binDir, cleanup: () => rm(binDir, { recursive: true, force: true }) };
}

// ── local git timeout ─────────────────────────────────────────────

describe("local git timeout", () => {
  test(
    "arb status surfaces timed-out repo when git hangs",
    () =>
      withEnv(async (env) => {
        await arb(env, ["create", "timeout-ws", "--all-repos"]);
        const { binDir, cleanup } = await createHangingGitWrapper("/timeout-ws/repo-a");
        try {
          const result = await arbWithEnv(env, ["--debug", "status", "--no-fetch", "--json"], {
            cwd: join(env.projectDir, "timeout-ws"),
            env: { ARB_GIT_TIMEOUT: "1", PATH: `${binDir}:${process.env.PATH}` },
          });

          const json = JSON.parse(result.stdout);
          const repoA = json.repos.find((r: { name: string }) => r.name === "repo-a");
          expect(repoA.timedOut).toBe(true);

          const repoB = json.repos.find((r: { name: string }) => r.name === "repo-b");
          expect(repoB.timedOut).toBeUndefined();

          // Debug output shows exit code 124 for timed-out git calls
          expect(result.stderr).toContain("exit 124");
        } finally {
          await cleanup();
        }
      }),
    30_000,
  );
});
