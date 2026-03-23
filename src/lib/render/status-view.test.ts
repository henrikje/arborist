import { describe, expect, test } from "bun:test";
import { makeRepo } from "../status/test-helpers";
import type { WorkspaceSummary } from "../status/types";
import type { TableNode } from "./model";
import { type StatusViewContext, buildRefParenthetical, buildStatusView } from "./status-view";

function makeSummary(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    workspace: "test-ws",
    branch: "feature",
    base: null,
    repos: [makeRepo()],
    total: 1,
    atRiskCount: 0,
    outdatedOnlyCount: 0,
    statusCounts: [],
    lastCommit: null,
    lastActivity: null,
    lastActivityFile: null,
    ...overrides,
  };
}

function defaultCtx(overrides: Partial<StatusViewContext> = {}): StatusViewContext {
  return {
    expectedBranch: "feature",
    baseConflictRepos: new Set(),
    pullConflictRepos: new Set(),
    currentRepo: null,
    ...overrides,
  };
}

describe("buildStatusView", () => {
  test("returns message node when no repos", () => {
    const { nodes } = buildStatusView(makeSummary({ repos: [], total: 0 }), defaultCtx());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind).toBe("message");
  });

  test("returns table node for repos", () => {
    const { nodes } = buildStatusView(makeSummary(), defaultCtx());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind).toBe("table");
  });

  test("table has correct column keys", () => {
    const { nodes } = buildStatusView(makeSummary(), defaultCtx());
    const table = nodes[0] as TableNode;
    const keys = table.columns.map((c) => c.key);
    expect(keys).toContain("repo");
    expect(keys).toContain("branch");
    expect(keys).toContain("baseName");
    expect(keys).toContain("baseDiff");
    expect(keys).toContain("remoteName");
    expect(keys).toContain("remoteDiff");
    expect(keys).toContain("local");
    expect(keys).toContain("lastCommitNum");
    expect(keys).toContain("lastCommitUnit");
  });

  test("BRANCH column is hidden when no wrong branch", () => {
    const { nodes } = buildStatusView(makeSummary(), defaultCtx());
    const table = nodes[0] as TableNode;
    const branchCol = table.columns.find((c) => c.key === "branch");
    expect(branchCol?.show).toBe(false);
  });

  test("BRANCH column shown when wrong branch", () => {
    const wrongBranchRepo = makeRepo({
      identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
    });
    const { nodes } = buildStatusView(makeSummary({ repos: [wrongBranchRepo] }), defaultCtx());
    const table = nodes[0] as TableNode;
    const branchCol = table.columns.find((c) => c.key === "branch");
    expect(branchCol?.show).toBe(true);
  });

  test("BRANCH column shown when detached", () => {
    const detachedRepo = makeRepo({
      identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
    });
    const { nodes } = buildStatusView(makeSummary({ repos: [detachedRepo] }), defaultCtx());
    const table = nodes[0] as TableNode;
    const branchCol = table.columns.find((c) => c.key === "branch");
    expect(branchCol?.show).toBe(true);
  });

  test("marks current repo", () => {
    const repos = [makeRepo({ name: "frontend" }), makeRepo({ name: "backend" })];
    const { nodes } = buildStatusView(makeSummary({ repos, total: 2 }), defaultCtx({ currentRepo: "backend" }));
    const table = nodes[0] as TableNode;
    expect(table.rows[0]?.marked).toBeFalsy();
    expect(table.rows[1]?.marked).toBe(true);
  });

  test("grouped columns: BASE has two sub-columns", () => {
    const { nodes } = buildStatusView(makeSummary(), defaultCtx());
    const table = nodes[0] as TableNode;
    const baseCols = table.columns.filter((c) => c.group === "BASE");
    expect(baseCols).toHaveLength(2);
    expect(baseCols.map((c) => c.key)).toEqual(["baseName", "baseDiff"]);
  });

  test("grouped columns: SHARE has two sub-columns", () => {
    const { nodes } = buildStatusView(makeSummary(), defaultCtx());
    const table = nodes[0] as TableNode;
    const shareCols = table.columns.filter((c) => c.group === "SHARE");
    expect(shareCols).toHaveLength(2);
    expect(shareCols.map((c) => c.key)).toEqual(["remoteName", "remoteDiff"]);
  });

  test("grouped columns: LAST COMMIT has two sub-columns", () => {
    const { nodes } = buildStatusView(makeSummary(), defaultCtx());
    const table = nodes[0] as TableNode;
    const lcCols = table.columns.filter((c) => c.group === "LAST COMMIT");
    expect(lcCols).toHaveLength(2);
    expect(lcCols[0]?.align).toBe("right");
  });

  test("remoteName column has truncate", () => {
    const { nodes } = buildStatusView(makeSummary(), defaultCtx());
    const table = nodes[0] as TableNode;
    const remoteNameCol = table.columns.find((c) => c.key === "remoteName");
    expect(remoteNameCol?.truncate).toEqual({ min: 13 });
  });

  test("baseName column has truncate", () => {
    const { nodes } = buildStatusView(makeSummary(), defaultCtx());
    const table = nodes[0] as TableNode;
    const baseNameCol = table.columns.find((c) => c.key === "baseName");
    expect(baseNameCol?.truncate).toEqual({ min: 13 });
  });

  test("row cells contain correct plain text", () => {
    const { nodes } = buildStatusView(makeSummary(), defaultCtx());
    const table = nodes[0] as TableNode;
    const row = table.rows[0] as (typeof table.rows)[number];
    expect(row.cells.repo?.plain).toBe("test-repo");
    expect(row.cells.branch?.plain).toBe("feature");
    expect(row.cells.baseName?.plain).toBe("origin/main");
    expect(row.cells.baseDiff?.plain).toBe("equal");
    expect(row.cells.remoteName?.plain).toBe("origin/feature");
    expect(row.cells.remoteDiff?.plain).toBe("up to date");
    expect(row.cells.local?.plain).toBe("clean");
  });

  test("base conflict repos get attention on baseDiff", () => {
    const repo = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        ahead: 2,
        behind: 3,
        baseMergedIntoDefault: null,
      },
    });
    const { nodes } = buildStatusView(
      makeSummary({ repos: [repo] }),
      defaultCtx({ baseConflictRepos: new Set(["test-repo"]) }),
    );
    const table = nodes[0] as TableNode;
    const baseDiff = table.rows[0]?.cells.baseDiff;
    expect(baseDiff?.spans[0]?.attention).toBe("attention");
  });

  test("pull conflict repos get attention on pull-side new segment", () => {
    const repo = makeRepo({
      base: null,
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 5,
        toPull: 3,
        outdated: { total: 0, rebased: 0, replaced: 0, squashed: 0 },
      },
    });
    const { nodes } = buildStatusView(
      makeSummary({ repos: [repo] }),
      defaultCtx({ pullConflictRepos: new Set(["test-repo"]) }),
    );
    const table = nodes[0] as TableNode;
    const remoteDiff = table.rows[0]?.cells.remoteDiff;
    const pullSpan = remoteDiff?.spans.find((s) => s.text === "3 new");
    expect(remoteDiff?.plain).toBe("5 to push → 3 new");
    expect(pullSpan?.attention).toBe("attention");
  });

  test("multiple repos produce correct number of rows", () => {
    const repos = [makeRepo({ name: "a" }), makeRepo({ name: "b" }), makeRepo({ name: "c" })];
    const { nodes } = buildStatusView(makeSummary({ repos, total: 3 }), defaultCtx());
    const table = nodes[0] as TableNode;
    expect(table.rows).toHaveLength(3);
  });

  test("verbose data attaches afterRow to rows", () => {
    const repos = [makeRepo({ name: "frontend" }), makeRepo({ name: "backend" })];
    const verboseData = new Map([
      [
        "frontend",
        {
          unpushed: [{ hash: "aaa", shortHash: "aaa1234", subject: "commit 1", rebased: false }],
        },
      ],
      ["backend", undefined],
    ]);
    const { nodes } = buildStatusView(makeSummary({ repos, total: 2 }), defaultCtx({ verboseData }));
    const table = nodes[0] as TableNode;
    // frontend has verbose → afterRow with section nodes
    expect(table.rows[0]?.afterRow).toBeDefined();
    expect(table.rows[0]?.afterRow?.some((n) => n.kind === "section")).toBe(true);
    // backend has no verbose but is not last → afterRow with gap separator
    expect(table.rows[1]?.afterRow).toBeUndefined();
  });

  test("verbose data adds gap separator for non-last rows without verbose", () => {
    const repos = [makeRepo({ name: "a" }), makeRepo({ name: "b" }), makeRepo({ name: "c" })];
    const verboseData = new Map<string, undefined>([
      ["a", undefined],
      ["b", undefined],
      ["c", undefined],
    ]);
    const { nodes } = buildStatusView(makeSummary({ repos, total: 3 }), defaultCtx({ verboseData }));
    const table = nodes[0] as TableNode;
    // First two rows get gap separator
    expect(table.rows[0]?.afterRow).toEqual([{ kind: "gap" }]);
    expect(table.rows[1]?.afterRow).toEqual([{ kind: "gap" }]);
    // Last row has no afterRow
    expect(table.rows[2]?.afterRow).toBeUndefined();
  });

  // ── baseName column visibility ──

  test("baseName column hidden when all repos have same base ref", () => {
    const repos = [makeRepo({ name: "a" }), makeRepo({ name: "b" })];
    const { showBaseRef } = buildStatusView(makeSummary({ repos, total: 2 }), defaultCtx());
    expect(showBaseRef).toBe(false);
  });

  test("baseName column hidden for single repo with default base", () => {
    const { showBaseRef } = buildStatusView(makeSummary(), defaultCtx());
    expect(showBaseRef).toBe(false);
  });

  test("baseName column shown when repos have different base refs", () => {
    const repos = [
      makeRepo({
        name: "a",
        base: { remote: "origin", ref: "main", configuredRef: null, ahead: 0, behind: 0, baseMergedIntoDefault: null },
      }),
      makeRepo({
        name: "b",
        base: {
          remote: "origin",
          ref: "develop",
          configuredRef: null,
          ahead: 0,
          behind: 0,
          baseMergedIntoDefault: null,
        },
      }),
    ];
    const { showBaseRef } = buildStatusView(makeSummary({ repos, total: 2 }), defaultCtx());
    expect(showBaseRef).toBe(true);
  });

  test("baseName column shown for single-repo stacked workspace", () => {
    const repo = makeRepo({
      base: {
        remote: "origin",
        ref: "feat-auth",
        configuredRef: "feat-auth",
        ahead: 0,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const { showBaseRef } = buildStatusView(makeSummary({ repos: [repo] }), defaultCtx());
    expect(showBaseRef).toBe(true);
  });

  // ── remoteName column visibility ──

  test("remoteName column hidden when all repos track expected branch", () => {
    const repos = [makeRepo({ name: "a" }), makeRepo({ name: "b" })];
    const { showShareRef } = buildStatusView(makeSummary({ repos, total: 2 }), defaultCtx());
    expect(showShareRef).toBe(false);
  });

  test("remoteName column shown when repo has wrong branch", () => {
    const repos = [
      makeRepo({ name: "a" }),
      makeRepo({
        name: "b",
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
      }),
    ];
    const { showShareRef } = buildStatusView(makeSummary({ repos, total: 2 }), defaultCtx());
    expect(showShareRef).toBe(true);
  });

  test("remoteName column shown when repo has configured share ref mismatch", () => {
    const repo = makeRepo({
      share: { remote: "origin", ref: "origin/other-branch", refMode: "configured", toPush: 0, toPull: 0 },
    });
    const { showShareRef } = buildStatusView(makeSummary({ repos: [repo] }), defaultCtx());
    expect(showShareRef).toBe(true);
  });

  test("remoteName column shown when repo is detached", () => {
    const repo = makeRepo({
      identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
    });
    const { showShareRef } = buildStatusView(makeSummary({ repos: [repo] }), defaultCtx());
    expect(showShareRef).toBe(true);
  });

  test("remoteName column hidden when configured ref matches expected", () => {
    const repo = makeRepo({
      share: { remote: "origin", ref: "origin/feature", refMode: "configured", toPush: 0, toPull: 0 },
    });
    const { showShareRef } = buildStatusView(makeSummary({ repos: [repo] }), defaultCtx());
    expect(showShareRef).toBe(false);
  });
});

describe("buildRefParenthetical", () => {
  test("includes base and share when both columns hidden", () => {
    const summary = makeSummary({ workspace: "feature" });
    const result = buildRefParenthetical(summary, false, false);
    expect(result).toBe("base origin/main, share origin/feature");
  });

  test("includes branch when it differs from workspace name", () => {
    const summary = makeSummary({ workspace: "my-ws", branch: "custom-branch" });
    const result = buildRefParenthetical(summary, false, false);
    expect(result).toBe("branch custom-branch, base origin/main, share origin/custom-branch");
  });

  test("omits branch when it matches workspace name", () => {
    const summary = makeSummary({ workspace: "feature", branch: "feature" });
    const result = buildRefParenthetical(summary, false, false);
    expect(result).toBe("base origin/main, share origin/feature");
  });

  test("returns null when both columns shown and branch matches workspace", () => {
    const summary = makeSummary({ workspace: "feature" });
    const result = buildRefParenthetical(summary, true, true);
    expect(result).toBeNull();
  });

  test("includes only base when share column is shown", () => {
    const summary = makeSummary({ workspace: "feature" });
    const result = buildRefParenthetical(summary, false, true);
    expect(result).toBe("base origin/main");
  });

  test("includes only share when base column is shown", () => {
    const summary = makeSummary({ workspace: "feature" });
    const result = buildRefParenthetical(summary, true, false);
    expect(result).toBe("share origin/feature");
  });

  test("shows configured base ref for stacked workspaces", () => {
    const repo = makeRepo({
      base: {
        remote: "origin",
        ref: "feat-auth",
        configuredRef: "feat-auth",
        ahead: 0,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const summary = makeSummary({ workspace: "feature", repos: [repo] });
    const result = buildRefParenthetical(summary, false, false);
    expect(result).toBe("base origin/feat-auth, share origin/feature");
  });

  test("omits base when no repos have base", () => {
    const repo = makeRepo({ base: null });
    const summary = makeSummary({ workspace: "feature", repos: [repo] });
    const result = buildRefParenthetical(summary, false, false);
    expect(result).toBe("share origin/feature");
  });
});
