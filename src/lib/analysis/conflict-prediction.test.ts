import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultBranch } from "../git/git";
import { predictMergeConflict, predictRebaseConflictCommits, predictStashPopConflict } from "./conflict-prediction";

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

describe("predictMergeConflict", () => {
  test("returns no conflict for non-overlapping changes", () =>
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
      const result = await predictMergeConflict(repoDir, defaultBranch);
      expect(result).not.toBeNull();
      expect(result?.hasConflict).toBe(false);
    }));

  test("returns conflict for overlapping changes", () =>
    withRepo(async ({ repoDir }) => {
      const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

      writeFileSync(join(repoDir, "shared.txt"), "original");
      Bun.spawnSync(["git", "-C", repoDir, "add", "shared.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add shared"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
      writeFileSync(join(repoDir, "shared.txt"), "feature version");
      Bun.spawnSync(["git", "-C", repoDir, "add", "shared.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature change"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
      writeFileSync(join(repoDir, "shared.txt"), "main version");
      Bun.spawnSync(["git", "-C", repoDir, "add", "shared.txt"]);
      Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main change"]);

      Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
      const result = await predictMergeConflict(repoDir, defaultBranch);
      expect(result).not.toBeNull();
      expect(result?.hasConflict).toBe(true);
    }));
});

describe("predictRebaseConflictCommits", () => {
  test("returns empty array for non-overlapping changes", () =>
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
      const result = await predictRebaseConflictCommits(repoDir, defaultBranch);
      expect(result.length).toBe(0);
    }));
});

describe("predictStashPopConflict", () => {
  test("returns empty when working tree is clean", () =>
    withRepo(async ({ repoDir }) => {
      const result = await predictStashPopConflict(repoDir, "HEAD");
      expect(result.overlapping.length).toBe(0);
    }));
});
