import { describe, expect, test } from "bun:test";
import { makeRepo } from "../status/test-helpers";
import { assessIntegrateRepo, classifyRepo } from "./classify-integrate";

const DIR = "/tmp/test-repo";
const SHA = "abc1234";

// ── classifyRepo ──

describe("classifyRepo", () => {
  test("returns up-to-date when behind base is 0", () => {
    const assessment = classifyRepo(makeRepo(), DIR, "feature", [], false, SHA);
    expect(assessment.outcome).toBe("up-to-date");
    expect(assessment.baseBranch).toBe("main");
  });

  test("skips when fetch failed", () => {
    const a = classifyRepo(makeRepo(), DIR, "feature", ["test-repo"], false, SHA);
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("fetch-failed");
  });

  test("skips when operation in progress", () => {
    const a = classifyRepo(makeRepo({ operation: "rebase" }), DIR, "feature", [], false, SHA);
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("operation-in-progress");
  });

  test("skips detached HEAD", () => {
    const a = classifyRepo(
      makeRepo({ identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false } }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("detached-head");
  });

  test("skips wrong branch", () => {
    const a = classifyRepo(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("wrong-branch");
  });

  test("includes wrong branch with includeWrongBranch", () => {
    const a = classifyRepo(
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
      DIR,
      "feature",
      [],
      false,
      SHA,
      true,
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.wrongBranch).toBe(true);
    expect(a.branch).toBe("other");
  });

  test("dirty but up-to-date returns up-to-date", () => {
    const a = classifyRepo(
      makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("up-to-date");
  });

  test("skips dirty without autostash when behind base", () => {
    const a = classifyRepo(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
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
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("dirty");
  });

  test("sets needsStash when dirty with autostash", () => {
    const a = classifyRepo(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
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
      DIR,
      "feature",
      [],
      true,
      SHA,
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.needsStash).toBe(true);
  });

  test("skips when no base branch", () => {
    const a = classifyRepo(makeRepo({ base: null }), DIR, "feature", [], false, SHA);
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("no-base-branch");
  });

  test("skips when no base remote", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: null,
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("no-base-remote");
  });

  test("does not skip when base resolved locally with null remote", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: null,
          ref: "feat/base",
          configuredRef: null,
          resolvedVia: "local",
          ahead: 3,
          behind: 1,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.baseResolvedLocally).toBe(true);
    expect(a.baseBranch).toBe("feat/base");
  });

  test("skips when already merged", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 0,
          merge: { kind: "merge" },
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("already-merged");
  });

  test("skips when squash-merged", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 0,
          merge: { kind: "squash" },
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipReason).toContain("squash-merged");
  });

  test("skips when base merged into default", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "feat/old",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 3,
          baseMergedIntoDefault: "merge",
        },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("base-merged-into-default");
  });

  test("will-operate when behind > 0", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 2,
          behind: 5,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.behind).toBe(5);
    expect(a.ahead).toBe(2);
  });

  test("sets baseFallback when configuredRef is set and will-operate", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: "big-filter-overview",
          resolvedVia: "remote",
          ahead: 2,
          behind: 5,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.baseFallback).toBe("big-filter-overview");
  });

  test("sets baseFallback when configuredRef is set and up-to-date", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: "big-filter-overview",
          resolvedVia: "remote",
          ahead: 2,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("up-to-date");
    expect(a.baseFallback).toBe("big-filter-overview");
  });

  test("does not set baseFallback when configuredRef is null", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 2,
          behind: 5,
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.baseFallback).toBeUndefined();
  });

  test("does not set baseFallback when baseMergedIntoDefault is detected (skip)", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "feat/old",
          configuredRef: "feat/old",
          resolvedVia: "remote",
          ahead: 0,
          behind: 3,
          baseMergedIntoDefault: "merge",
        },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("base-merged-into-default");
    expect(a.baseFallback).toBeUndefined();
  });
});

// ── assessIntegrateRepo helpers ──

function defaultOptions(overrides: Record<string, unknown> = {}) {
  return {
    autostash: false,
    includeWrongBranch: false,
    mode: "rebase" as const,
    ...overrides,
  };
}

