import { describe, expect, test } from "bun:test";
import { makeRepo } from "../status/test-helpers";
import type { RepoStatus } from "../status/types";
import { assessRetargetRepo, type RetargetClassifierDeps } from "./classify-retarget";

const DIR = "/tmp/test-repo";

const noopDeps: RetargetClassifierDeps = {
  remoteBranchExists: async () => true,
  branchExistsLocally: async () => false,
  detectBranchMerged: async () => null,
  getShortHead: async () => "abc1234",
  analyzeRetargetReplay: async () => null,
};

const noopCache = {
  getDefaultBranch: async () => "main",
};

function assess(
  status: RepoStatus,
  targetBranch: string | null = "develop",
  opts: { autostash?: boolean; includeWrongBranch?: boolean } = {},
  deps: Partial<RetargetClassifierDeps> = {},
) {
  return assessRetargetRepo(
    status,
    DIR,
    "feature",
    targetBranch,
    [],
    {
      autostash: opts.autostash ?? false,
      includeWrongBranch: opts.includeWrongBranch ?? false,
      cache: noopCache,
    },
    { ...noopDeps, ...deps },
  );
}

describe("assessRetargetRepo", () => {
  test("skips when fetch failed", async () => {
    const a = await assessRetargetRepo(
      makeRepo(),
      DIR,
      "feature",
      "develop",
      ["test-repo"],
      {
        autostash: false,
        includeWrongBranch: false,
        cache: noopCache,
      },
      noopDeps,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("fetch-failed");
  });

  test("skips when operation in progress", async () => {
    const a = await assess(makeRepo({ operation: "rebase" }));
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("operation-in-progress");
  });

  test("skips detached HEAD", async () => {
    const a = await assess(
      makeRepo({ identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false } }),
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("detached-head");
  });

  test("skips wrong branch", async () => {
    const a = await assess(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
      }),
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("wrong-branch");
    expect(a.skipReason).toContain("use --include-wrong-branch");
  });

  test("includes wrong branch with includeWrongBranch", async () => {
    const a = await assess(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 3,
          baseMergedIntoDefault: null,
        },
      }),
      "develop",
      { includeWrongBranch: true },
    );
    expect(a.outcome).not.toBe("skip");
    expect(a.wrongBranch).toBe(true);
  });

  test("skips when no base branch", async () => {
    const a = await assess(makeRepo({ base: null }));
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("no-base-branch");
  });

  test("skips when target branch not found on remote", async () => {
    const a = await assess(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      "develop",
      {},
      { remoteBranchExists: async () => false },
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("retarget-target-not-found");
  });

  test("skips when already based on target", async () => {
    const a = await assess(
      makeRepo({
        base: {
          remote: "origin",
          ref: "develop",
          configuredRef: "develop",
          resolvedVia: "remote",
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      "develop",
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("retarget-same-base");
    expect(a.skipReason).toContain("already based on");
  });

  test("skips when old base branch not found", async () => {
    const a = await assess(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      "develop",
      {},
      {
        remoteBranchExists: async (_dir, branch) => branch === "develop",
        branchExistsLocally: async () => false,
      },
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("retarget-base-not-found");
  });

  test("skips dirty repos without autostash", async () => {
    const a = await assess(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 3,
          baseMergedIntoDefault: null,
        },
        local: { staged: 0, modified: 1, untracked: 0, conflicts: 0 },
      }),
      "develop",
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("dirty");
    expect(a.skipReason).toContain("use --autostash");
  });

  test("will-retarget with autostash for dirty repo", async () => {
    const a = await assess(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 3,
          baseMergedIntoDefault: null,
        },
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
      }),
      "develop",
      { autostash: true },
    );
    expect(a.outcome).toBe("will-retarget");
    expect(a.needsStash).toBe(true);
  });

  test("will-retarget for clean repo needing retarget", async () => {
    const a = await assess(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 3,
          baseMergedIntoDefault: null,
        },
      }),
      "develop",
    );
    expect(a.outcome).toBe("will-retarget");
  });

  test("up-to-date when ref matches target and behind is 0", async () => {
    const a = await assess(
      makeRepo({
        base: {
          remote: "origin",
          ref: "develop",
          configuredRef: "main",
          resolvedVia: "remote",
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      "develop",
    );
    expect(a.outcome).toBe("up-to-date");
  });

  test("resolves target from default branch when targetBranch is null", async () => {
    const a = await assess(
      makeRepo({
        base: {
          remote: "origin",
          ref: "old-base",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 3,
          baseMergedIntoDefault: null,
        },
      }),
      null,
    );
    expect(a.outcome).toBe("will-retarget");
    expect(a.targetBranch).toBe("main");
  });

  test("skips when default branch cannot be resolved", async () => {
    const a = await assessRetargetRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "old-base",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      null,
      [],
      {
        autostash: false,
        includeWrongBranch: false,
        cache: { getDefaultBranch: async () => null },
      },
      noopDeps,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("retarget-no-default");
  });
});
