import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatWorktreeError, isWorktreeRefValid } from "./worktrees";

describe("formatWorktreeError", () => {
  const arbRoot = "/home/user/project";

  test("returns original stderr when no pattern match", () => {
    const stderr = "fatal: some unknown error";
    expect(formatWorktreeError(stderr, arbRoot)).toBe(stderr);
  });

  test("parses 'is already checked out at' pattern (newer git)", () => {
    const stderr = "fatal: 'feature' is already checked out at '/home/user/project/ws-one/repo-a'";
    expect(formatWorktreeError(stderr, arbRoot)).toBe("Branch 'feature' is already checked out in workspace 'ws-one'");
  });

  test("parses 'is already used by worktree at' pattern (older git)", () => {
    const stderr = "fatal: 'feature' is already used by worktree at '/home/user/project/ws-two/repo-b'";
    expect(formatWorktreeError(stderr, arbRoot)).toBe("Branch 'feature' is already checked out in workspace 'ws-two'");
  });

  test("returns full path when path is outside arbRootDir", () => {
    const stderr = "fatal: 'feature' is already checked out at '/other/location/repo'";
    expect(formatWorktreeError(stderr, arbRoot)).toBe(
      "Branch 'feature' is already checked out at /other/location/repo",
    );
  });

  test("returns original stderr when branch or path capture is missing", () => {
    const stderr = "fatal: '' is already checked out at ''";
    expect(formatWorktreeError(stderr, arbRoot)).toBe(stderr);
  });
});

describe("isWorktreeRefValid", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "arb-worktree-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns false when .git file is missing", () => {
    expect(isWorktreeRefValid(tmpDir)).toBe(false);
  });

  test("returns false when .git file does not start with 'gitdir: '", () => {
    writeFileSync(join(tmpDir, ".git"), "not a gitdir reference\n");
    expect(isWorktreeRefValid(tmpDir)).toBe(false);
  });

  test("returns false when worktree entry does not exist", () => {
    writeFileSync(join(tmpDir, ".git"), "gitdir: /nonexistent/path/worktrees/entry\n");
    expect(isWorktreeRefValid(tmpDir)).toBe(false);
  });

  test("returns false when back-reference does not match", () => {
    const entryDir = join(tmpDir, "worktree-entry");
    mkdirSync(entryDir);
    writeFileSync(join(entryDir, "gitdir"), "/some/other/path/.git\n");
    writeFileSync(join(tmpDir, ".git"), `gitdir: ${entryDir}\n`);
    expect(isWorktreeRefValid(tmpDir)).toBe(false);
  });

  test("returns true when forward and back references are consistent", () => {
    const entryDir = join(tmpDir, "worktree-entry");
    mkdirSync(entryDir);
    const gitPath = join(tmpDir, ".git");
    writeFileSync(join(entryDir, "gitdir"), gitPath);
    writeFileSync(gitPath, `gitdir: ${entryDir}`);
    expect(isWorktreeRefValid(tmpDir)).toBe(true);
  });
});
