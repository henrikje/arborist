import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { predictMergeConflict } from "../analysis/conflict-prediction";
import { validateWorkspaceName } from "../workspace/validation";
import {
  branchExistsLocally,
  checkBranchMatch,
  detectOperation,
  getCommitsBetweenFull,
  getDefaultBranch,
  isCaseInsensitiveFS,
  isLinkedWorktree,
  isRepoDirty,
  isShallowRepo,
  parseGitStatus,
  parseGitStatusFiles,
  validateBranchName,
} from "./git";

describe("validateWorkspaceName", () => {
  test("returns null for valid names", () => {
    expect(validateWorkspaceName("my-feature")).toBeNull();
    expect(validateWorkspaceName("v2")).toBeNull();
    expect(validateWorkspaceName("fix.bug")).toBeNull();
  });

  test("rejects names starting with '.'", () => {
    const result = validateWorkspaceName(".hidden");
    expect(result).toBeString();
    expect(result).toContain("must not start with '.'");
  });

  test("rejects names containing '/'", () => {
    const result = validateWorkspaceName("a/b");
    expect(result).toBeString();
    expect(result).toContain("must not contain '/'");
  });

  test("rejects names containing '..'", () => {
    const result = validateWorkspaceName("a..b");
    expect(result).toBeString();
    expect(result).toContain("must not contain '..'");
  });

  test("rejects names with whitespace", () => {
    expect(validateWorkspaceName("has space")).toContain("whitespace");
    expect(validateWorkspaceName("has\ttab")).toContain("whitespace");
    expect(validateWorkspaceName("has\nnewline")).toContain("whitespace");
  });
});

describe("validateBranchName", () => {
  test("accepts valid branch names", () => {
    expect(validateBranchName("feature/foo")).toBe(true);
    expect(validateBranchName("main")).toBe(true);
    expect(validateBranchName("fix-123")).toBe(true);
  });

  test("rejects empty string", () => {
    expect(validateBranchName("")).toBe(false);
  });

  test("rejects names with '..'", () => {
    expect(validateBranchName("..bad")).toBe(false);
  });

  test("rejects names with spaces", () => {
    expect(validateBranchName("bad name")).toBe(false);
  });

  test("rejects names with ~, ^, :", () => {
    expect(validateBranchName("bad~name")).toBe(false);
    expect(validateBranchName("bad^name")).toBe(false);
    expect(validateBranchName("bad:name")).toBe(false);
  });
});

