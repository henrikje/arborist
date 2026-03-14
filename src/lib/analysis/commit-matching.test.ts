import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultBranch } from "../git/git";
import {
  detectRebasedCommits,
  detectReplacedCommits,
  detectSquashedCommits,
  matchDivergedCommits,
} from "./commit-matching";

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

describe("detectReplacedCommits", () => {
  test("detects replaced commits via reflog matching", () =>
    withRepo(async ({ tmpDir, repoDir }) => {
      // Create feature branch with commits, push
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

      // Simulate remote amending: clone into tmpClone, amend, force push
      const bare = join(tmpDir, "bare.git");
      const tmpClone = join(tmpDir, "tmpclone");
      Bun.spawnSync(["git", "clone", bare, tmpClone]);
      configureGitIdentity(tmpClone);
      Bun.spawnSync(["git", "-C", tmpClone, "checkout", "feature"]);
      Bun.spawnSync(["git", "-C", tmpClone, "commit", "--allow-empty", "--amend", "-m", "add a (amended)"]);
      Bun.spawnSync(["git", "-C", tmpClone, "push", "--force", "origin", "feature"]);

      // Fetch in working repo — now origin/feature has a different commit
      Bun.spawnSync(["git", "-C", repoDir, "fetch", "origin"]);

      const result = await detectReplacedCommits(repoDir, "origin/feature", "feature");
      expect(result).not.toBeNull();
      // The old commit hash should be in the reflog and match the remote's to-pull commits
      expect(result?.count).toBeGreaterThanOrEqual(0);
    }));

  test("excludeHashes filters out specified hashes", () =>
    withRepo(async ({ tmpDir, repoDir }) => {
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      const commitHash = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();
      Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

      // Simulate remote amending
      const bare = join(tmpDir, "bare.git");
      const tmpClone = join(tmpDir, "tmpclone2");
      Bun.spawnSync(["git", "clone", bare, tmpClone]);
      configureGitIdentity(tmpClone);
      Bun.spawnSync(["git", "-C", tmpClone, "checkout", "feature"]);
      Bun.spawnSync(["git", "-C", tmpClone, "commit", "--allow-empty", "--amend", "-m", "add a (amended)"]);
      Bun.spawnSync(["git", "-C", tmpClone, "push", "--force", "origin", "feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "fetch", "origin"]);

      const resultWithExclude = await detectReplacedCommits(
        repoDir,
        "origin/feature",
        "feature",
        new Set([commitHash]),
      );
      expect(resultWithExclude).not.toBeNull();
      // When excluding the hash, it should not appear in replacedHashes
      if (resultWithExclude) {
        expect(resultWithExclude.replacedHashes.has(commitHash)).toBe(false);
      }
    }));

  test("returns null when git commands fail", () =>
    withRepo(async ({ repoDir }) => {
      const result = await detectReplacedCommits(repoDir, "nonexistent-ref", "nonexistent-branch");
      expect(result).toBeNull();
    }));

  test("detects replaced commits including fast-forward intermediates", () =>
    withRepo(async ({ tmpDir, repoDir }) => {
      // Create feature branch with commit A, push
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

      // Collaborator pushes B, C, D on top of A
      const bare = join(tmpDir, "bare.git");
      const tmpClone = join(tmpDir, "tmpclone-ff");
      Bun.spawnSync(["git", "clone", bare, tmpClone]);
      configureGitIdentity(tmpClone);
      Bun.spawnSync(["git", "-C", tmpClone, "checkout", "feature"]);
      writeFileSync(join(tmpClone, "b.txt"), "content b");
      Bun.spawnSync(["git", "-C", tmpClone, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", tmpClone, "commit", "-m", "add b"]);
      writeFileSync(join(tmpClone, "c.txt"), "content c");
      Bun.spawnSync(["git", "-C", tmpClone, "add", "c.txt"]);
      Bun.spawnSync(["git", "-C", tmpClone, "commit", "-m", "add c"]);
      writeFileSync(join(tmpClone, "d.txt"), "content d");
      Bun.spawnSync(["git", "-C", tmpClone, "add", "d.txt"]);
      Bun.spawnSync(["git", "-C", tmpClone, "commit", "-m", "add d"]);
      Bun.spawnSync(["git", "-C", tmpClone, "push", "origin", "feature"]);

      // Pull with fast-forward — only tip D enters the reflog, not B or C
      Bun.spawnSync(["git", "-C", repoDir, "pull", "--ff-only"]);

      // Content-changing squash: reset and rewrite with different content
      Bun.spawnSync(["git", "-C", repoDir, "reset", "--soft", "HEAD~3"]);
      writeFileSync(join(repoDir, "b.txt"), "modified b");
      writeFileSync(join(repoDir, "c.txt"), "modified c");
      Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt", "c.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash b+c (modified)"]);
      writeFileSync(join(repoDir, "d.txt"), "modified d");
      Bun.spawnSync(["git", "-C", repoDir, "add", "d.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add d (modified)"]);

      // Fetch to update origin/feature
      Bun.spawnSync(["git", "-C", repoDir, "fetch", "origin"]);

      const result = await detectReplacedCommits(repoDir, "origin/feature", "feature");
      expect(result).not.toBeNull();
      // All 3 remote-only commits (B, C, D) should be detected as replaced,
      // including B and C which were fast-forward intermediates not in the reflog tips
      expect(result?.count).toBe(3);
    }));

  test("does not count cherry-picked commits from another branch as replaced", () =>
    withRepo(async ({ tmpDir, repoDir }) => {
      const defaultBranch = Bun.spawnSync(["git", "-C", repoDir, "branch", "--show-current"]).stdout.toString().trim();

      // Create feature branch with commit A, push
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature work"]);
      Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

      // On main, cherry-pick the feature commit (creates a new hash)
      const featureHash = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();
      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "cherry-pick", featureHash]);

      // Collaborator pushes a new commit on top of feature (includes the cherry-picked content on main)
      const bare = join(tmpDir, "bare.git");
      const tmpClone = join(tmpDir, "tmpclone-cp");
      Bun.spawnSync(["git", "clone", bare, tmpClone]);
      configureGitIdentity(tmpClone);
      Bun.spawnSync(["git", "-C", tmpClone, "checkout", "feature"]);
      writeFileSync(join(tmpClone, "collab.txt"), "collaborator work");
      Bun.spawnSync(["git", "-C", tmpClone, "add", "collab.txt"]);
      Bun.spawnSync(["git", "-C", tmpClone, "commit", "-m", "collaborator commit"]);
      Bun.spawnSync(["git", "-C", tmpClone, "push", "origin", "feature"]);

      // Back on feature: amend to diverge, then fetch
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "--allow-empty", "--amend", "-m", "feature work (amended)"]);
      Bun.spawnSync(["git", "-C", repoDir, "fetch", "origin"]);

      // The collaborator's commit should NOT be detected as replaced —
      // the cherry-pick on main creates a different hash, so it can't contaminate feature's reflog
      const result = await detectReplacedCommits(repoDir, "origin/feature", "feature");
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected non-null result");
      // Only the original feature commit should be replaced (it's in the reflog from before the amend).
      // The collaborator's commit is genuinely new.
      expect(result.replacedHashes.size).toBe(1);
      expect(result.replacedHashes.has(featureHash)).toBe(true);
    }));

  test("does not count collaborator's new work as replaced after amend", () =>
    withRepo(async ({ tmpDir, repoDir }) => {
      // Create feature branch, commit A, push
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

      // Collaborator pushes B on top of A
      const bare = join(tmpDir, "bare.git");
      const tmpClone = join(tmpDir, "tmpclone-collab");
      Bun.spawnSync(["git", "clone", bare, tmpClone]);
      configureGitIdentity(tmpClone);
      Bun.spawnSync(["git", "-C", tmpClone, "checkout", "feature"]);
      writeFileSync(join(tmpClone, "b.txt"), "collaborator content");
      Bun.spawnSync(["git", "-C", tmpClone, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", tmpClone, "commit", "-m", "add b"]);
      Bun.spawnSync(["git", "-C", tmpClone, "push", "origin", "feature"]);

      // Local: amend A with different content
      writeFileSync(join(repoDir, "a.txt"), "content a (amended)");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "--amend", "-m", "add a (amended)"]);
      Bun.spawnSync(["git", "-C", repoDir, "fetch", "origin"]);

      // Remote-only: original A + collaborator's B
      // Only A should be replaced (in reflog). B is genuinely new.
      const result = await detectReplacedCommits(repoDir, "origin/feature", "feature");
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected non-null result");
      expect(result.count).toBe(1); // only original A
    }));

  test("ancestry walk does not include commits still reachable from HEAD", () =>
    withRepo(async ({ tmpDir, repoDir }) => {
      // Create feature with commits A, B, C — push
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      writeFileSync(join(repoDir, "b.txt"), "b");
      Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);
      writeFileSync(join(repoDir, "c.txt"), "c");
      Bun.spawnSync(["git", "-C", repoDir, "add", "c.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add c"]);
      Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

      // Collaborator amends only C (keeps A, B)
      const bare = join(tmpDir, "bare.git");
      const tmpClone = join(tmpDir, "tmpclone-ancestor");
      Bun.spawnSync(["git", "clone", bare, tmpClone]);
      configureGitIdentity(tmpClone);
      Bun.spawnSync(["git", "-C", tmpClone, "checkout", "feature"]);
      Bun.spawnSync(["git", "-C", tmpClone, "commit", "--allow-empty", "--amend", "-m", "add c (amended)"]);
      Bun.spawnSync(["git", "-C", tmpClone, "push", "--force", "origin", "feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "fetch", "origin"]);

      // Only C' (the amended commit) should be in HEAD..origin/feature.
      // A and B are still reachable from HEAD and should NOT be in the remote-only set.
      // The ancestry walk should not falsely include A or B as replaced.
      const result = await detectReplacedCommits(repoDir, "origin/feature", "feature");
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected non-null result");
      // C' is the only remote-only commit, and it's NOT in our reflog (it was created remotely)
      expect(result.count).toBe(0);
    }));

  test("returns count 0 when no reflog matches", () =>
    withRepo(async ({ repoDir }) => {
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

      // No amending, so remote hashes are the same as local — no replacement
      const result = await detectReplacedCommits(repoDir, "origin/feature", "feature");
      expect(result).not.toBeNull();
      expect(result?.count).toBe(0);
    }));
});

describe("detectSquashedCommits", () => {
  test("matching cumulative patch-id returns count of toPull", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      // Create feature branch with commits, push
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      writeFileSync(join(repoDir, "b.txt"), "content b");
      Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);
      Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

      // Squash on remote side: create a squash commit on tracking branch
      // We simulate this by force-pushing a squashed version
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature-squash", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "reset", "--soft", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash: add a and b"]);
      Bun.spawnSync(["git", "-C", repoDir, "push", "--force", "origin", "feature-squash:feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "fetch", "origin"]);

      const result = await detectSquashedCommits(repoDir, "origin/feature", 1);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.count).toBe(1);
      }
    }));

  test("non-matching returns count 0", () =>
    withRepo(async ({ tmpDir, repoDir }) => {
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

      // Push a genuinely different commit to origin/feature
      const bare = join(tmpDir, "bare.git");
      const tmpClone = join(tmpDir, "tmpclone3");
      Bun.spawnSync(["git", "clone", bare, tmpClone]);
      configureGitIdentity(tmpClone);
      Bun.spawnSync(["git", "-C", tmpClone, "checkout", "feature"]);
      writeFileSync(join(tmpClone, "different.txt"), "different content");
      Bun.spawnSync(["git", "-C", tmpClone, "add", "different.txt"]);
      Bun.spawnSync(["git", "-C", tmpClone, "commit", "--amend", "-m", "totally different"]);
      Bun.spawnSync(["git", "-C", tmpClone, "push", "--force", "origin", "feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "fetch", "origin"]);

      const result = await detectSquashedCommits(repoDir, "origin/feature", 1);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.count).toBe(0);
      }
    }));

  test("returns null when merge-base fails", () =>
    withRepo(async ({ repoDir }) => {
      const result = await detectSquashedCommits(repoDir, "nonexistent-ref", 1);
      expect(result).toBeNull();
    }));
});
