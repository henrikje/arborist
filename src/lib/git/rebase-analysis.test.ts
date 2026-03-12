import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultBranch } from "./git";
import {
  analyzeReplayPlan,
  analyzeRetargetReplay,
  detectRebasedCommits,
  matchDivergedCommits,
} from "./rebase-analysis";

const configureGitIdentity = (dir: string) => {
  Bun.spawnSync(["git", "-C", dir, "config", "user.name", "Arborist Test"]);
  Bun.spawnSync(["git", "-C", dir, "config", "user.email", "arborist-test@example.com"]);
  Bun.spawnSync(["git", "-C", dir, "config", "commit.gpgsign", "false"]);
};

function withRepo(fn: (ctx: { tmpDir: string; repoDir: string }) => Promise<void>): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "arb-git-test-"));
  const bare = join(tmpDir, "bare.git");
  const repoDir = join(tmpDir, "work");
  Bun.spawnSync(["git", "init", "--bare", bare]);
  Bun.spawnSync(["git", "clone", bare, repoDir]);
  configureGitIdentity(repoDir);
  Bun.spawnSync(["git", "-C", repoDir, "commit", "--allow-empty", "-m", "init"]);
  Bun.spawnSync(["git", "-C", repoDir, "push", "origin", "HEAD"]);
  return fn({ tmpDir, repoDir }).finally(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
}

describe("detectRebasedCommits", () => {
  test("detects rebased commits after rebase onto advanced main", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      writeFileSync(join(repoDir, "b.txt"), "content b");
      Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);

      Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      writeFileSync(join(repoDir, "main-new.txt"), "main advance");
      Bun.spawnSync(["git", "-C", repoDir, "add", "main-new.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "advance main"]);
      Bun.spawnSync(["git", "-C", repoDir, "push", "origin", defaultBranch]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "rebase", defaultBranch]);

      const result = await detectRebasedCommits(repoDir, "origin/feature");
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected non-null result");
      expect(result.count).toBe(2);
      expect(result.rebasedLocalHashes.size).toBe(2);
    }));

  test("returns zero for genuinely different commits", () =>
    withRepo(async ({ tmpDir, repoDir }) => {
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

      writeFileSync(join(repoDir, "new.txt"), "new content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "new.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "new local commit"]);

      const bare = join(tmpDir, "bare.git");
      const tmpClone = join(tmpDir, "tmpclone");
      Bun.spawnSync(["git", "clone", bare, tmpClone]);
      configureGitIdentity(tmpClone);
      Bun.spawnSync(["git", "-C", tmpClone, "checkout", "feature"]);
      writeFileSync(join(tmpClone, "remote-new.txt"), "remote content");
      Bun.spawnSync(["git", "-C", tmpClone, "add", "remote-new.txt"]);
      Bun.spawnSync(["git", "-C", tmpClone, "commit", "-m", "remote commit"]);
      Bun.spawnSync(["git", "-C", tmpClone, "push", "origin", "feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "fetch", "origin"]);

      const result = await detectRebasedCommits(repoDir, "origin/feature");
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected non-null result");
      expect(result.count).toBe(0);
      expect(result.rebasedLocalHashes.size).toBe(0);
    }));

  test("returns zero or null for invalid ref", () =>
    withRepo(async ({ repoDir }) => {
      const result = await detectRebasedCommits(repoDir, "nonexistent-ref");
      if (result !== null) {
        expect(result.count).toBe(0);
        expect(result.rebasedLocalHashes.size).toBe(0);
      }
    }));
});

