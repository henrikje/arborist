import { describe, expect, test } from "bun:test";
import { makeRepo } from "../status/test-helpers";
import { assessExtractRepo } from "./classify-extract";

const DIR = "/tmp/test-repo";
const SHA = "abc1234";
const MERGE_BASE = "000base";
const BOUNDARY = "111boundary";
const TARGET = "prereq";

const defaultOptions = { autostash: false, includeWrongBranch: false };
const defaultDeps = { getShortHead: async () => SHA };

describe("assessExtractRepo", () => {
  // ── Skip gates ──

  test("skips when fetch failed", async () => {
    const a = await assessExtractRepo(
      makeRepo(),
      DIR,
      "feature",
      "prefix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      ["test-repo"],
      defaultOptions,
      defaultDeps,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("fetch-failed");
  });

  test("skips when operation in progress", async () => {
    const a = await assessExtractRepo(
      makeRepo({ operation: "rebase" }),
      DIR,
      "feature",
      "prefix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      [],
      defaultOptions,
      defaultDeps,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("operation-in-progress");
  });

  test("skips detached HEAD", async () => {
    const a = await assessExtractRepo(
      makeRepo({ identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false } }),
      DIR,
      "feature",
      "prefix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      [],
      defaultOptions,
      defaultDeps,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("detached-head");
  });

  test("skips wrong branch", async () => {
    const a = await assessExtractRepo(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
      }),
      DIR,
      "feature",
      "prefix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      [],
      defaultOptions,
      defaultDeps,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("wrong-branch");
  });

  test("includes wrong branch with includeWrongBranch", async () => {
    const a = await assessExtractRepo(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 3,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      "prefix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      [],
      { autostash: false, includeWrongBranch: true },
      defaultDeps,
    );
    expect(a.outcome).toBe("will-extract");
    expect(a.wrongBranch).toBe(true);
    expect(a.branch).toBe("other");
  });

  test("skips when no base branch", async () => {
    const a = await assessExtractRepo(
      makeRepo({ base: null }),
      DIR,
      "feature",
      "prefix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      [],
      defaultOptions,
      defaultDeps,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("no-base-branch");
  });

  test("skips dirty without autostash", async () => {
    const a = await assessExtractRepo(
      makeRepo({
        local: { staged: 0, modified: 1, untracked: 0, conflicts: 0 },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 3,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      "prefix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      [],
      defaultOptions,
      defaultDeps,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("dirty");
  });

  test("sets needsStash with autostash and dirty", async () => {
    const a = await assessExtractRepo(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 3,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      "prefix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      [],
      { autostash: true, includeWrongBranch: false },
      defaultDeps,
    );
    expect(a.outcome).toBe("will-extract");
    expect(a.needsStash).toBe(true);
  });

  // ── No-op cases ──

  test("no-op when zero commits ahead of base", async () => {
    const a = await assessExtractRepo(
      makeRepo(),
      DIR,
      "feature",
      "prefix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      [],
      defaultOptions,
      defaultDeps,
    );
    expect(a.outcome).toBe("no-op");
  });

  test("no-op when no boundary specified", async () => {
    const a = await assessExtractRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 5,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      "prefix",
      TARGET,
      null,
      MERGE_BASE,
      [],
      defaultOptions,
      defaultDeps,
    );
    expect(a.outcome).toBe("no-op");
    expect(a.commitsRemaining).toBe(5);
  });

  // ── Will-extract cases ──

  test("will-extract prefix with boundary", async () => {
    const a = await assessExtractRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 5,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      "prefix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      [],
      defaultOptions,
      defaultDeps,
    );
    expect(a.outcome).toBe("will-extract");
    expect(a.direction).toBe("prefix");
    expect(a.boundary).toBe(BOUNDARY);
  });

  test("will-extract suffix with boundary", async () => {
    const a = await assessExtractRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 5,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      "suffix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      [],
      defaultOptions,
      defaultDeps,
    );
    expect(a.outcome).toBe("will-extract");
    expect(a.direction).toBe("suffix");
    expect(a.boundary).toBe(BOUNDARY);
  });

  test("preserves base resolution info", async () => {
    const a = await assessExtractRepo(
      makeRepo({
        base: {
          remote: null,
          ref: "prereq",
          configuredRef: null,
          resolvedVia: "local",
          sourceWorkspace: "prereq-ws",
          ahead: 3,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      "prefix",
      TARGET,
      BOUNDARY,
      MERGE_BASE,
      [],
      defaultOptions,
      defaultDeps,
    );
    expect(a.outcome).toBe("will-extract");
    expect(a.baseResolvedLocally).toBe(true);
    expect(a.baseRemote).toBe("");
  });
});
