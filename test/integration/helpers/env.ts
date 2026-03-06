/**
 * Integration test environment.
 *
 * Each test gets a fresh temporary directory with:
 *   - An initialized arb root at `project/`
 *   - Two bare origin repos (`origin/repo-a.git`, `origin/repo-b.git`)
 *   - Clones in `.arb/repos/` with an initial commit pushed to origin
 */

import { realpathSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
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

// ── Git version detection ────────────────────────────────────────

interface GitVersion {
  major: number;
  minor: number;
  patch: number;
}

async function detectGitVersion(): Promise<GitVersion> {
  const proc = Bun.spawn(["git", "--version"], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  const match = stdout.match(/git version (\d+)\.(\d+)\.(\d+)/);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(`Could not parse git version from: ${stdout.trim()}`);
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

export const gitVersion = await detectGitVersion();
export const gitBelow230 = gitVersion.major < 2 || (gitVersion.major === 2 && gitVersion.minor < 30);
export const gitBelow238 = gitVersion.major < 2 || (gitVersion.major === 2 && gitVersion.minor < 38);

// ── Types ────────────────────────────────────────────────────────

export interface TestEnv {
  testDir: string;
  projectDir: string;
  originDir: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  /** Merged stdout + stderr */
  output: string;
  exitCode: number;
}

// ── Shell helpers ────────────────────────────────────────────────

/** Run a command, return stdout. Throws on non-zero exit. */
async function exec(cmd: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...TEST_ENV, ...opts.env },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (exit ${exitCode}): ${cmd.join(" ")}\nstderr: ${stderr}\nstdout: ${stdout}`);
  }
  return stdout;
}

/** Run a git command. Throws on non-zero exit. */
export async function git(cwd: string, args: string[]): Promise<string> {
  return exec(["git", ...args], { cwd });
}

/**
 * Initialize a bare repo with a specific default branch.
 *
 * `git init --bare -b <branch>` requires git 2.28+. This helper uses
 * plumbing commands to seed the branch with an empty commit so that
 * clones see the correct default branch on any git version.
 */
export async function initBareRepo(cwd: string, path: string, branch: string): Promise<void> {
  await git(cwd, ["init", "--bare", path]);
  await git(path, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  const tree = (await git(path, ["hash-object", "-w", "-t", "tree", "/dev/null"])).trim();
  const commit = (await git(path, ["commit-tree", tree, "-m", "init (bootstrap)"])).trim();
  await git(path, ["update-ref", `refs/heads/${branch}`, commit]);
}

/**
 * Run an arb command and capture output. Does NOT throw on non-zero exit.
 * Check `result.exitCode` in assertions.
 */
export async function arb(env: TestEnv, args: string[], opts?: { cwd?: string }): Promise<RunResult> {
  const proc = Bun.spawn([ARB_BIN, ...args], {
    cwd: opts?.cwd ?? env.projectDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...TEST_ENV },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { stdout, stderr, output: stdout + stderr, exitCode };
}

/** Convenience: write a file (creating parent dirs as needed). */
export async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
}

// ── Environment lifecycle ────────────────────────────────────────

/** Create a fresh test environment. */
export async function createTestEnv(): Promise<TestEnv> {
  const testDir = realpathSync(await mkdtemp(join(tmpdir(), "arb-test-")));
  const projectDir = join(testDir, "project");
  const originDir = join(testDir, "origin");

  await mkdir(projectDir, { recursive: true });

  // Initialize arb root
  await exec([ARB_BIN, "init"], { cwd: projectDir });

  // Create bare origin repos and clone into .arb/repos/
  for (const name of ["repo-a", "repo-b"]) {
    await initBareRepo(testDir, join(originDir, `${name}.git`), "main");
    await git(testDir, ["clone", join(originDir, `${name}.git`), join(projectDir, `.arb/repos/${name}`)]);
    const repoDir = join(projectDir, `.arb/repos/${name}`);
    await git(repoDir, ["commit", "--allow-empty", "-m", "init"]);
    await git(repoDir, ["push"]);
  }

  return { testDir, projectDir, originDir };
}

/** Remove the test environment. */
export async function cleanupTestEnv(env: TestEnv): Promise<void> {
  await rm(env.testDir, { recursive: true, force: true });
}

// ── Test helper utilities ────────────────────────────────────────

/** Set up a forked repo with upstream + origin (fork) remotes. */
export async function setupForkRepo(env: TestEnv, name: string): Promise<void> {
  const upstreamDir = join(env.testDir, "upstream", `${name}.git`);
  const forkDir = join(env.testDir, "fork", `${name}.git`);
  const repoDir = join(env.projectDir, ".arb/repos", name);

  // Create upstream bare repo with initial commit
  await mkdir(join(env.testDir, "upstream"), { recursive: true });
  await initBareRepo(env.testDir, upstreamDir, "main");
  const tmpClone = join(env.testDir, `tmp-${name}`);
  await git(env.testDir, ["clone", upstreamDir, tmpClone]);
  await git(tmpClone, ["commit", "--allow-empty", "-m", "init"]);
  await git(tmpClone, ["push"]);
  await rm(tmpClone, { recursive: true });

  // Create fork by cloning upstream
  await mkdir(join(env.testDir, "fork"), { recursive: true });
  await git(env.testDir, ["clone", "--bare", upstreamDir, forkDir]);

  // Remove existing repo (from setup)
  await rm(repoDir, { recursive: true, force: true });

  // Clone fork as origin into .arb/repos/
  await git(env.testDir, ["clone", forkDir, repoDir]);

  // Add upstream remote and configure
  await git(repoDir, ["remote", "add", "upstream", upstreamDir]);
  await git(repoDir, ["config", "remote.pushDefault", "origin"]);
  await git(repoDir, ["fetch", "upstream"]);
  await git(repoDir, ["remote", "set-head", "upstream", "--auto"]);
}

/** Push a commit then delete the remote branch (simulates GitHub post-merge delete). */
export async function pushThenDeleteRemote(env: TestEnv, ws: string, repo: string): Promise<void> {
  const wt = join(env.projectDir, ws, repo);
  await writeFile(join(wt, "file.txt"), "change");
  await git(wt, ["add", "file.txt"]);
  await git(wt, ["commit", "-m", "feature work"]);
  await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, ws) });

  // Delete branch on bare remote
  await git(join(env.originDir, `${repo}.git`), ["branch", "-D", ws]);
  // Prune local tracking refs
  await git(join(env.projectDir, ".arb/repos", repo), ["fetch", "--prune"]);
}

/** Fetch all repos in .arb/repos/ (mirrors `fetch_all_repos()`). */
export async function fetchAllRepos(env: TestEnv): Promise<void> {
  const reposDir = join(env.projectDir, ".arb/repos");
  const entries = await readdir(reposDir);
  for (const entry of entries) {
    const repoDir = join(reposDir, entry);
    try {
      await git(repoDir, ["fetch", "--prune"]);
    } catch {
      // Ignore fetch failures
    }
  }
}

/** Delete a workspace's config file. */
export async function deleteWorkspaceConfig(env: TestEnv, name: string): Promise<void> {
  await rm(join(env.projectDir, name, ".arbws/config"), { force: true });
}

/** Run a test body with a fresh, isolated TestEnv that is cleaned up afterwards. */
export async function withEnv(fn: (env: TestEnv) => Promise<void>): Promise<void> {
  const env = await createTestEnv();
  try {
    await fn(env);
  } finally {
    await cleanupTestEnv(env);
  }
}
