import { describe, expect, test } from "bun:test";
import { type ChainWalkDeps, walkRetargetChain } from "./retarget-chain";

function makeDeps(overrides: Partial<ChainWalkDeps> = {}): ChainWalkDeps {
  return {
    readWorkspaceBase: () => null,
    isBranchMerged: async () => false,
    findWorkspaceForBranch: () => null,
    ...overrides,
  };
}

describe("walkRetargetChain", () => {
  test("returns no-walk when sourceWorkspace is undefined", async () => {
    const result = await walkRetargetChain("feat-b", undefined, makeDeps());
    expect(result).toEqual({ targetBranch: null, walkedPath: [], didWalk: false });
  });

  test("basic walk: merged base with non-merged ancestor", async () => {
    // Stack: main <- feat-a <- feat-b <- feat-c
    // feat-b is merged, feat-a is not
    const deps = makeDeps({
      readWorkspaceBase: (ws) => (ws === "ws-b" ? "feat-a" : null),
      isBranchMerged: async (branch) => branch !== "feat-a",
    });

    const result = await walkRetargetChain("feat-b", "ws-b", deps);
    expect(result.targetBranch).toBe("feat-a");
    expect(result.didWalk).toBe(true);
    expect(result.walkedPath).toEqual(["feat-b"]);
  });

  test("deep walk: two intermediates merged", async () => {
    // Stack: main <- feat-a <- feat-b <- feat-c <- feat-d
    // feat-c and feat-b are merged, feat-a is not
    const deps = makeDeps({
      readWorkspaceBase: (ws) => {
        if (ws === "ws-c") return "feat-b";
        if (ws === "ws-b") return "feat-a";
        return null;
      },
      isBranchMerged: async (branch) => branch !== "feat-a",
      findWorkspaceForBranch: (branch) => (branch === "feat-b" ? "ws-b" : null),
    });

    const result = await walkRetargetChain("feat-c", "ws-c", deps);
    expect(result.targetBranch).toBe("feat-a");
    expect(result.didWalk).toBe(true);
    expect(result.walkedPath).toEqual(["feat-c", "feat-b"]);
  });

  test("deleted workspace: readWorkspaceBase returns null", async () => {
    const deps = makeDeps({
      readWorkspaceBase: () => null,
    });

    const result = await walkRetargetChain("feat-b", "ws-b", deps);
    expect(result.targetBranch).toBeNull();
    expect(result.didWalk).toBe(false);
    expect(result.walkedPath).toEqual([]);
  });

  test("no base in intermediate config after one level: falls through to default", async () => {
    // Stack: main <- feat-a <- feat-b <- feat-c
    // feat-b is merged, ws-a exists but has no base (targets default branch)
    const deps = makeDeps({
      readWorkspaceBase: (ws) => {
        if (ws === "ws-b") return "feat-a";
        if (ws === "ws-a") return null; // ws-a exists but has no base
        return null;
      },
      isBranchMerged: async () => true,
      findWorkspaceForBranch: (branch) => (branch === "feat-a" ? "ws-a" : null),
    });

    const result = await walkRetargetChain("feat-b", "ws-b", deps);
    expect(result.targetBranch).toBeNull();
    // Walked past feat-b, then ws-a had no base — chain terminates
    expect(result.didWalk).toBe(true);
    expect(result.walkedPath).toEqual(["feat-b"]);
  });

  test("circular reference detected", async () => {
    // feat-a base = feat-b, feat-b base = feat-a (both merged)
    const deps = makeDeps({
      readWorkspaceBase: (ws) => {
        if (ws === "ws-b") return "feat-a";
        if (ws === "ws-a") return "feat-b";
        return null;
      },
      isBranchMerged: async () => true,
      findWorkspaceForBranch: (branch) => {
        if (branch === "feat-a") return "ws-a";
        if (branch === "feat-b") return "ws-b";
        return null;
      },
    });

    const result = await walkRetargetChain("feat-b", "ws-b", deps);
    expect(result.targetBranch).toBeNull();
    // Walked at least one step before detecting cycle
    expect(result.walkedPath.length).toBeGreaterThan(0);
  });

  test("depth limit hit", async () => {
    // Infinite chain: every workspace has a base that is merged
    let counter = 0;
    const deps = makeDeps({
      readWorkspaceBase: () => `feat-${counter++}`,
      isBranchMerged: async () => true,
      findWorkspaceForBranch: (branch) => `ws-${branch}`,
    });

    const result = await walkRetargetChain("feat-start", "ws-start", deps, 3);
    expect(result.targetBranch).toBeNull();
    expect(result.didWalk).toBe(true);
    expect(result.walkedPath.length).toBeLessThanOrEqual(3);
  });

  test("entire chain merged down to default: returns null", async () => {
    // Stack: main <- feat-a <- feat-b. Both merged.
    // ws-b base = feat-a (merged), ws-a base = null (targets main)
    const deps = makeDeps({
      readWorkspaceBase: (ws) => {
        if (ws === "ws-b") return "feat-a";
        if (ws === "ws-a") return null;
        return null;
      },
      isBranchMerged: async () => true,
      findWorkspaceForBranch: (branch) => (branch === "feat-a" ? "ws-a" : null),
    });

    const result = await walkRetargetChain("feat-b", "ws-b", deps);
    expect(result.targetBranch).toBeNull();
    // Walked past feat-b (found its base feat-a), then ws-a has no base — chain ends
    expect(result.walkedPath).toEqual(["feat-b"]);
    expect(result.didWalk).toBe(true);
  });

  test("maxDepth of 0 skips walking entirely", async () => {
    const deps = makeDeps({
      readWorkspaceBase: () => "feat-a",
      isBranchMerged: async () => false,
    });

    const result = await walkRetargetChain("feat-b", "ws-b", deps, 0);
    expect(result).toEqual({ targetBranch: null, walkedPath: [], didWalk: false });
  });

  test("merged base but no workspace found for ancestor", async () => {
    // Stack: main <- feat-a <- feat-b <- feat-c
    // feat-b is merged, feat-a is also merged, but no workspace exists for feat-a
    const deps = makeDeps({
      readWorkspaceBase: (ws) => (ws === "ws-b" ? "feat-a" : null),
      isBranchMerged: async () => true,
      findWorkspaceForBranch: () => null, // feat-a workspace deleted
    });

    const result = await walkRetargetChain("feat-b", "ws-b", deps);
    expect(result.targetBranch).toBeNull();
    expect(result.didWalk).toBe(true);
    expect(result.walkedPath).toEqual(["feat-b"]);
  });
});