function mockDeps(overrides: Record<string, unknown> = {}) {
  return {
    getShortHead: async () => SHA,
    git: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    ...overrides,
  };
}

// ── assessIntegrateRepo ──

describe("assessIntegrateRepo", () => {
  test("treats merged-new-work as normal merge work in merge mode (behind > 0)", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 4,
        behind: 3,
        merge: { kind: "merge", newCommitsAfter: 2 },
        baseMergedIntoDefault: null,
      },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ mode: "merge" }), mockDeps());
    expect(a.outcome).toBe("will-operate");
    expect(a.behind).toBe(3);
    expect(a.ahead).toBe(4);
  });

  test("treats merged-new-work as up-to-date in merge mode when behind = 0", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 2,
        behind: 0,
        merge: { kind: "merge", newCommitsAfter: 2 },
        baseMergedIntoDefault: null,
      },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ mode: "merge" }), mockDeps());
    expect(a.outcome).toBe("up-to-date");
  });

  test("merged-new-work in rebase mode computes retarget from boundary SHA", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 4,
        behind: 3,
        merge: { kind: "merge", newCommitsAfter: 2 },
        baseMergedIntoDefault: null,
      },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ mode: "rebase" }),
      mockDeps({ git: async () => ({ exitCode: 0, stdout: "deadbeef\n", stderr: "" }) }),
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.retarget?.from).toBe("deadbeef");
    expect(a.retarget?.to).toBe("main");
    expect(a.retarget?.replayCount).toBe(2);
    expect(a.retarget?.reason).toBe("branch-merged");
  });

  test("merged-new-work in rebase mode returns null when rev-parse fails", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 4,
        behind: 3,
        merge: { kind: "merge", newCommitsAfter: 2 },
        baseMergedIntoDefault: null,
      },
    });
    // When boundary rev-parse fails, falls through → returns classified (which is skip/already-merged)
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ mode: "rebase" }),
      mockDeps({ git: async () => ({ exitCode: 1, stdout: "", stderr: "" }) }),
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("already-merged");
  });

  // ── merged-new-work dirty checks ──

  test("merged-new-work with dirty worktree and no autostash returns skip (dirty)", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 4,
        behind: 3,
        merge: { kind: "merge", newCommitsAfter: 2 },
        baseMergedIntoDefault: null,
      },
      local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ autostash: false, mode: "rebase" }),
      mockDeps({ git: async () => ({ exitCode: 0, stdout: "deadbeef\n", stderr: "" }) }),
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("dirty");
  });

  test("merged-new-work with dirty worktree and autostash returns will-operate with needsStash (rebase)", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 4,
        behind: 3,
        merge: { kind: "merge", newCommitsAfter: 2 },
        baseMergedIntoDefault: null,
      },
      local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ autostash: true, mode: "rebase" }),
      mockDeps({ git: async () => ({ exitCode: 0, stdout: "deadbeef\n", stderr: "" }) }),
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.needsStash).toBe(true);
    expect(a.retarget?.from).toBe("deadbeef");
  });

  test("merged-new-work with dirty worktree and autostash returns will-operate with needsStash (merge)", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 4,
        behind: 3,
        merge: { kind: "merge", newCommitsAfter: 2 },
        baseMergedIntoDefault: null,
      },
      local: { staged: 0, modified: 1, untracked: 0, conflicts: 0 },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ autostash: true, mode: "merge" }),
      mockDeps(),
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.needsStash).toBe(true);
  });

  test("merged-new-work in merge mode with behind=0 returns up-to-date even when dirty", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 4,
        behind: 0,
        merge: { kind: "merge", newCommitsAfter: 2 },
        baseMergedIntoDefault: null,
      },
      local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ autostash: false, mode: "merge" }),
      mockDeps(),
    );
    expect(a.outcome).toBe("up-to-date");
  });

  test("merged-new-work with untracked-only changes and autostash does not set needsStash", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 4,
        behind: 3,
        merge: { kind: "merge", newCommitsAfter: 2 },
        baseMergedIntoDefault: null,
      },
      local: { staged: 0, modified: 0, untracked: 3, conflicts: 0 },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ autostash: true, mode: "rebase" }),
      mockDeps({ git: async () => ({ exitCode: 0, stdout: "deadbeef\n", stderr: "" }) }),
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.needsStash).toBeUndefined();
  });

  test("baseMergedIntoDefault returns skip", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/old",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 1,
        behind: 2,
        baseMergedIntoDefault: "merge",
      },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions(), mockDeps());
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("base-merged-into-default");
  });

  test("contiguous replay plan with alreadyOnTarget>0 and toReplay=0 returns up-to-date", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 5,
        replayPlan: { totalLocal: 3, alreadyOnTarget: 3, toReplay: 0, contiguous: true },
        baseMergedIntoDefault: null,
      },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ mode: "rebase" }), mockDeps());
    expect(a.outcome).toBe("up-to-date");
    expect(a.behind).toBe(0);
  });

  test("contiguous replay plan with toReplay>0 returns will-operate with branch-merged retarget", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 5,
        behind: 3,
        replayPlan: { totalLocal: 5, alreadyOnTarget: 3, toReplay: 2, contiguous: true },
        baseMergedIntoDefault: null,
      },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ mode: "rebase" }), mockDeps());
    expect(a.outcome).toBe("will-operate");
    expect(a.retarget?.replayCount).toBe(2);
    expect(a.retarget?.alreadyOnTarget).toBe(3);
    expect(a.retarget?.reason).toBe("branch-merged");
  });

  // ── fully-merged (no new work) ──

  test("fully-merged in rebase mode with behind > 0 returns will-operate with retarget (replayCount=0)", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 5,
        behind: 3,
        merge: { kind: "merge" },
        baseMergedIntoDefault: null,
      },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ mode: "rebase" }), mockDeps());
    expect(a.outcome).toBe("will-operate");
    expect(a.retarget?.replayCount).toBe(0);
    expect(a.retarget?.alreadyOnTarget).toBe(5);
    expect(a.retarget?.reason).toBe("branch-merged");
    expect(a.behind).toBe(3);
    expect(a.ahead).toBe(0);
  });

  test("fully-merged squash in rebase mode with behind > 0 returns will-operate with retarget", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 2,
        merge: { kind: "squash" },
        baseMergedIntoDefault: null,
      },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ mode: "rebase" }), mockDeps());
    expect(a.outcome).toBe("will-operate");
    expect(a.retarget?.replayCount).toBe(0);
    expect(a.retarget?.alreadyOnTarget).toBe(3);
    expect(a.retarget?.reason).toBe("branch-merged");
  });

  test("fully-merged in merge mode with behind > 0 returns will-operate (standard merge)", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 5,
        behind: 3,
        merge: { kind: "merge" },
        baseMergedIntoDefault: null,
      },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ mode: "merge" }), mockDeps());
    expect(a.outcome).toBe("will-operate");
    expect(a.behind).toBe(3);
    expect(a.ahead).toBe(5);
    expect(a.retarget).toBeUndefined();
  });

  test("fully-merged with behind=0 and ahead=0 returns up-to-date", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 0,
        behind: 0,
        merge: { kind: "merge" },
        baseMergedIntoDefault: null,
      },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ mode: "rebase" }), mockDeps());
    expect(a.outcome).toBe("up-to-date");
  });

  test("fully-merged in merge mode with behind=0 returns up-to-date", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 0,
        merge: { kind: "squash" },
        baseMergedIntoDefault: null,
      },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ mode: "merge" }), mockDeps());
    expect(a.outcome).toBe("up-to-date");
  });

  test("fully-merged with dirty worktree and no autostash returns skip (dirty)", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 2,
        merge: { kind: "merge" },
        baseMergedIntoDefault: null,
      },
      local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ autostash: false }), mockDeps());
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("dirty");
  });

  test("fully-merged with dirty worktree and autostash returns will-operate with needsStash", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 3,
        behind: 2,
        merge: { kind: "merge" },
        baseMergedIntoDefault: null,
      },
      local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ autostash: true }), mockDeps());
    expect(a.outcome).toBe("will-operate");
    expect(a.needsStash).toBe(true);
  });
});
