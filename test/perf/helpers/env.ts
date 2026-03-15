/**
 * Performance test environment.
 *
 * Creates a scaled arb project with many repos, commits, and workspaces
 * for benchmarking command performance under load.
 */

import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ARB_BIN = resolve(join(import.meta.dir, "../../../dist/arb"));

/** Base env vars for all spawned processes — disables commit signing and color. */
const TEST_ENV: Record<string, string> = {
  ...(process.env as Record<string, string>),
  NO_COLOR: "1",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
};

// ── Types ────────────────────────────────────────────────────────

export interface PerfEnvConfig {
  repos: number;
  commitsPerRepo: number;
  workspaces: number;
}

export interface PerfEnv {
  testDir: string;
  projectDir: string;
  originDir: string;
  repoNames: string[];
  workspaceNames: string[];
  config: PerfEnvConfig;
}

export const DEFAULT_CONFIG: PerfEnvConfig = {
  repos: 10,
  commitsPerRepo: 100,
  workspaces: 10,
};

// ── Shell helpers ────────────────────────────────────────────────

async function exec(cmd: string[], opts: { cwd: string }): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: TEST_ENV,
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (exit ${exitCode}): ${cmd.join(" ")}\nstderr: ${stderr}\nstdout: ${stdout}`);
  }
  return stdout;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return exec(["git", ...args], { cwd });
}

async function arb(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([ARB_BIN, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: TEST_ENV,
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

/**
 * Initialize a bare repo with a specific default branch.
 * Uses plumbing commands to work on any git version (2.17+).
 */
async function initBareRepo(cwd: string, path: string, branch: string): Promise<void> {
  await git(cwd, ["init", "--bare", path]);
  await git(path, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  const tree = (await git(path, ["hash-object", "-w", "-t", "tree", "/dev/null"])).trim();
  const commit = (await git(path, ["commit-tree", tree, "-m", "init (bootstrap)"])).trim();
  await git(path, ["update-ref", `refs/heads/${branch}`, commit]);
}

// ── Environment creation ─────────────────────────────────────────

function repoName(i: number): string {
  return `repo-${String(i + 1).padStart(2, "0")}`;
}

function workspaceName(i: number): string {
  return `ws-${String(i + 1).padStart(2, "0")}`;
}

/** Create a scaled performance test environment. */
export async function createPerfEnv(overrides?: Partial<PerfEnvConfig>): Promise<PerfEnv> {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const testDir = realpathSync(await mkdtemp(join(tmpdir(), "arb-perf-")));
  const projectDir = join(testDir, "project");
  const originDir = join(testDir, "origin");

  await mkdir(projectDir, { recursive: true });
  await mkdir(originDir, { recursive: true });

  const repoNames = Array.from({ length: config.repos }, (_, i) => repoName(i));
  const workspaceNames = Array.from({ length: config.workspaces }, (_, i) => workspaceName(i));

  // Phase 1: Initialize arb project
  process.stderr.write("  Setting up arb project...\n");
  await arb(projectDir, ["init"]);

  // Phase 2: Create bare origin repos with commit history (parallelized)
  process.stderr.write(`  Creating ${config.repos} origin repos with ${config.commitsPerRepo} commits each...\n`);
  await Promise.all(
    repoNames.map(async (name) => {
      const barePath = join(originDir, `${name}.git`);
      await initBareRepo(testDir, barePath, "main");

      // Clone, add commits, push
      const tmpClone = join(testDir, `tmp-${name}`);
      await git(testDir, ["clone", barePath, tmpClone]);

      // Create commits in batches using --allow-empty for speed
      for (let i = 0; i < config.commitsPerRepo; i++) {
        await git(tmpClone, [
          "-c",
          "user.name=Perf",
          "-c",
          "user.email=perf@test",
          "commit",
          "--allow-empty",
          "-m",
          `commit ${i + 1}: update ${name}`,
        ]);
      }
      await git(tmpClone, ["push"]);
      await rm(tmpClone, { recursive: true, force: true });
    }),
  );

  // Phase 3: Clone repos into .arb/repos/ (parallelized)
  process.stderr.write("  Cloning repos into .arb/repos/...\n");
  await Promise.all(
    repoNames.map(async (name) => {
      const barePath = join(originDir, `${name}.git`);
      const repoDir = join(projectDir, ".arb/repos", name);
      await git(testDir, ["clone", barePath, repoDir]);
    }),
  );

  // Phase 4: Create workspaces (sequential — arb create modifies shared state)
  process.stderr.write(`  Creating ${config.workspaces} workspaces...\n`);
  for (const wsName of workspaceNames) {
    const result = await arb(projectDir, ["create", wsName, "--all-repos", "--no-fetch", "--yes"]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create workspace ${wsName}: ${result.stderr}`);
    }
  }

  // Phase 5: Apply realistic state variations
  process.stderr.write("  Applying state variations...\n");
  await applyStateVariations(projectDir, originDir, repoNames, workspaceNames, config);

  return { testDir, projectDir, originDir, repoNames, workspaceNames, config };
}