describe("git repo functions", () => {
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

  describe("getDefaultBranch", () => {
    test("returns the HEAD branch name", () =>
      withRepo(async ({ repoDir }) => {
        const branch = await getDefaultBranch(repoDir, "origin");
        // git init defaults vary, but should be a non-empty string
        if (!branch) throw new Error("expected default branch");
        expect(branch.length).toBeGreaterThan(0);
      }));
  });

  describe("branchExistsLocally", () => {
    test("returns false for nonexistent branch", () =>
      withRepo(async ({ repoDir }) => {
        expect(await branchExistsLocally(repoDir, "no-such-branch")).toBe(false);
      }));

    test("returns true after creating a branch", () =>
      withRepo(async ({ repoDir }) => {
        Bun.spawnSync(["git", "-C", repoDir, "branch", "test-branch"]);
        expect(await branchExistsLocally(repoDir, "test-branch")).toBe(true);
      }));
  });

  describe("isRepoDirty", () => {
    test("returns false when clean", () =>
      withRepo(async ({ repoDir }) => {
        expect(await isRepoDirty(repoDir)).toBe(false);
      }));

    test("returns true after modifying a file", () =>
      withRepo(async ({ repoDir }) => {
        writeFileSync(join(repoDir, "dirty.txt"), "change");
        expect(await isRepoDirty(repoDir)).toBe(true);
      }));
  });

  describe("parseGitStatus", () => {
    test("returns zeros when clean", () =>
      withRepo(async ({ repoDir }) => {
        expect(await parseGitStatus(repoDir)).toEqual({ staged: 0, modified: 0, untracked: 0, conflicts: 0 });
      }));

    test("counts untracked files", () =>
      withRepo(async ({ repoDir }) => {
        writeFileSync(join(repoDir, "new.txt"), "new");
        const status = await parseGitStatus(repoDir);
        expect(status.untracked).toBe(1);
        expect(status.staged).toBe(0);
        expect(status.modified).toBe(0);
      }));

    test("counts staged files", () =>
      withRepo(async ({ repoDir }) => {
        writeFileSync(join(repoDir, "staged.txt"), "staged");
        Bun.spawnSync(["git", "-C", repoDir, "add", "staged.txt"]);
        const status = await parseGitStatus(repoDir);
        expect(status.staged).toBe(1);
      }));

    test("counts modified files", () =>
      withRepo(async ({ repoDir }) => {
        writeFileSync(join(repoDir, "tracked.txt"), "initial");
        Bun.spawnSync(["git", "-C", repoDir, "add", "tracked.txt"]);
        Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add tracked"]);
        writeFileSync(join(repoDir, "tracked.txt"), "modified");
        const status = await parseGitStatus(repoDir);
        expect(status.modified).toBe(1);
      }));
  });

  describe("checkBranchMatch", () => {
    test("matches when on expected branch", () =>
      withRepo(async ({ repoDir }) => {
        const defaultBranch = await getDefaultBranch(repoDir, "origin");
        if (!defaultBranch) throw new Error("expected default branch");
        const result = await checkBranchMatch(repoDir, defaultBranch);
        expect(result.matches).toBe(true);
        expect(result.actual).toBe(defaultBranch);
      }));

    test("does not match when on different branch", () =>
      withRepo(async ({ repoDir }) => {
        Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "other"]);
        const result = await checkBranchMatch(repoDir, "main");
        expect(result.matches).toBe(false);
        expect(result.actual).toBe("other");
      }));
  });

  describe("predictMergeConflict", () => {
    test("returns clean for non-conflicting merge", () =>
      withRepo(async ({ repoDir }) => {
        // Create a feature branch with a non-overlapping change
        Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
        writeFileSync(join(repoDir, "feature.txt"), "feature content");
        Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
        Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

        // Add a different change on the default branch
        const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";
        Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
        writeFileSync(join(repoDir, "main.txt"), "main content");
        Bun.spawnSync(["git", "-C", repoDir, "add", "main.txt"]);
        Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main commit"]);

        // Go back to feature and predict
        Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
        const result = await predictMergeConflict(repoDir, defaultBranch);
        if (!result) throw new Error("expected non-null result");
        expect(result.hasConflict).toBe(false);
        expect(result.files).toEqual([]);
      }));

    test("returns conflict for overlapping changes", () =>
      withRepo(async ({ repoDir }) => {
        const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

        // Create a shared file on the default branch (common ancestor)
        writeFileSync(join(repoDir, "shared.txt"), "original");
        Bun.spawnSync(["git", "-C", repoDir, "add", "shared.txt"]);
        Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add shared"]);

        // Create a feature branch from here and make a conflicting change
        Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
        writeFileSync(join(repoDir, "shared.txt"), "feature version");
        Bun.spawnSync(["git", "-C", repoDir, "add", "shared.txt"]);
        Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature change"]);

        // Add a conflicting change on the default branch
        Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
        writeFileSync(join(repoDir, "shared.txt"), "main version");
        Bun.spawnSync(["git", "-C", repoDir, "add", "shared.txt"]);
        Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main change"]);

        // Go back to feature and predict
        Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
        const result = await predictMergeConflict(repoDir, defaultBranch);
        if (!result) throw new Error("expected non-null result");
        expect(result.hasConflict).toBe(true);
        expect(result.files.length).toBeGreaterThan(0);
      }));

    test("returns null for invalid ref", () =>
      withRepo(async ({ repoDir }) => {
        const result = await predictMergeConflict(repoDir, "nonexistent-ref");
        expect(result).toBeNull();
      }));
  });

  describe("getCommitsBetweenFull", () => {
    test("returns short and full hashes with subjects", () =>
      withRepo(async ({ repoDir }) => {
        const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

        // Create a feature branch with commits
        Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
        writeFileSync(join(repoDir, "x.txt"), "x");
        Bun.spawnSync(["git", "-C", repoDir, "add", "x.txt"]);
        Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add x"]);

        const commits = await getCommitsBetweenFull(repoDir, defaultBranch, "feature");
        expect(commits.length).toBe(1);
        expect(commits[0]?.shortHash.length).toBeGreaterThan(0);
        expect(commits[0]?.fullHash.length).toBe(40);
        expect(commits[0]?.subject).toBe("add x");
      }));

    test("returns empty array for equal refs", () =>
      withRepo(async ({ repoDir }) => {
        const commits = await getCommitsBetweenFull(repoDir, "HEAD", "HEAD");
        expect(commits).toEqual([]);
      }));
  });

  describe("detectOperation", () => {
    test("returns null for clean repo", () =>
      withRepo(async ({ repoDir }) => {
        const op = await detectOperation(repoDir);
        expect(op).toBeNull();
      }));

    test("detects rebase-merge in progress", () =>
      withRepo(async ({ repoDir }) => {
        // Simulate rebase-in-progress by creating the directory
        const gitDirResult = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "--git-dir"]);
        const gitDir = new TextDecoder().decode(gitDirResult.stdout).trim();
        const absGitDir = gitDir.startsWith("/") ? gitDir : join(repoDir, gitDir);
        mkdirSync(join(absGitDir, "rebase-merge"), { recursive: true });
        const op = await detectOperation(repoDir);
        expect(op).toBe("rebase");
        rmSync(join(absGitDir, "rebase-merge"), { recursive: true });
      }));

    test("detects merge in progress", () =>
      withRepo(async ({ repoDir }) => {
        const gitDirResult = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "--git-dir"]);
        const gitDir = new TextDecoder().decode(gitDirResult.stdout).trim();
        const absGitDir = gitDir.startsWith("/") ? gitDir : join(repoDir, gitDir);
        writeFileSync(join(absGitDir, "MERGE_HEAD"), "abc123\n");
        const op = await detectOperation(repoDir);
        expect(op).toBe("merge");
        rmSync(join(absGitDir, "MERGE_HEAD"));
      }));

    test("detects cherry-pick in progress", () =>
      withRepo(async ({ repoDir }) => {
        const gitDirResult = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "--git-dir"]);
        const gitDir = new TextDecoder().decode(gitDirResult.stdout).trim();
        const absGitDir = gitDir.startsWith("/") ? gitDir : join(repoDir, gitDir);
        writeFileSync(join(absGitDir, "CHERRY_PICK_HEAD"), "abc123\n");
        const op = await detectOperation(repoDir);
        expect(op).toBe("cherry-pick");
        rmSync(join(absGitDir, "CHERRY_PICK_HEAD"));
      }));
  });

  describe("isLinkedWorktree", () => {
    test("returns false for normal repo (.git is directory)", () =>
      withRepo(async ({ repoDir }) => {
        expect(isLinkedWorktree(repoDir)).toBe(false);
      }));

    test("returns false for non-git directory", () => {
      const dir = mkdtempSync(join(tmpdir(), "arb-nolink-"));
      expect(isLinkedWorktree(dir)).toBe(false);
      rmSync(dir, { recursive: true, force: true });
    });

    test("returns true when .git is a file (worktree link)", () => {
      const dir = mkdtempSync(join(tmpdir(), "arb-linked-"));
      writeFileSync(join(dir, ".git"), "gitdir: /some/path/to/worktrees/ws");
      expect(isLinkedWorktree(dir)).toBe(true);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("isCaseInsensitiveFS", () => {
    test("returns a boolean matching the platform", () =>
      withRepo(async ({ repoDir }) => {
        const result = await isCaseInsensitiveFS(repoDir);
        expect(typeof result).toBe("boolean");
        // On macOS (HFS+/APFS) this is true; on Linux ext4 this is false.
        // We verify it matches what git auto-detected during clone.
        const proc = Bun.spawnSync(["git", "-C", repoDir, "config", "core.ignorecase"]);
        const expected = proc.exitCode === 0 && new TextDecoder().decode(proc.stdout).trim() === "true";
        expect(result).toBe(expected);
      }));
  });

  describe("isShallowRepo", () => {
    test("returns false for non-shallow repo", () =>
      withRepo(async ({ repoDir }) => {
        const shallow = await isShallowRepo(repoDir);
        expect(shallow).toBe(false);
      }));
  });

  describe("parseGitStatusFiles", () => {
    test("returns empty arrays for clean repo", () =>
      withRepo(async ({ repoDir }) => {
        const result = await parseGitStatusFiles(repoDir);
        expect(result.staged).toEqual([]);
        expect(result.unstaged).toEqual([]);
        expect(result.untracked).toEqual([]);
      }));

    test("classifies untracked files", () =>
      withRepo(async ({ repoDir }) => {
        writeFileSync(join(repoDir, "new.txt"), "new");
        const result = await parseGitStatusFiles(repoDir);
        expect(result.untracked).toContain("new.txt");
        expect(result.staged).toEqual([]);
        expect(result.unstaged).toEqual([]);
      }));

    test("classifies staged and unstaged files", () =>
      withRepo(async ({ repoDir }) => {
        writeFileSync(join(repoDir, "file.txt"), "initial");
        Bun.spawnSync(["git", "-C", repoDir, "add", "file.txt"]);
        Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add"]);
        // Modify and stage
        writeFileSync(join(repoDir, "file.txt"), "modified");
        Bun.spawnSync(["git", "-C", repoDir, "add", "file.txt"]);
        // Modify again (unstaged)
        writeFileSync(join(repoDir, "file.txt"), "modified again");
        const result = await parseGitStatusFiles(repoDir);
        expect(result.staged.length).toBe(1);
        expect(result.staged[0]?.file).toBe("file.txt");
        expect(result.unstaged.length).toBe(1);
        expect(result.unstaged[0]?.file).toBe("file.txt");
      }));
  });
});
