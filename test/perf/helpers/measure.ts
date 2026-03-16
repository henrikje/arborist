/**
 * Benchmark measurement utilities.
 *
 * Spawns the compiled arb binary with --debug, measures wall-clock time,
 * and parses git call count from the debug summary output.
 */

import { join, resolve } from "node:path";
import type { PerfEnv } from "./env";

const ARB_BIN = resolve(join(import.meta.dir, "../../../dist/arb"));

const TEST_ENV: Record<string, string> = {
  ...(process.env as Record<string, string>),
  NO_COLOR: "1",
  ARB_DEBUG: "1",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
};

// ── Types ────────────────────────────────────────────────────────

export interface BenchmarkResult {
  name: string;
  command: string[];
  runs: number;
  durationMs: number;
  durationMinMs: number;
  durationMaxMs: number;
  gitCalls: number | null;
  gitCallsMin: number | null;
  gitCallsMax: number | null;
  exitCode: number;
}

// ── Git call count parsing ───────────────────────────────────────

/** Parse the git call count from arb --debug stderr output. */
export function parseGitCallCount(stderr: string): number | null {
  // Format from src/index.ts printDebugSummary: "[debug] N git call(s) in Xs"
  const match = stderr.match(/(\d+) git (?:call|calls) in/);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

// ── Benchmark runner ─────────────────────────────────────────────

/** Run a single arb command and measure its performance. */
async function runOnce(
  args: string[],
  cwd: string,
): Promise<{ durationMs: number; gitCalls: number | null; exitCode: number }> {
  const start = performance.now();
  const proc = Bun.spawn([ARB_BIN, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: TEST_ENV,
  });
  const [, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  const durationMs = performance.now() - start;
  const exitCode = proc.exitCode ?? 1;
  const gitCalls = parseGitCallCount(stderr);
  return { durationMs, gitCalls, exitCode };
}

/** Pick the median value from a sorted array of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

/**
 * Benchmark an arb command: run it multiple times and report the median.
 *
 * @param env - The performance test environment
 * @param name - Human-readable benchmark name
 * @param args - Arguments to pass to arb (e.g., ["status", "-N"])
 * @param opts.cwd - Working directory (defaults to first workspace)
 * @param opts.runs - Number of iterations (default: 3)
 */
export async function benchmark(
  env: PerfEnv,
  name: string,
  args: string[],
  opts?: { cwd?: string; runs?: number },
): Promise<BenchmarkResult> {
  const cwd = opts?.cwd ?? env.projectDir;
  const runs = opts?.runs ?? 3;

  const durations: number[] = [];
  const gitCallCounts: number[] = [];
  let lastExitCode = 0;

  for (let i = 0; i < runs; i++) {
    const result = await runOnce(args, cwd);
    durations.push(result.durationMs);
    if (result.gitCalls !== null) {
      gitCallCounts.push(result.gitCalls);
    }
    lastExitCode = result.exitCode;
  }

  return {
    name,
    command: args,
    runs,
    durationMs: Math.round(median(durations)),
    durationMinMs: Math.round(Math.min(...durations)),
    durationMaxMs: Math.round(Math.max(...durations)),
    gitCalls: gitCallCounts.length > 0 ? median(gitCallCounts) : null,
    gitCallsMin: gitCallCounts.length > 0 ? Math.min(...gitCallCounts) : null,
    gitCallsMax: gitCallCounts.length > 0 ? Math.max(...gitCallCounts) : null,
    exitCode: lastExitCode,
  };
}