describe("analyzeRetargetReplay", () => {
  test("identifies commits already on new target via patch-id", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/old-base"]);
      writeFileSync(join(repoDir, "base.txt"), "base content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "base.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "base commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      writeFileSync(join(repoDir, "b.txt"), "content b");
      Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      const logResult = Bun.spawnSync(["git", "-C", repoDir, "log", "feature", "--format=%H", "-2"]);
      const shas = logResult.stdout.toString().trim().split("\n");
      const addASha = shas[1] ?? "";
      Bun.spawnSync(["git", "-C", repoDir, "cherry-pick", addASha]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);

      const result = await analyzeRetargetReplay(repoDir, "feat/old-base", defaultBranch);
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected non-null result");
      expect(result.totalLocal).toBe(2);
      expect(result.alreadyOnTarget).toBe(1);
      expect(result.toReplay).toBe(1);
    }));

  test("returns all to replay when no commits match", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/old-base"]);
      writeFileSync(join(repoDir, "base.txt"), "base content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "base.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "base commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      writeFileSync(join(repoDir, "main-new.txt"), "main content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "main-new.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);

      const result = await analyzeRetargetReplay(repoDir, "feat/old-base", defaultBranch);
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected non-null result");
      expect(result.totalLocal).toBe(1);
      expect(result.alreadyOnTarget).toBe(0);
      expect(result.toReplay).toBe(1);
    }));

  test("returns zero local when feature has no commits beyond old base", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/old-base"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await analyzeRetargetReplay(repoDir, "feat/old-base", defaultBranch);
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected non-null result");
      expect(result.totalLocal).toBe(0);
      expect(result.alreadyOnTarget).toBe(0);
      expect(result.toReplay).toBe(0);
    }));
});

describe("matchDivergedCommits", () => {
  test("detects 1:1 rebase match when commit is cherry-picked onto base", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);
      const featureSha = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      writeFileSync(join(repoDir, "main-work.txt"), "main work");
      Bun.spawnSync(["git", "-C", repoDir, "add", "main-work.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main work"]);
      Bun.spawnSync(["git", "-C", repoDir, "cherry-pick", featureSha]);
      const cherryPickSha = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await matchDivergedCommits(repoDir, defaultBranch);
      expect(result.rebaseMatches.size).toBe(1);
      expect(result.rebaseMatches.get(cherryPickSha)).toBe(featureSha);
      expect(result.squashMatch).toBeNull();
    }));

  test("detects full squash match when branch is squash-merged onto base", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      writeFileSync(join(repoDir, "b.txt"), "content b");
      Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash: add a and b"]);
      const squashSha = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await matchDivergedCommits(repoDir, defaultBranch);
      expect(result.rebaseMatches.size).toBe(0);
      expect(result.squashMatch).not.toBeNull();
      if (!result.squashMatch) throw new Error("expected squashMatch");
      expect(result.squashMatch.incomingHash).toBe(squashSha);
      expect(result.squashMatch.localHashes.length).toBe(2);
    }));

  test("returns empty result for genuinely different commits", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      writeFileSync(join(repoDir, "main.txt"), "main content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "main.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await matchDivergedCommits(repoDir, defaultBranch);
      expect(result.rebaseMatches.size).toBe(0);
      expect(result.squashMatch).toBeNull();
    }));

  test("returns empty result for equal refs", () =>
    withRepo(async ({ repoDir }) => {
      const result = await matchDivergedCommits(repoDir, "HEAD");
      expect(result.rebaseMatches.size).toBe(0);
      expect(result.squashMatch).toBeNull();
    }));
});

describe("analyzeReplayPlan", () => {
  test("returns zero replay when feature is fully squash-equivalent", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      writeFileSync(join(repoDir, "b.txt"), "content b");
      Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await analyzeReplayPlan(repoDir, defaultBranch);
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected replay plan");
      expect(result.contiguous).toBe(true);
      expect(result.totalLocal).toBe(2);
      expect(result.alreadyOnTarget).toBe(2);
      expect(result.toReplay).toBe(0);
      expect(result.boundaryRef).toBeUndefined();
    }));

  test("returns replay suffix when new commits are on top of already-merged work", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      writeFileSync(join(repoDir, "b.txt"), "content b");
      Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      writeFileSync(join(repoDir, "c.txt"), "content c");
      Bun.spawnSync(["git", "-C", repoDir, "add", "c.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add c"]);

      const result = await analyzeReplayPlan(repoDir, defaultBranch);
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected replay plan");
      expect(result.contiguous).toBe(true);
      expect(result.totalLocal).toBe(3);
      expect(result.alreadyOnTarget).toBe(2);
      expect(result.toReplay).toBe(1);
      expect(result.boundaryRef).toBe("HEAD~1");
    }));
});
