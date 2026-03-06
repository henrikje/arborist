import { describe, expect, test } from "bun:test";
import { parseWorktreeList } from "./clean";

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
