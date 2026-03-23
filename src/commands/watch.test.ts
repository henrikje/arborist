import { describe, expect, test } from "bun:test";
import { buildCanonicalGitDirFilter } from "./watch";

describe("buildCanonicalGitDirFilter", () => {
  const filter = buildCanonicalGitDirFilter("my-workspace");

  // --- Paths that should NOT be ignored (relevant signals) ---

  test("allows refs/heads/ changes", () => {
    expect(filter("refs/heads/main")).toBe(false);
    expect(filter("refs/heads/my-workspace")).toBe(false);
  });

  test("allows refs/remotes/ changes", () => {
    expect(filter("refs/remotes/origin/main")).toBe(false);
  });

  test("allows refs/stash", () => {
    expect(filter("refs/stash")).toBe(false);
  });

  test("allows packed-refs", () => {
    expect(filter("packed-refs")).toBe(false);
  });

  test("allows this worktree's entry dir", () => {
    expect(filter("worktrees/my-workspace/HEAD")).toBe(false);
    expect(filter("worktrees/my-workspace/index")).toBe(false);
    expect(filter("worktrees/my-workspace/MERGE_HEAD")).toBe(false);
    expect(filter("worktrees/my-workspace/REBASE_HEAD")).toBe(false);
    expect(filter("worktrees/my-workspace/CHERRY_PICK_HEAD")).toBe(false);
  });

  // --- Paths that SHOULD be ignored (cross-workspace noise) ---

  test("ignores objects/ (biggest noise source)", () => {
    expect(filter("objects/ab/cdef1234567890")).toBe(true);
    expect(filter("objects/pack/pack-abc.idx")).toBe(true);
  });

  test("ignores logs/", () => {
    expect(filter("logs/refs/heads/main")).toBe(true);
    expect(filter("logs/HEAD")).toBe(true);
  });

  test("ignores other worktree entries", () => {
    expect(filter("worktrees/other-workspace/HEAD")).toBe(true);
    expect(filter("worktrees/other-workspace/index")).toBe(true);
  });

  test("ignores root-level git files", () => {
    expect(filter("index")).toBe(true);
    expect(filter("HEAD")).toBe(true);
    expect(filter("FETCH_HEAD")).toBe(true);
    expect(filter("config")).toBe(true);
  });

  test("ignores .lock files even in allowed paths", () => {
    expect(filter("refs/heads/main.lock")).toBe(true);
    expect(filter("packed-refs.lock")).toBe(true);
    expect(filter("worktrees/my-workspace/index.lock")).toBe(true);
  });
});
