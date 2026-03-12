/**
 * Property-based test: arb status --json accuracy.
 *
 * Each run creates a single workspace, then generates a random sequence of
 * state-changing operations (make commits, push, advance base, external share
 * commits) interspersed with status checks. Every CheckStatus asserts that
 * `arb status --json` matches the lightweight model's predictions.
 */

import { describe, test } from "bun:test";
import { realpathSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { type TestEnv, arb, cleanupTestEnv, createTestEnv } from "../integration/helpers/env";
import { CheckStatus, MakeCommit, MakeCommitOnBase, MakeCommitOnShare, Push } from "./helpers/commands";
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

const COMMIT_COUNT = fc.integer({ min: 1, max: 4 });

function buildCommandArbitraries() {
  return [
    // MakeCommit — pick repo + count
    fc
      .tuple(fc.constantFrom(...REPOS), COMMIT_COUNT)
      .map(([repo, n]) => new MakeCommit(repo, n)),

    // Push — no parameters
    fc.constant(new Push()),

    // MakeCommitOnBase — pick repo + count
    fc
      .tuple(fc.constantFrom(...REPOS), COMMIT_COUNT)
      .map(([repo, n]) => new MakeCommitOnBase(repo, n)),

    // MakeCommitOnShare — pick repo + count
    fc
      .tuple(fc.constantFrom(...REPOS), COMMIT_COUNT)
      .map(([repo, n]) => new MakeCommitOnShare(repo, n)),

    // CheckStatus — no parameters (weighted 2x for better coverage)
    fc.constant(new CheckStatus()),
    fc.constant(new CheckStatus()),
  ];
}

// ── Single run ───────────────────────────────────────────────────

async function runOnce(seed: number): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.commands(buildCommandArbitraries(), { size: "small" }), async (cmds) => {
      const env = await createEnvFromTemplate();
      try {
        const result = await arb(env, ["create", WS_NAME, ...REPOS]);
        if (result.exitCode !== 0) {
          throw new Error(`arb create failed: ${result.output}`);
        }

        const model: WorkspaceModel = freshWorkspaceModel([...REPOS]);
        const real: RealSystem = { env, wsName: WS_NAME, commitCounter: 0, executedCommands: [] };

        await fc.asyncModelRun(() => ({ model, real }), cmds);

        if (model.dirty) {
          const finalCheck = new CheckStatus();
          await finalCheck.run(model, real);
        }

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
  test.each(runs)("%s", (_, seed) => runOnce(seed), { timeout: 30_000 });
});
