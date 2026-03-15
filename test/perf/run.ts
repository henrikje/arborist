/**
 * Performance benchmark runner for Arborist.
 *
 * Creates a scaled test environment and measures key command latencies.
 *
 * Usage:
 *   bun run test:perf                    # build + run benchmarks
 *   bun run test/perf/run.ts             # run without rebuilding
 *   bun run test/perf/run.ts > out.json  # capture JSON for comparison
 */

import { join } from "node:path";
import { type PerfEnv, type PerfEnvConfig, cleanupPerfEnv, createPerfEnv } from "./helpers/env";
import { type BenchmarkResult, benchmark } from "./helpers/measure";

// ── Report formatting ────────────────────────────────────────────

interface PerfReport {
  timestamp: string;
  environment: PerfEnvConfig;
  benchmarks: BenchmarkResult[];
}

function formatSummary(report: PerfReport): string {
  const { repos, commitsPerRepo, workspaces } = report.environment;
  const lines: string[] = [
    "",
    `Performance (${repos} repos, ${commitsPerRepo} commits/repo, ${workspaces} workspaces)`,
    "",
  ];

  const nameWidth = Math.max(...report.benchmarks.map((b) => b.name.length));

  for (const b of report.benchmarks) {
    const name = b.name.padEnd(nameWidth);
    const duration = `${b.durationMs} ms`.padStart(8);
    const gitCalls = b.gitCalls !== null ? `${b.gitCalls} git calls`.padStart(15) : "";
    const status = b.exitCode === 0 ? "" : ` [exit ${b.exitCode}]`;
    lines.push(`  ${name}  ${duration}  ${gitCalls}${status}`);
  }

  lines.push("");
  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stderr.write("\nSetting up performance test environment...\n");
  const setupStart = performance.now();
  let env: PerfEnv | undefined;

  try {
    env = await createPerfEnv();
    const setupMs = Math.round(performance.now() - setupStart);
    process.stderr.write(`  Setup complete in ${setupMs} ms\n\n`);

    process.stderr.write("Running benchmarks...\n");
    const results: BenchmarkResult[] = [];

    // The first workspace with state variations is the most representative
    const firstWs = env.workspaceNames[0];
    if (!firstWs) throw new Error("No workspaces created");
    const statusWs = join(env.projectDir, firstWs);

    // Benchmark 1: arb status --no-fetch
    process.stderr.write("  status -N...\n");
    results.push(await benchmark(env, "status -N", ["status", "--no-fetch"], { cwd: statusWs }));

    // Benchmark 2: arb list --no-fetch
    process.stderr.write("  list -N...\n");
    results.push(await benchmark(env, "list -N", ["list", "--no-fetch"]));

    // Benchmark 3: arb create (new workspace with all repos)
    // Only run once — creates a new workspace each time
    process.stderr.write("  create --all -N...\n");
    results.push(
      await benchmark(env, "create --all -N", ["create", "perf-tmp", "--all-repos", "--no-fetch", "--yes"], {
        runs: 1,
      }),
    );

    // Benchmark 4: arb status --no-fetch --json
    process.stderr.write("  status -N --json...\n");
    results.push(await benchmark(env, "status -N --json", ["status", "--no-fetch", "--json"], { cwd: statusWs }));

    // Build report
    const report: PerfReport = {
      timestamp: new Date().toISOString(),
      environment: env.config,
      benchmarks: results,
    };

    // Human-readable summary to stderr
    process.stderr.write(formatSummary(report));

    // JSON to stdout (for piping to file)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    // Check for failures
    const failed = results.filter((r) => r.exitCode !== 0);
    if (failed.length > 0) {
      process.stderr.write(`\n${failed.length} benchmark(s) failed (non-zero exit code)\n`);
      process.exit(1);
    }
  } finally {
    if (env) {
      process.stderr.write("Cleaning up...\n");
      await cleanupPerfEnv(env);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`\nFatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
