/**
 * Property-based testing commands for the status model.
 *
 * Each command implements fast-check's AsyncCommand interface:
 *   check(model) — returns true if preconditions are met
 *   run(model, real) — mutates real system, updates model, asserts status
 *   toString() — human-readable label for shrinking output
 *
 * Every command asserts `arb status --json` after mutating, so every
 * intermediate state is validated. Each command makes a single atomic
 * change so fast-check can shrink to the minimal failing sequence.
 *
 * All commands operate on a single pre-created workspace (name stored in RealSystem).
 */

import { expect } from "bun:test";
import { rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncCommand } from "fast-check";
import { arb, git, write } from "../../integration/helpers/env";
import { type RealSystem, type WorkspaceModel, predictRepoStatus } from "./model";

const REPOS = ["repo-a", "repo-b"] as const;

// ── Status assertion ────────────────────────────────────────────

/**
 * Fetch all repos then assert `arb status --json` matches the model.
 * Called after every command's mutation.
 */
export async function assertStatus(model: WorkspaceModel, real: RealSystem): Promise<void> {
  // Fetch first so status sees remote changes
  const reposDir = join(real.env.projectDir, ".arb/repos");
  await Promise.all(REPOS.map((r) => git(join(reposDir, r), ["fetch", "--prune"]).catch(() => {})));

  const result = await arb(real.env, ["status", "--no-fetch", "--json"], {
    cwd: join(real.env.projectDir, real.wsName),
  });
  if (result.exitCode !== 0) {
    throw new Error(`arb status --json failed: ${result.output}`);
  }

  const json = JSON.parse(result.stdout);

  for (const repoJson of json.repos) {
    const repoName: string = repoJson.name;
    const repoModel = model.repos[repoName];
    if (!repoModel) {
      throw new Error(`Unexpected repo in status output: ${repoName}`);
    }

    const predicted = predictRepoStatus(repoModel);

    // ── Base section ──
    expect(repoJson.base.ahead).toBe(predicted.baseAhead);
    expect(repoJson.base.behind).toBe(predicted.baseBehind);

    // ── Share section ──
    expect(repoJson.share.refMode).toBe(predicted.shareRefMode);
    expect(repoJson.share.toPush).toBe(predicted.shareToPush);
    expect(repoJson.share.toPull).toBe(predicted.shareToPull);

    if (predicted.shareRebased !== null) {
      expect(repoJson.share.rebased).toBe(predicted.shareRebased);
    }
    if (predicted.shareReplaced !== null) {
      expect(repoJson.share.replaced).toBe(predicted.shareReplaced);
    }
    if (predicted.shareSquashed !== null) {
      expect(repoJson.share.squashed).toBe(predicted.shareSquashed);
    }

    // ── Local section ──
    expect(repoJson.local.conflicts).toBe(predicted.localConflicts);
    expect(repoJson.local.staged).toBe(predicted.localStaged);
    expect(repoJson.local.modified).toBe(predicted.localModified);
    expect(repoJson.local.untracked).toBe(predicted.localUntracked);

    // ── Identity section ──
    expect(repoJson.identity.headMode.kind).toBe("attached");
    expect(repoJson.identity.headMode.branch).toBe(real.wsName);

    // ── Operation ──
    expect(repoJson.operation).toBeNull();

    // ── Flags (derived from workspace-level statusLabels) ──
    assertFlag(json, predicted.isDirty, "dirty");
    assertFlag(json, predicted.isUnpushed, "unpushed");
    assertFlag(json, predicted.needsPull, "behind share");
    assertFlag(json, predicted.needsRebase, "behind base");
    assertFlag(json, predicted.isDiverged, "diverged");
  }
}

/**
 * Assert a flag label is present in statusLabels when predicted true.
 *
 * statusLabels is workspace-level (not per-repo), so we can only check
 * that the label is present when at least one repo predicts it. We cannot
 * assert absence for a single repo since the other repo may have that flag.
 */
function assertFlag(json: { statusLabels: string[] }, expected: boolean, label: string): void {
  if (expected) {
    expect(json.statusLabels).toContain(label);
  }
}

// ── MakeCommit ───────────────────────────────────────────────────

export class MakeCommit implements AsyncCommand<WorkspaceModel, RealSystem> {
  readonly repoName: string;

  constructor(repoName: string) {
    this.repoName = repoName;
  }

  check(_model: Readonly<WorkspaceModel>): boolean {
    return true;
  }

  async run(model: WorkspaceModel, real: RealSystem): Promise<void> {
    real.executedCommands.push(this.toString());
    const worktree = join(real.env.projectDir, real.wsName, this.repoName);
    const id = ++real.commitCounter;
    await write(join(worktree, `commit-${id}.txt`), `content-${id}`);
    await git(worktree, ["add", "."]);
    await git(worktree, ["commit", "-m", `commit ${id}`]);
    const repo = model.repos[this.repoName];
    if (!repo) throw new Error(`Unknown repo: ${this.repoName}`);
    repo.localCommits += 1;
    // git add . + git commit cleans all dirty state
    repo.staged = 0;
    repo.untracked = 0;
    await assertStatus(model, real);
  }

