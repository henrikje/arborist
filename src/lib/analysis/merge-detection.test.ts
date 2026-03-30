import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultBranch } from "../git/git";
import {
  detectBranchMerged,
  findMergeCommitForBranch,
  findTicketReferencedCommit,
  verifySquashRange,
} from "./merge-detection";

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

describe("detectBranchMerged", () => {
  test("detects merge commit", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "merge", "feature", "--no-ff", "-m", "merge feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await detectBranchMerged(repoDir, defaultBranch);
      expect(result?.kind).toBe("merge");
    }));

  test("detects single-commit rebase merge via patch-id", () =>
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

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await detectBranchMerged(repoDir, defaultBranch);
      expect(result?.kind).toBe("squash");
      expect(result?.matchingCommit).toBeDefined();
      expect(result?.matchingCommit?.subject).toBe("feature commit");
    }));

  test("detects squash merge via patch-id", () =>
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
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash: add a and b (#42)"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await detectBranchMerged(repoDir, defaultBranch);
      expect(result?.kind).toBe("squash");
      expect(result?.matchingCommit?.subject).toBe("squash: add a and b (#42)");
    }));

  test("returns null for unmerged branch", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

      const result = await detectBranchMerged(repoDir, defaultBranch);
      expect(result).toBeNull();
    }));

  test("returns null for modified squash (patch-id mismatch)", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      writeFileSync(join(repoDir, "feature.txt"), "modified content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "modified squash"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await detectBranchMerged(repoDir, defaultBranch);
      expect(result).toBeNull();
    }));

  test("returns null for branch at same commit as base (no divergence)", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      // Branch created from default with no additional commits — same SHA as default.
      // This is NOT a merge; the branch simply hasn't diverged yet.
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);

      const result = await detectBranchMerged(repoDir, defaultBranch);
      expect(result).toBeNull();
    }));

  test("returns null for branch at same commit as base via explicit branchRef", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      // Same scenario but using an explicit branchRef (like the stacked base detection does)
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);

      const result = await detectBranchMerged(repoDir, defaultBranch, 200, "feature");
      expect(result).toBeNull();
    }));

  test("returns merge for branch that is strictly behind base (ancestor but different commit)", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      // Create branch, then advance default past it — branch is ancestor of default
      // but at a different commit. This is the legitimate "branch was merged" or
      // "branch fell behind" case.
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      writeFileSync(join(repoDir, "main-work.txt"), "main work");
      Bun.spawnSync(["git", "-C", repoDir, "add", "main-work.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "advance main"]);

      const result = await detectBranchMerged(repoDir, defaultBranch, 200, "feature");
      expect(result?.kind).toBe("merge");
    }));

  test("respects commit limit", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash merge"]);

      for (let i = 0; i < 3; i++) {
        writeFileSync(join(repoDir, `extra-${i}.txt`), `extra ${i}`);
        Bun.spawnSync(["git", "-C", repoDir, "add", `extra-${i}.txt`]);
        Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", `extra ${i}`]);
      }

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const limited = await detectBranchMerged(repoDir, defaultBranch, 1);
      expect(limited).toBeNull();

      const full = await detectBranchMerged(repoDir, defaultBranch);
      expect(full?.kind).toBe("squash");
    }));

  test("detects merge commit with explicit branchRef", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/auth"]);
      writeFileSync(join(repoDir, "auth.txt"), "auth content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "auth.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "auth feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "merge", "feat/auth", "--no-ff", "-m", "merge auth"]);

      const result = await detectBranchMerged(repoDir, defaultBranch, 200, "feat/auth");
      expect(result?.kind).toBe("merge");
    }));

  test("detects squash merge with explicit branchRef", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/auth"]);
      writeFileSync(join(repoDir, "auth.txt"), "auth content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "auth.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "auth feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feat/auth"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash: auth"]);

      const result = await detectBranchMerged(repoDir, defaultBranch, 200, "feat/auth");
      expect(result?.kind).toBe("squash");
    }));

  test("returns null with explicit branchRef when not merged", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/auth"]);
      writeFileSync(join(repoDir, "auth.txt"), "auth content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "auth.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "auth feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      const result = await detectBranchMerged(repoDir, defaultBranch, 200, "feat/auth");
      expect(result).toBeNull();
    }));

  test("detects squash merge with new commits via prefix", () =>
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
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash: add a and b (#42)"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      writeFileSync(join(repoDir, "c.txt"), "fix content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "c.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix bug"]);

      const withoutPrefix = await detectBranchMerged(repoDir, defaultBranch, 200, "HEAD", 0);
      expect(withoutPrefix).toBeNull();

      const withPrefix = await detectBranchMerged(repoDir, defaultBranch, 200, "HEAD", 5);
      expect(withPrefix).not.toBeNull();
      expect(withPrefix?.kind).toBe("squash");
      expect(withPrefix?.newCommitsAfterMerge).toBe(1);
      expect(withPrefix?.matchingCommit?.subject).toBe("squash: add a and b (#42)");
    }));

  test("detects regular merge with new commits via prefix", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "merge", "feature", "--no-ff", "-m", "merge feature"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      writeFileSync(join(repoDir, "fix.txt"), "fix content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "fix.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix bug"]);

      const result = await detectBranchMerged(repoDir, defaultBranch, 200, "HEAD", 5);
      expect(result).not.toBeNull();
      expect(result?.kind).toBe("merge");
      expect(result?.newCommitsAfterMerge).toBe(1);
    }));

  test("returns null when prefixLimit is too small", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash merge"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      for (let i = 0; i < 3; i++) {
        writeFileSync(join(repoDir, `fix-${i}.txt`), `fix ${i}`);
        Bun.spawnSync(["git", "-C", repoDir, "add", `fix-${i}.txt`]);
        Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", `fix ${i}`]);
      }

      const result = await detectBranchMerged(repoDir, defaultBranch, 200, "HEAD", 2);
      expect(result).toBeNull();

      const found = await detectBranchMerged(repoDir, defaultBranch, 200, "HEAD", 3);
      expect(found).not.toBeNull();
      expect(found?.newCommitsAfterMerge).toBe(3);
    }));

  test("newCommitsAfterMerge is undefined for exact match", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash merge"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await detectBranchMerged(repoDir, defaultBranch, 200, "HEAD", 5);
      expect(result?.kind).toBe("squash");
      expect(result?.newCommitsAfterMerge).toBeUndefined();
    }));
});

