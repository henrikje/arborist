/**
 * Property-based test: arb status --json accuracy.
 *
 * Each run creates a single workspace, then generates a random sequence of
 * state-changing operations (make commits, push, rebase, advance base,
 * external share commits, dirty files). Every command asserts that
 * `arb status --json` matches the lightweight model's predictions after
 * its mutation, so every intermediate state is validated.
 */

import { describe, test } from "bun:test";
import { realpathSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { type TestEnv, arb, cleanupTestEnv, createTestEnv } from "../integration/helpers/env";
import { MakeCommit, MakeCommitOnBase, MakeCommitOnShare, MakeDirtyFile, Pull, Push, Rebase } from "./helpers/commands";
import { type RealSystem, type WorkspaceModel, freshWorkspaceModel } from "./helpers/model";

// ── Template ─────────────────────────────────────────────────────

let templateEnv: TestEnv | null = null;

async function getTemplate(): Promise<TestEnv> {
  if (!templateEnv) {
    templateEnv = await createTestEnv();
  }
  return templateEnv;
}

async function createEnvFromTemplate(): Promise<TestEnv> {
  const template = await getTemplate();
  const testDir = realpathSync(await mkdtemp(join(tmpdir(), "arb-pbt-")));
  await cp(template.testDir, testDir, { recursive: true });

  const projectDir = join(testDir, "project");
  const originDir = join(testDir, "origin");

  // Fix remote URLs in canonical repos
  await Promise.all(
    ["repo-a", "repo-b"].map(async (name) => {
      const configPath = join(projectDir, `.arb/repos/${name}/.git/config`);
      const content = await readFile(configPath, "utf-8");
      await writeFile(configPath, content.replaceAll(template.testDir, testDir));
    }),
  );

  return { testDir, projectDir, originDir };
}

// ── Constants ────────────────────────────────────────────────────

const REPOS = ["repo-a", "repo-b"] as const;
const WS_NAME = "test-ws";
const NUM_RUNS = 30;

// ── Command arbitraries ──────────────────────────────────────────

function buildCommandArbitraries() {
  // Gated commands (Push, Pull, Rebase, MakeCommitOnShare) are weighted higher
  // because they often fail check() and get dropped. Extra copies ensure they
  // survive filtering often enough to produce interesting sequences.
  return [
    fc.constantFrom(...REPOS).map((repo) => new MakeCommit(repo)),
    fc.constant(new Push()),
    fc.constant(new Push()),
    fc.constant(new Push()),
    fc.constant(new Pull()),
    fc.constant(new Pull()),
    fc.constant(new Pull()),
    fc.constant(new Rebase()),
    fc.constant(new Rebase()),
    fc.constantFrom(...REPOS).map((repo) => new MakeCommitOnBase(repo)),
    fc.constantFrom(...REPOS).map((repo) => new MakeCommitOnShare(repo)),
    fc.constantFrom(...REPOS).map((repo) => new MakeCommitOnShare(repo)),
    fc
      .tuple(fc.constantFrom(...REPOS), fc.constantFrom("untracked" as const, "staged" as const))
      .map(([repo, kind]) => new MakeDirtyFile(repo, kind)),
  ];
}

// ── Single run ───────────────────────────────────────────────────

async function runOnce(seed: number): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.commands(buildCommandArbitraries(), { size: "+1", maxCommands: 30 }), async (cmds) => {
      const env = await createEnvFromTemplate();
      try {
        const result = await arb(env, ["create", WS_NAME, ...REPOS]);
        if (result.exitCode !== 0) {
          throw new Error(`arb create failed: ${result.output}`);
        }

        const model: WorkspaceModel = freshWorkspaceModel([...REPOS]);
        const real: RealSystem = { env, wsName: WS_NAME, commitCounter: 0, executedCommands: [] };

        await fc.asyncModelRun(() => ({ model, real }), cmds);

        console.log(`    ${real.executedCommands.join(", ")}`);
      } finally {
        await cleanupTestEnv(env);
      }
    }),
    { numRuns: 1, seed, endOnFailure: true },
  );
}

// ── Property tests ───────────────────────────────────────────────

// Use a master seed so the full suite is reproducible
const masterSeed = Math.floor(Math.random() * 2 ** 31);
console.log(`PBT master seed: ${masterSeed}`);

const runs = Array.from({ length: NUM_RUNS }, (_, i) => {
  const seed = (masterSeed + i) | 0;
  return [`run ${i + 1} (seed ${seed})`, seed] as const;
});

describe("PBT: status model", () => {
  test.each(runs)("%s", (_, seed) => runOnce(seed), { timeout: 120_000 });
});