  toString(): string {
    return `MakeCommit(${this.repoName})`;
  }
}

// ── Push ─────────────────────────────────────────────────────────

export class Push implements AsyncCommand<WorkspaceModel, RealSystem> {
  check(model: Readonly<WorkspaceModel>): boolean {
    return Object.values(model.repos).some(
      (r) =>
        // First push with commits
        (!r.pushed && r.localCommits > 0) ||
        // New commits since last push (normal push, no external divergence)
        (r.pushed && r.localCommits > r.pushedCommits && !r.rebasedSinceLastPush && r.externalCommits === 0) ||
        // Rebased since last push, no external commits (force-push-outdated)
        (r.pushed && r.rebasedSinceLastPush && r.externalCommits === 0),
    );
  }

  async run(model: WorkspaceModel, real: RealSystem): Promise<void> {
    real.executedCommands.push(this.toString());
    // Fetch so local tracking refs reflect any external pushes (MakeCommitOnShare)
    const reposDir = join(real.env.projectDir, ".arb/repos");
    await Promise.all(REPOS.map((r) => git(join(reposDir, r), ["fetch", "--prune"]).catch(() => {})));

    const result = await arb(real.env, ["push", "--yes", "--no-fetch"], {
      cwd: join(real.env.projectDir, real.wsName),
    });
    if (result.exitCode !== 0) {
      throw new Error(`arb push failed: ${result.output}`);
    }
    for (const repo of Object.values(model.repos)) {
      if (repo.rebasedSinceLastPush && repo.externalCommits === 0) {
        // Force push (or normal push of fast-forward rebase): remote replaced with HEAD
        repo.pushedCommits = repo.localCommits;
        repo.pushed = true;
        repo.remoteShareExists = true;
        repo.baseAbsorbedSinceLastPush = 0;
        repo.rebasedSinceLastPush = false;
        // externalCommits already 0
      } else if (!repo.rebasedSinceLastPush && repo.localCommits > 0 && repo.externalCommits === 0) {
        // Normal push or first push (only when no external divergence)
        repo.pushedCommits = repo.localCommits;
        repo.pushed = true;
        repo.remoteShareExists = true;
        repo.baseAbsorbedSinceLastPush = 0;
      }
      // Repos with rebasedSinceLastPush + externalCommits > 0 are skipped by arb push
    }
    await assertStatus(model, real);
  }

  toString(): string {
    return "Push";
  }
}

// ── Pull ─────────────────────────────────────────────────────────

export class Pull implements AsyncCommand<WorkspaceModel, RealSystem> {
  check(model: Readonly<WorkspaceModel>): boolean {
    // At least one repo has genuine external commits to pull, is clean,
    // and hasn't been rebased since last push (pull --rebase after local
    // rebase replays base-absorbed commits onto the share tip, making
    // base.ahead unpredictable — push first to force-push rebased commits).
    return Object.values(model.repos).some(
      (r) => r.pushed && r.externalCommits > 0 && !r.rebasedSinceLastPush && r.staged === 0 && r.untracked === 0,
    );
  }

  async run(model: WorkspaceModel, real: RealSystem): Promise<void> {
    real.executedCommands.push(this.toString());
    // Only pull repos the model considers eligible — pass explicit names so
    // arb doesn't also pull rebased repos (which would produce unpredictable base.ahead).
    const eligible = Object.entries(model.repos).filter(
      ([_, r]) => r.pushed && r.externalCommits > 0 && !r.rebasedSinceLastPush && r.staged === 0 && r.untracked === 0,
    );
    const repoNames = eligible.map(([name]) => name);
    // arb pull always fetches (no --no-fetch option)
    const result = await arb(real.env, ["pull", "--rebase", "--yes", ...repoNames], {
      cwd: join(real.env.projectDir, real.wsName),
    });
    if (result.exitCode !== 0) {
      throw new Error(`arb pull failed: ${result.output}`);
    }
    for (const [_, repo] of eligible) {
      // After pull --rebase: external commits are absorbed into local history.
      // Local commits are replayed on top, so toPush count stays the same.
      repo.localCommits += repo.externalCommits;
      repo.pushedCommits += repo.externalCommits;
      repo.externalCommits = 0;
    }
    await assertStatus(model, real);
  }

  toString(): string {
    return "Pull";
  }
}

// ── Rebase ───────────────────────────────────────────────────────

export class Rebase implements AsyncCommand<WorkspaceModel, RealSystem> {
  check(model: Readonly<WorkspaceModel>): boolean {
    const hasWorkToDo = Object.values(model.repos).some((r) => r.baseAdvanced > 0);
    // Rebase skips dirty repos (without --autostash). Require all clean to avoid partial rebase.
    const allClean = Object.values(model.repos).every((r) => r.staged === 0 && r.untracked === 0);
    return hasWorkToDo && allClean;
  }