/**
 * Apply realistic state variations to workspace repos:
 * - ~30% ahead of base (local commits)
 * - ~30% pushed to share remote
 * - ~30% behind base (origin/main advanced)
 * - ~10% share diverged (ahead + behind share)
 */
async function applyStateVariations(
  projectDir: string,
  originDir: string,
  repoNames: string[],
  workspaceNames: string[],
  config: PerfEnvConfig,
): Promise<void> {
  // Split workspaces into groups
  const aheadWs = workspaceNames.slice(0, Math.ceil(config.workspaces * 0.3));
  const pushedWs = workspaceNames.slice(Math.ceil(config.workspaces * 0.3), Math.ceil(config.workspaces * 0.6));
  // Workspaces in the 60-90% range are "behind base" — no per-workspace setup needed,
  // the behind-base state is applied at the repo level (origin/main advances).
  // Remaining workspaces (~10%) are the share divergence group.
  const divergedWs = workspaceNames.slice(Math.ceil(config.workspaces * 0.9));

  // Group 1: Ahead of base — add local commits
  for (const ws of aheadWs) {
    for (const repo of repoNames.slice(0, Math.ceil(repoNames.length * 0.5))) {
      const wtDir = join(projectDir, ws, repo);
      await writeFile(join(wtDir, "local-change.txt"), `change in ${ws}/${repo}`);
      await git(wtDir, ["add", "local-change.txt"]);
      await git(wtDir, ["-c", "user.name=Perf", "-c", "user.email=perf@test", "commit", "-m", "local work"]);
    }
  }

  // Group 2: Pushed to share remote
  for (const ws of pushedWs) {
    for (const repo of repoNames.slice(0, Math.ceil(repoNames.length * 0.5))) {
      const wtDir = join(projectDir, ws, repo);
      await writeFile(join(wtDir, "pushed-change.txt"), `pushed in ${ws}/${repo}`);
      await git(wtDir, ["add", "pushed-change.txt"]);
      await git(wtDir, ["-c", "user.name=Perf", "-c", "user.email=perf@test", "commit", "-m", "pushed work"]);
      await git(wtDir, ["push", "-u", "origin", ws]);
    }
  }

  // Group 3: Behind base — advance origin/main
  // Add commits to origin bare repos, then fetch in canonical clones
  const behindRepos = repoNames.slice(0, Math.ceil(repoNames.length * 0.5));
  for (const repo of behindRepos) {
    const barePath = join(originDir, `${repo}.git`);
    const tmpClone = join(projectDir, `.tmp-advance-${repo}`);
    await git(projectDir, ["clone", barePath, tmpClone]);
    for (let i = 0; i < 3; i++) {
      await git(tmpClone, [
        "-c",
        "user.name=Perf",
        "-c",
        "user.email=perf@test",
        "commit",
        "--allow-empty",
        "-m",
        `main advance ${i + 1}`,
      ]);
    }
    await git(tmpClone, ["push"]);
    await rm(tmpClone, { recursive: true, force: true });
    // Fetch in canonical clone so arb sees the new commits
    await git(join(projectDir, ".arb/repos", repo), ["fetch", "--prune"]);
  }

  // Group 4: Share diverged — push, then add more local commits (creates ahead+behind share)
  for (const ws of divergedWs) {
    for (const repo of repoNames.slice(0, Math.ceil(repoNames.length * 0.3))) {
      const wtDir = join(projectDir, ws, repo);
      // Push initial commit
      await writeFile(join(wtDir, "diverge-base.txt"), `diverge base in ${ws}/${repo}`);
      await git(wtDir, ["add", "diverge-base.txt"]);
      await git(wtDir, ["-c", "user.name=Perf", "-c", "user.email=perf@test", "commit", "-m", "diverge base"]);
      await git(wtDir, ["push", "-u", "origin", ws]);
      // Amend locally to create divergence (local HEAD differs from remote)
      await writeFile(join(wtDir, "diverge-local.txt"), `diverge local in ${ws}/${repo}`);
      await git(wtDir, ["add", "diverge-local.txt"]);
      await git(wtDir, [
        "-c",
        "user.name=Perf",
        "-c",
        "user.email=perf@test",
        "commit",
        "--amend",
        "-m",
        "diverged local work",
      ]);
    }
  }
}

/** Remove the performance test environment. */
export async function cleanupPerfEnv(env: PerfEnv): Promise<void> {
  await rm(env.testDir, { recursive: true, force: true });
}