describe("findMergeCommitForBranch", () => {
  test("finds merge commit with afterRef scoping", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);
      const featureHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync([
        "git",
        "-C",
        repoDir,
        "merge",
        "feature",
        "--no-ff",
        "-m",
        "Merge pull request #42 from user/feature",
      ]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await findMergeCommitForBranch(repoDir, defaultBranch, "feature", 50, featureHead);
      expect(result).not.toBeNull();
      expect(result?.subject).toContain("feature");
    }));

  test("works without afterRef (backward compatible)", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync([
        "git",
        "-C",
        repoDir,
        "merge",
        "feature",
        "--no-ff",
        "-m",
        "Merge pull request #42 from user/feature",
      ]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await findMergeCommitForBranch(repoDir, defaultBranch, "feature");
      expect(result).not.toBeNull();
      expect(result?.subject).toContain("feature");
    }));

  test("finds merge commit by parentage when subject does not contain branch name", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);
      const featureHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync([
        "git",
        "-C",
        repoDir,
        "merge",
        "feature",
        "--no-ff",
        "-m",
        "Merge pull request #99 from user/some-branch",
      ]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await findMergeCommitForBranch(repoDir, defaultBranch, "feature", 50, featureHead);
      expect(result).not.toBeNull();
      expect(result?.subject).toContain("#99");
    }));

  test("branch-name match is preferred over parentage match", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "feature.txt"), "feature content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);
      const featureHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync([
        "git",
        "-C",
        repoDir,
        "merge",
        "feature",
        "--no-ff",
        "-m",
        "Merge pull request #42 from user/feature",
      ]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await findMergeCommitForBranch(repoDir, defaultBranch, "feature", 50, featureHead);
      expect(result).not.toBeNull();
      expect(result?.subject).toContain("feature");
      expect(result?.subject).toContain("#42");
    }));
});

describe("findTicketReferencedCommit", () => {
  test("finds commit with ticket in subject", () =>
    withRepo(async ({ repoDir }) => {
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix: enable batching PROJ-208 (#76)"]);

      const result = await findTicketReferencedCommit(repoDir, "PROJ-208");
      expect(result).not.toBeNull();
      expect(result?.subject).toContain("PROJ-208");
    }));

  test("finds commit with ticket in body (trailers)", () =>
    withRepo(async ({ repoDir }) => {
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix: enable query batching (#76)\n\nReferences: PROJ-208"]);

      const result = await findTicketReferencedCommit(repoDir, "PROJ-208");
      expect(result).not.toBeNull();
      expect(result?.subject).toContain("batching");
    }));

  test("returns most recent match when multiple exist", () =>
    withRepo(async ({ repoDir }) => {
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "first PROJ-208 (#10)"]);

      writeFileSync(join(repoDir, "b.txt"), "content b");
      Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "second PROJ-208 (#20)"]);

      const result = await findTicketReferencedCommit(repoDir, "PROJ-208");
      expect(result).not.toBeNull();
      expect(result?.subject).toContain("second");
    }));

  test("returns null when no ticket match", () =>
    withRepo(async ({ repoDir }) => {
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "unrelated commit (#99)"]);

      const result = await findTicketReferencedCommit(repoDir, "PROJ-208");
      expect(result).toBeNull();
    }));

  test("is case-insensitive", () =>
    withRepo(async ({ repoDir }) => {
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix: something (#76)\n\nReferences: proj-208"]);

      const result = await findTicketReferencedCommit(repoDir, "PROJ-208");
      expect(result).not.toBeNull();
      expect(result?.subject).toContain("something");
    }));
});

describe("verifySquashRange", () => {
  test("verified match returns true", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      // Create feature branch with 2 commits
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
      writeFileSync(join(repoDir, "b.txt"), "content b");
      Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);

      // Squash-merge into main
      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feature"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash: add a and b"]);
      const squashHash = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

      // Add a new commit on feature on top
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      writeFileSync(join(repoDir, "c.txt"), "content c");
      Bun.spawnSync(["git", "-C", repoDir, "add", "c.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add c"]);

      // verifySquashRange with newCommitsAfterMerge=1 should verify old commits match squash
      const result = await verifySquashRange(repoDir, defaultBranch, squashHash, 1);
      expect(result).toBe(true);
    }));

  test("non-matching content returns false", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      // Create feature branch with a commit
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "a.txt"), "content a");
      Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);

      // Create a different commit on main (not a squash of feature)
      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      writeFileSync(join(repoDir, "different.txt"), "different content");
      Bun.spawnSync(["git", "-C", repoDir, "add", "different.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "different commit"]);
      const differentHash = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

      // Add a new commit on feature
      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      writeFileSync(join(repoDir, "b.txt"), "content b");
      Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);

      const result = await verifySquashRange(repoDir, defaultBranch, differentHash, 1);
      expect(result).toBe(false);
    }));

  test("invalid inputs return false", () =>
    withRepo(async ({ repoDir }) => {
      const result = await verifySquashRange(repoDir, "nonexistent", "deadbeef", 1);
      expect(result).toBe(false);
    }));
});
