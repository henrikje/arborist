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
        base: { remote: "origin", ref: "main", configuredRef: null, ahead: 0, behind: 3, baseMergedIntoDefault: null },
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

  test("skips dirty without autostash", () => {
    const a = classifyRepo(
      makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
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
        base: { remote: "origin", ref: "main", configuredRef: null, ahead: 0, behind: 3, baseMergedIntoDefault: null },
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
        base: { remote: null, ref: "main", configuredRef: null, ahead: 0, behind: 0, baseMergedIntoDefault: null },
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

  test("skips when already merged", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
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
        base: { remote: "origin", ref: "main", configuredRef: null, ahead: 2, behind: 5, baseMergedIntoDefault: null },
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
});

// ── assessIntegrateRepo helpers ──

function defaultOptions(overrides: Record<string, unknown> = {}) {
  return {
    retarget: false,
    retargetExplicit: null as string | null,
    autostash: false,
    includeWrongBranch: false,
    cache: { getDefaultBranch: async () => "main" },
    mode: "rebase" as const,
    ...overrides,
  };
}

function mockDeps(overrides: Record<string, unknown> = {}) {
  return {
    getShortHead: async () => SHA,
    git: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    remoteBranchExists: async () => true,
    branchExistsLocally: async () => false,
    detectBranchMerged: async () => null,
    analyzeRetargetReplay: async () => null,
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
        ahead: 4,
        behind: 3,
        merge: { kind: "merge", newCommitsAfter: 2 },
        baseMergedIntoDefault: null,
      },
    });
    // When boundary rev-parse fails, falls through to explicit retarget (which returns null since retargetExplicit is null)
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ mode: "rebase" }),
      mockDeps({ git: async () => ({ exitCode: 1, stdout: "", stderr: "" }) }),
    );
    // Falls through all assess* → returns classified (which is skip/already-merged)
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("already-merged");
  });

  test("explicit retarget: old base not found blocks retarget", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/old",
        configuredRef: null,
        ahead: 1,
        behind: 2,
        baseMergedIntoDefault: "merge",
      },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ retarget: true, retargetExplicit: "main" }),
      mockDeps({
        remoteBranchExists: async (_: string, branch: string) => branch === "main",
        branchExistsLocally: async () => false,
      }),
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("retarget-base-not-found");
    expect(a.retarget?.blocked).toBe(true);
  });

  test("explicit retarget: already on target (behind=0) returns up-to-date", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        ahead: 2,
        behind: 0,
        baseMergedIntoDefault: "merge",
      },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ retarget: true, retargetExplicit: "main" }),
      mockDeps(),
    );
    expect(a.outcome).toBe("up-to-date");
    expect(a.baseBranch).toBe("main");
    expect(a.retarget?.to).toBe("main");
  });

  test("explicit retarget: full retarget with replay analysis", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/old",
        configuredRef: "feat/old",
        ahead: 3,
        behind: 5,
        baseMergedIntoDefault: "merge",
      },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ retarget: true, retargetExplicit: "main" }),
      mockDeps({
        analyzeRetargetReplay: async () => ({ toReplay: 2, alreadyOnTarget: 1, totalLocal: 3 }),
      }),
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.baseBranch).toBe("main");
    expect(a.retarget?.from).toBe("feat/old");
    expect(a.retarget?.to).toBe("main");
    expect(a.retarget?.replayCount).toBe(2);
    expect(a.retarget?.alreadyOnTarget).toBe(1);
  });

  test("explicit retarget: warns when old base may not be merged", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/old",
        configuredRef: null,
        ahead: 3,
        behind: 5,
        baseMergedIntoDefault: "merge",
      },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ retarget: true, retargetExplicit: "main" }),
      mockDeps({ detectBranchMerged: async () => null }),
    );
    expect(a.retarget?.warning).toContain("may not be merged");
  });

  test("explicit retarget skipped when configuredRef set and baseMergedIntoDefault is null", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/stacked",
        configuredRef: "feat/stacked",
        ahead: 1,
        behind: 2,
        baseMergedIntoDefault: null,
      },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ retarget: true, retargetExplicit: "main" }),
      mockDeps(),
    );
    // Should return classified without retarget (will-operate, not retargeted)
    expect(a.outcome).toBe("will-operate");
    expect(a.retarget).toBeUndefined();
  });

  test("auto-retarget: contiguous replay plan with alreadyOnTarget>0 and toReplay=0 → up-to-date", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
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

  test("auto-retarget: contiguous replay plan with toReplay>0 → will-operate with retarget", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
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

  test("auto-retarget: baseMergedIntoDefault triggers retarget when retarget=true", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/old",
        configuredRef: "feat/old",
        ahead: 1,
        behind: 2,
        baseMergedIntoDefault: "merge",
      },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ retarget: true }),
      mockDeps({
        remoteBranchExists: async () => true,
        analyzeRetargetReplay: async () => ({ toReplay: 1, alreadyOnTarget: 0, totalLocal: 1 }),
      }),
    );
    expect(a.outcome).toBe("will-operate");
    expect(a.baseBranch).toBe("main");
    expect(a.retarget?.from).toBe("feat/old");
    expect(a.retarget?.to).toBe("main");
  });

  test("auto-retarget: retarget=false returns classified unchanged", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/old",
        configuredRef: null,
        ahead: 1,
        behind: 2,
        baseMergedIntoDefault: "merge",
      },
    });
    const a = await assessIntegrateRepo(status, DIR, "feature", [], defaultOptions({ retarget: false }), mockDeps());
    // baseMergedIntoDefault skip, retarget not applied
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("base-merged-into-default");
  });

  test("reports missing explicit retarget target as a blocked skip", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/old",
        configuredRef: null,
        ahead: 1,
        behind: 2,
        baseMergedIntoDefault: "merge",
      },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ retarget: true, retargetExplicit: "main" }),
      mockDeps({ remoteBranchExists: async () => false }),
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("retarget-target-not-found");
    expect(a.retarget?.blocked).toBe(true);
  });

  test("reports auto-retarget failure when the default branch cannot be resolved", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/old",
        configuredRef: null,
        ahead: 1,
        behind: 2,
        baseMergedIntoDefault: "merge",
      },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ retarget: true, cache: { getDefaultBranch: async () => null } }),
      mockDeps(),
    );
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("retarget-no-default");
  });

  test("auto-retarget: squash-merged base already on default → up-to-date", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/old",
        configuredRef: "feat/old",
        ahead: 1,
        behind: 2,
        baseMergedIntoDefault: "squash",
      },
    });
    const a = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      defaultOptions({ retarget: true }),
      mockDeps({
        // merge-base --is-ancestor defaultRef HEAD → exit 0 (already on default)
        git: async (_: string, ...args: string[]) => {
          if (args[0] === "merge-base") return { exitCode: 0, stdout: "", stderr: "" };
          return { exitCode: 1, stdout: "", stderr: "" };
        },
      }),
    );
    expect(a.outcome).toBe("up-to-date");
    expect(a.baseBranch).toBe("main");
    expect(a.retarget?.from).toBe("feat/old");
    expect(a.retarget?.to).toBe("main");
    expect(a.retarget?.reason).toBe("base-merged");
  });
});
