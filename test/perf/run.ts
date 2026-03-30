/**
 * Performance benchmark runner for Arborist.
 *
 * Creates scaled test environments at multiple tiers and measures key command
 * latencies to reveal scaling behavior.
 *
 * Usage:
 *   bun run test:perf                    # build + run benchmarks
 *   bun run test/perf/run.ts             # run without rebuilding
 *   bun run test/perf/run.ts > out.json  # capture JSON for comparison
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { cleanupPerfEnv, createPerfEnv, type PerfEnvConfig } from "./helpers/env";
import { type BenchmarkResult, benchmark } from "./helpers/measure";

// ── Scale tiers ──────────────────────────────────────────────────

interface ScaleTier {
  name: string;
  config: PerfEnvConfig;
}

const TIERS: ScaleTier[] = [
  { name: "small", config: { repos: 3, commitsPerRepo: 30, workspaces: 3 } },
  { name: "medium", config: { repos: 10, commitsPerRepo: 100, workspaces: 10 } },
  { name: "large", config: { repos: 20, commitsPerRepo: 200, workspaces: 15 } },
];

// ── Benchmark definitions ────────────────────────────────────────

interface BenchmarkDef {
  name: string;
  args: string[];
  cwd: "workspace" | "project";
  runs: number;
}

const BENCHMARKS: BenchmarkDef[] = [
  { name: "status -N", args: ["status", "--no-fetch"], cwd: "workspace", runs: 3 },
  { name: "list -N", args: ["list", "--no-fetch"], cwd: "project", runs: 3 },
  {
    name: "create --all -N",
    args: ["create", "perf-tmp", "--all-repos", "--no-fetch", "--yes"],
    cwd: "project",
    runs: 1,
  },
  { name: "status -N --json", args: ["status", "--no-fetch", "--json"], cwd: "workspace", runs: 3 },
];

// ── Types ────────────────────────────────────────────────────────

interface TierResult {
  tier: string;
  environment: PerfEnvConfig;
  setupMs: number;
  benchmarks: BenchmarkResult[];
}

interface PerfReport {
  timestamp: string;
  tiers: TierResult[];
}

// ── Report formatting ────────────────────────────────────────────

function tierLabel(tier: TierResult): string {
  const { repos, workspaces } = tier.environment;
  return `${tier.tier} (${repos}r/${workspaces}ws)`;
}

function formatScalingTable(report: PerfReport): string {
  const lines: string[] = ["", "Scaling comparison", ""];

  const benchNames = BENCHMARKS.map((b) => b.name);
  const nameWidth = Math.max(...benchNames.map((n) => n.length));
  const tierLabels = report.tiers.map(tierLabel);
  const colWidth = Math.max(...tierLabels.map((l) => l.length), 18);

  // Header
  lines.push(
    `  ${"".padEnd(nameWidth)}  ${tierLabels.map((l) => l.padStart(colWidth)).join("  ")}  ${"factor".padStart(8)}`,
  );
  lines.push(
    `  ${"".padEnd(nameWidth)}  ${tierLabels.map(() => "".padStart(colWidth, "-")).join("  ")}  ${"------".padStart(8)}`,
  );

  // Rows
  for (const benchName of benchNames) {
    const cells: string[] = [];
    let smallMs: number | null = null;
    let largeMs: number | null = null;

    for (const tier of report.tiers) {
      const result = tier.benchmarks.find((b) => b.name === benchName);
      if (result) {
        const ms = `${result.durationMs} ms`;
        const gitRange =
          result.gitCallsMin !== null && result.gitCallsMax !== null && result.gitCallsMin !== result.gitCallsMax
            ? ` (${result.gitCallsMin}..${result.gitCallsMax}gc)`
            : result.gitCalls !== null
              ? ` (${result.gitCalls}gc)`
              : "";
        cells.push(`${ms}${gitRange}`.padStart(colWidth));
        if (tier.tier === "small") smallMs = result.durationMs;
        if (tier.tier === "large") largeMs = result.durationMs;
      } else {
        cells.push("—".padStart(colWidth));
      }
    }

    const factor = smallMs && largeMs ? `${(largeMs / smallMs).toFixed(1)}x` : "—";
    lines.push(`  ${benchName.padEnd(nameWidth)}  ${cells.join("  ")}  ${factor.padStart(8)}`);
  }

  lines.push("");
  return lines.join("\n");
}

function formatTierSummary(tier: TierResult): string {
  const { repos, commitsPerRepo, workspaces } = tier.environment;
  const lines: string[] = [
    `  ${tier.tier}: ${repos} repos, ${commitsPerRepo} commits/repo, ${workspaces} workspaces (setup ${tier.setupMs} ms)`,
  ];

  for (const b of tier.benchmarks) {
    const duration = `${b.durationMs} ms`.padStart(8);
    const range = b.runs > 1 ? ` (${b.durationMinMs}..${b.durationMaxMs})` : "";
    const gitMedian = b.gitCalls !== null ? `  ${b.gitCalls} git calls` : "";
    const gitRange =
      b.runs > 1 && b.gitCallsMin !== null && b.gitCallsMax !== null && b.gitCallsMin !== b.gitCallsMax
        ? ` (${b.gitCallsMin}..${b.gitCallsMax})`
        : "";
    const status = b.exitCode === 0 ? "" : ` [exit ${b.exitCode}]`;
    lines.push(`    ${b.name.padEnd(20)}${duration}${range}${gitMedian}${gitRange}${status}`);
  }

  return lines.join("\n");
}

// ── Benchmark execution ──────────────────────────────────────────

async function runTier(tier: ScaleTier): Promise<TierResult> {
  process.stderr.write(
    `\n--- Tier: ${tier.name} (${tier.config.repos}r/${tier.config.workspaces}ws/${tier.config.commitsPerRepo}c) ---\n`,
  );

  const setupStart = performance.now();
  const env = await createPerfEnv(tier.config);
  const setupMs = Math.round(performance.now() - setupStart);
  process.stderr.write(`  Setup complete in ${setupMs} ms\n`);

  try {
    const firstWs = env.workspaceNames[0];
    if (!firstWs) throw new Error("No workspaces created");

    const results: BenchmarkResult[] = [];

    for (const def of BENCHMARKS) {
      // Clear analysis cache before each benchmark so iteration 1 is always cold
      await rm(join(env.projectDir, ".arb", "cache"), { recursive: true, force: true });
      process.stderr.write(`  ${def.name}...\n`);
      const cwd = def.cwd === "workspace" ? join(env.projectDir, firstWs) : env.projectDir;
      results.push(await benchmark(env, def.name, def.args, { cwd, runs: def.runs }));
    }

    return { tier: tier.name, environment: tier.config, setupMs, benchmarks: results };
  } finally {
    process.stderr.write("  Cleaning up...\n");
    await cleanupPerfEnv(env);
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stderr.write("\nArborist Performance Benchmarks\n");
  process.stderr.write(`Tiers: ${TIERS.map((t) => t.name).join(", ")}\n`);

  const tierResults: TierResult[] = [];

  for (const tier of TIERS) {
    const result = await runTier(tier);
    tierResults.push(result);

    // Print per-tier summary immediately
    process.stderr.write(`\n${formatTierSummary(result)}\n`);

    // Check for failures
    const failed = result.benchmarks.filter((r) => r.exitCode !== 0);
    if (failed.length > 0) {
      process.stderr.write(`  ${failed.length} benchmark(s) failed in ${tier.name} tier\n`);
    }
  }

  const report: PerfReport = {
    timestamp: new Date().toISOString(),
    tiers: tierResults,
  };

  // Scaling comparison table to stderr
  process.stderr.write(formatScalingTable(report));

  // JSON to stdout (for piping to file)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  // Exit with error if any benchmark failed
  const allFailed = tierResults.flatMap((t) => t.benchmarks).filter((b) => b.exitCode !== 0);
  if (allFailed.length > 0) {
    process.stderr.write(`\n${allFailed.length} total benchmark(s) failed (non-zero exit code)\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`\nFatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
