import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWorktreeList, readGitdirFromWorktree } from "./clean";

describe("parseWorktreeList", () => {
  test("returns both paths from multi-worktree porcelain output", () => {
    const stdout = [
      "worktree /path/to/main",
      "HEAD abc1234",
      "branch refs/heads/main",
      "",
      "worktree /path/to/linked",
      "HEAD def5678",
      "branch refs/heads/feature",
      "",
    ].join("\n");

    expect(parseWorktreeList(stdout)).toEqual(["/path/to/main", "/path/to/linked"]);
  });

  test("returns single path from single worktree output", () => {
    const stdout = ["worktree /path/to/main", "HEAD abc1234", "branch refs/heads/main", ""].join("\n");

    expect(parseWorktreeList(stdout)).toEqual(["/path/to/main"]);
  });

  test("returns empty array for empty stdout", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });

  test("handles trailing newline correctly", () => {
    const stdout = "worktree /path/to/main\nHEAD abc1234\nbranch refs/heads/main\n";

    expect(parseWorktreeList(stdout)).toEqual(["/path/to/main"]);
  });
});

describe("readGitdirFromWorktree", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "arb-clean-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns null when .git file does not exist", () => {
    expect(readGitdirFromWorktree(tmpDir)).toBeNull();
  });

  test("returns null when .git content does not start with 'gitdir: '", () => {
    writeFileSync(join(tmpDir, ".git"), "not a valid gitdir reference\n");
    expect(readGitdirFromWorktree(tmpDir)).toBeNull();
  });

  test("returns the gitdir path when valid", () => {
    writeFileSync(join(tmpDir, ".git"), "gitdir: /path/to/.git/worktrees/my-worktree\n");
    expect(readGitdirFromWorktree(tmpDir)).toBe("/path/to/.git/worktrees/my-worktree");
  });

  test("trims whitespace from content", () => {
    writeFileSync(join(tmpDir, ".git"), "  gitdir: /path/to/worktree  \n");
    expect(readGitdirFromWorktree(tmpDir)).toBe("/path/to/worktree");
  });
});