  async run(model: WorkspaceModel, real: RealSystem): Promise<void> {
    real.executedCommands.push(this.toString());
    const result = await arb(real.env, ["rebase", "--yes", "--no-fetch"], {
      cwd: join(real.env.projectDir, real.wsName),
    });
    if (result.exitCode !== 0) {
      throw new Error(`arb rebase failed: ${result.output}`);
    }
    for (const repo of Object.values(model.repos)) {
      if (repo.baseAdvanced > 0) {
        repo.baseAbsorbedSinceLastPush += repo.baseAdvanced;
        repo.baseAdvanced = 0;
        if (repo.pushed) {
          repo.rebasedSinceLastPush = true;
        }
      }
    }
    await assertStatus(model, real);
  }

  toString(): string {
    return "Rebase";
  }
}

// ── MakeCommitOnBase ─────────────────────────────────────────────

export class MakeCommitOnBase implements AsyncCommand<WorkspaceModel, RealSystem> {
  readonly repoName: string;

  constructor(repoName: string) {
    this.repoName = repoName;
  }

  check(_model: Readonly<WorkspaceModel>): boolean {
    return true;
  }

  async run(model: WorkspaceModel, real: RealSystem): Promise<void> {
    real.executedCommands.push(this.toString());
    const canonicalRepo = join(real.env.projectDir, ".arb/repos", this.repoName);
    await git(canonicalRepo, ["checkout", "main"]);
    const id = ++real.commitCounter;
    await write(join(canonicalRepo, `base-${id}.txt`), `base-${id}`);
    await git(canonicalRepo, ["add", "."]);
    await git(canonicalRepo, ["commit", "-m", `base commit ${id}`]);
    await git(canonicalRepo, ["push", "origin", "main"]);
    const head = (await git(canonicalRepo, ["rev-parse", "HEAD"])).trim();
    await git(canonicalRepo, ["checkout", "--detach", head]);

    const repo = model.repos[this.repoName];
    if (!repo) throw new Error(`Unknown repo: ${this.repoName}`);
    repo.baseAdvanced += 1;
    await assertStatus(model, real);
  }

  toString(): string {
    return `MakeCommitOnBase(${this.repoName})`;
  }
}

// ── MakeCommitOnShare ────────────────────────────────────────────

export class MakeCommitOnShare implements AsyncCommand<WorkspaceModel, RealSystem> {
  readonly repoName: string;

  constructor(repoName: string) {
    this.repoName = repoName;
  }

  check(model: Readonly<WorkspaceModel>): boolean {
    const repo = model.repos[this.repoName];
    // Can only push to share if it exists and hasn't been diverged by rebase
    // (after rebase, the share branch has old commits — external pushes on top
    // of those would make the model harder to predict)
    return repo?.pushed === true && !repo.rebasedSinceLastPush;
  }

  async run(model: WorkspaceModel, real: RealSystem): Promise<void> {
    real.executedCommands.push(this.toString());
    const bareOrigin = join(real.env.originDir, `${this.repoName}.git`);
    const tmpDir = await mkdtemp(join(tmpdir(), "arb-pbt-share-"));
    try {
      await git(tmpDir, ["clone", bareOrigin, "clone"]);
      const cloneDir = join(tmpDir, "clone");
      await git(cloneDir, ["checkout", real.wsName]);
      const id = ++real.commitCounter;
      await write(join(cloneDir, `external-${id}.txt`), `external-${id}`);
      await git(cloneDir, ["add", "."]);
      await git(cloneDir, ["commit", "-m", `external commit ${id}`]);
      await git(cloneDir, ["push", "origin", real.wsName]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }

    const repo = model.repos[this.repoName];
    if (!repo) throw new Error(`Unknown repo: ${this.repoName}`);
    repo.externalCommits += 1;
    await assertStatus(model, real);
  }

  toString(): string {
    return `MakeCommitOnShare(${this.repoName})`;
  }
}

// ── MakeDirtyFile ───────────────────────────────────────────────

export class MakeDirtyFile implements AsyncCommand<WorkspaceModel, RealSystem> {
  readonly repoName: string;
  readonly kind: "untracked" | "staged";

  constructor(repoName: string, kind: "untracked" | "staged") {
    this.repoName = repoName;
    this.kind = kind;
  }

  check(_model: Readonly<WorkspaceModel>): boolean {
    return true;
  }

  async run(model: WorkspaceModel, real: RealSystem): Promise<void> {
    real.executedCommands.push(this.toString());
    const worktree = join(real.env.projectDir, real.wsName, this.repoName);
    const id = ++real.commitCounter;
    await write(join(worktree, `dirty-${id}.txt`), `dirty-${id}`);
    if (this.kind === "staged") {
      await git(worktree, ["add", `dirty-${id}.txt`]);
    }

    const repo = model.repos[this.repoName];
    if (!repo) throw new Error(`Unknown repo: ${this.repoName}`);
    if (this.kind === "untracked") {
      repo.untracked += 1;
    } else {
      repo.staged += 1;
    }
    await assertStatus(model, real);
  }

  toString(): string {
    return `MakeDirtyFile(${this.repoName}, ${this.kind})`;
  }
}
