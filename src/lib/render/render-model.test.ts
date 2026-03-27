import { describe, expect, test } from "bun:test";
import { computeFlags } from "../status/flags";
import { makeRepo } from "../status/test-helpers";
import {
  analyzeBaseDiff,
  analyzeBaseName,
  analyzeBranch,
  analyzeLocal,
  analyzeRemoteDiff,
  analyzeRemoteName,
  plainBaseDiff,
  plainLocal,
  plainRemoteDiff,
} from "./analysis";
import { EMPTY_CELL, cell, join, spans, suffix } from "./model";

// ── Primitive helpers ──

describe("cell()", () => {
  test("creates single-span cell with default attention", () => {
    const c = cell("hello");
    expect(c.plain).toBe("hello");
    expect(c.spans).toEqual([{ text: "hello", attention: "default" }]);
  });

  test("creates single-span cell with specified attention", () => {
    const c = cell("warning", "attention");
    expect(c.plain).toBe("warning");
    expect(c.spans).toEqual([{ text: "warning", attention: "attention" }]);
  });
});

describe("spans()", () => {
  test("creates multi-span cell", () => {
    const c = spans({ text: "abc", attention: "muted" }, { text: " def", attention: "attention" });
    expect(c.plain).toBe("abc def");
    expect(c.spans).toHaveLength(2);
  });
});

describe("join()", () => {
  test("joins cells with default separator", () => {
    const c = join([cell("a", "attention"), cell("b", "attention")]);
    expect(c.plain).toBe("a, b");
    expect(c.spans).toHaveLength(3); // a, ", ", b
    expect(c.spans[1]).toEqual({ text: ", ", attention: "default" });
  });

  test("joins cells with custom separator", () => {
    const c = join([cell("x"), cell("y")], " | ");
    expect(c.plain).toBe("x | y");
  });

  test("returns empty cell for empty array", () => {
    const c = join([]);
    expect(c.plain).toBe("");
    expect(c.spans).toEqual([{ text: "", attention: "default" }]);
  });

  test("returns the cell itself for single element", () => {
    const original = cell("solo");
    const c = join([original]);
    expect(c).toBe(original);
  });
});

describe("suffix()", () => {
  test("appends span to cell", () => {
    const base = cell("clean");
    const c = suffix(base, " (rebase)", "attention");
    expect(c.plain).toBe("clean (rebase)");
    expect(c.spans).toHaveLength(2);
    expect(c.spans[1]).toEqual({ text: " (rebase)", attention: "attention" });
  });
});

// ── analyzeBranch ──

describe("analyzeBranch", () => {
  test("returns branch name with default attention when matching expected", () => {
    const repo = makeRepo();
    const c = analyzeBranch(repo, "feature");
    expect(c.plain).toBe("feature");
    expect(c.spans[0]?.attention).toBe("default");
  });

  test("returns attention when wrong branch", () => {
    const repo = makeRepo();
    const c = analyzeBranch(repo, "main");
    expect(c.plain).toBe("feature");
    expect(c.spans[0]?.attention).toBe("attention");
  });

  test("returns attention for detached head", () => {
    const repo = makeRepo({
      identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
    });
    const c = analyzeBranch(repo, "feature");
    expect(c.plain).toBe("(detached)");
    expect(c.spans[0]?.attention).toBe("attention");
  });
});

// ── analyzeBaseName ──

describe("analyzeBaseName", () => {
  test("returns default attention for normal base", () => {
    const repo = makeRepo();
    const flags = computeFlags(repo, "feature");
    const c = analyzeBaseName(repo, flags);
    expect(c.plain).toBe("origin/main");
    expect(c.spans[0]?.attention).toBe("default");
  });

  test("returns attention when isBaseMissing", () => {
    const repo = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: "feat/old",
        resolvedVia: "remote",
        ahead: 0,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeBaseName(repo, flags);
    expect(c.plain).toBe("origin/feat/old");
    expect(c.spans[0]?.attention).toBe("attention");
  });

  test("returns attention when baseMergedIntoDefault", () => {
    const repo = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: "feat/old",
        resolvedVia: "remote",
        ahead: 0,
        behind: 0,
        baseMergedIntoDefault: "merge",
      },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeBaseName(repo, flags);
    expect(c.spans[0]?.attention).toBe("attention");
  });

  test("returns empty cell when no base", () => {
    const repo = makeRepo({ base: null });
    const flags = computeFlags(repo, "feature");
    const c = analyzeBaseName(repo, flags);
    expect(c).toBe(EMPTY_CELL);
  });
});

// ── analyzeBaseDiff ──

describe("analyzeBaseDiff", () => {
  test("returns default attention for equal", () => {
    const repo = makeRepo();
    const flags = computeFlags(repo, "feature");
    const c = analyzeBaseDiff(repo, flags, false);
    expect(c.plain).toBe("equal");
    expect(c.spans[0]?.attention).toBe("default");
  });

  test("returns attention when conflict predicted", () => {
    const repo = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 2,
        behind: 3,
        baseMergedIntoDefault: null,
      },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeBaseDiff(repo, flags, true);
    expect(c.spans[0]?.attention).toBe("attention");
  });

  test("returns attention when baseMergedIntoDefault", () => {
    const repo = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: "feat/old",
        resolvedVia: "remote",
        ahead: 0,
        behind: 0,
        baseMergedIntoDefault: "merge",
      },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeBaseDiff(repo, flags, false);
    expect(c.plain).toBe("base merged");
    expect(c.spans[0]?.attention).toBe("attention");
  });

  test("returns empty cell when detached", () => {
    const repo = makeRepo({
      identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeBaseDiff(repo, flags, false);
    expect(c).toBe(EMPTY_CELL);
  });
});

// ── analyzeRemoteName ──

describe("analyzeRemoteName", () => {
  test("returns default attention for normal tracking", () => {
    const repo = makeRepo();
    const flags = computeFlags(repo, "feature");
    const c = analyzeRemoteName(repo, flags);
    expect(c.plain).toBe("origin/feature");
    expect(c.spans[0]?.attention).toBe("default");
  });

  test("returns attention when wrong branch", () => {
    const repo = makeRepo();
    const flags = computeFlags(repo, "main"); // wrong branch: expected main, on feature
    const c = analyzeRemoteName(repo, flags);
    expect(c.spans[0]?.attention).toBe("attention");
  });

  test("returns attention for detached", () => {
    const repo = makeRepo({
      identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeRemoteName(repo, flags);
    expect(c.plain).toBe("(detached)");
    expect(c.spans[0]?.attention).toBe("attention");
  });
});

// ── analyzeRemoteDiff ──

describe("analyzeRemoteDiff", () => {
  test("up to date — default attention", () => {
    const repo = makeRepo();
    const flags = computeFlags(repo, "feature");
    const c = analyzeRemoteDiff(repo, flags);
    expect(c.plain).toBe("up to date");
    expect(c.spans[0]?.attention).toBe("default");
  });

  test("unpushed — attention", () => {
    const repo = makeRepo({
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 3,
        toPull: 0,
      },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeRemoteDiff(repo, flags);
    expect(c.plain).toBe("3 to push");
    expect(c.spans[0]?.attention).toBe("attention");
  });

  test("rebased-only — default attention", () => {
    const repo = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 2,
        behind: 0,
        baseMergedIntoDefault: null,
      },
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 2,
        toPull: 2,
        outdated: { total: 2, rebased: 2, replaced: 0, squashed: 0 },
      },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeRemoteDiff(repo, flags);
    // pull: outdated = 2; push has no new work → default attention
    expect(c.plain).toBe("2 rebased → 2 outdated");
    expect(c.spans[0]?.attention).toBe("default");
    expect(c.spans[1]?.text).toBe(" → ");
    expect(c.spans[2]?.attention).toBe("default");
  });

  test("merged with new work — multi-span", () => {
    const repo = makeRepo({
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 1,
        toPull: 0,
      },
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 12,
        behind: 1,
        merge: { kind: "squash", newCommitsAfter: 1 },
        baseMergedIntoDefault: null,
      },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeRemoteDiff(repo, flags);
    expect(c.plain).toBe("1 to push");
    expect(c.spans.length).toBe(1);
    expect(c.spans[0]?.attention).toBe("attention");
  });

  test("no branch — default attention", () => {
    const repo = makeRepo({
      share: {
        remote: "origin",
        ref: null,
        refMode: "noRef",
        toPush: null,
        toPull: null,
      },
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 0,
        behind: 0,
        baseMergedIntoDefault: null,
      },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeRemoteDiff(repo, flags);
    expect(c.plain).toBe("no branch");
    expect(c.spans[0]?.attention).toBe("default");
  });

  test("empty for detached", () => {
    const repo = makeRepo({
      identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeRemoteDiff(repo, flags);
    expect(c).toBe(EMPTY_CELL);
  });

  test("behind share — default attention", () => {
    const repo = makeRepo({
      share: {
        remote: "origin",
        ref: "origin/feature",
        refMode: "configured",
        toPush: 0,
        toPull: 3,
      },
    });
    const flags = computeFlags(repo, "feature");
    const c = analyzeRemoteDiff(repo, flags);
    expect(c.plain).toBe("3 to pull");
    expect(c.spans[0]?.attention).toBe("default");
  });
});

// ── analyzeLocal ──

describe("analyzeLocal", () => {
  test("clean — default attention", () => {
    const repo = makeRepo();
    const c = analyzeLocal(repo);
    expect(c.plain).toBe("clean");
    expect(c.spans).toHaveLength(1);
    expect(c.spans[0]?.attention).toBe("default");
  });

  test("dirty — all parts get attention", () => {
    const repo = makeRepo({ local: { staged: 2, modified: 3, untracked: 0, conflicts: 0 } });
    const c = analyzeLocal(repo);
    expect(c.plain).toBe("2 staged, 3 modified");
    for (const s of c.spans) {
      if (s.text !== ", ") {
        expect(s.attention).toBe("attention");
      }
    }
  });

  test("clean with operation suffix — suffix gets attention", () => {
    const repo = makeRepo({ operation: "rebase" });
    const c = analyzeLocal(repo);
    expect(c.plain).toBe("clean (rebase)");
    expect(c.spans).toHaveLength(2);
    expect(c.spans[0]?.attention).toBe("default");
    expect(c.spans[1]?.attention).toBe("attention");
  });

  test("clean with shallow — suffix gets attention", () => {
    const repo = makeRepo({
      identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
    });
    const c = analyzeLocal(repo);
    expect(c.plain).toBe("clean (shallow)");
    expect(c.spans[1]?.attention).toBe("attention");
  });

  test("dirty with operation suffix", () => {
    const repo = makeRepo({
      local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
      operation: "rebase",
    });
    const c = analyzeLocal(repo);
    expect(c.plain).toBe("1 staged (rebase)");
    // "1 staged" should have attention, " (rebase)" should have attention
    expect(c.spans[0]?.attention).toBe("attention");
    expect(c.spans[c.spans.length - 1]?.attention).toBe("attention");
  });

  test("all local change types", () => {
    const repo = makeRepo({ local: { staged: 1, modified: 2, untracked: 3, conflicts: 4 } });
    const c = analyzeLocal(repo);
    expect(c.plain).toBe("4 conflicts, 1 staged, 2 modified, 3 untracked");
  });
});

// ── Plain text helpers (moved from status.ts) ──

describe("plainBaseDiff", () => {
  test("equal", () => {
    expect(
      plainBaseDiff({
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 0,
        behind: 0,
        baseMergedIntoDefault: null,
      }),
    ).toBe("equal");
  });

  test("merged", () => {
    expect(
      plainBaseDiff({
        remote: "origin",
        ref: "main",
        configuredRef: null,
        resolvedVia: "remote",
        ahead: 0,
        behind: 0,
        merge: { kind: "squash" },
        baseMergedIntoDefault: null,
      }),
    ).toBe("merged");
  });
});

describe("plainRemoteDiff", () => {
  test("up to date", () => {
    expect(plainRemoteDiff(makeRepo())).toBe("up to date");
  });

  test("gone+merged", () => {
    expect(
      plainRemoteDiff(
        makeRepo({
          share: {
            remote: "origin",
            ref: null,
            refMode: "gone",
            toPush: null,
            toPull: null,
          },
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
      ),
    ).toBe("gone");
  });
});

describe("plainLocal", () => {
  test("clean", () => {
    expect(plainLocal(makeRepo())).toBe("clean");
  });

  test("staged and modified", () => {
    expect(plainLocal(makeRepo({ local: { staged: 2, modified: 3, untracked: 0, conflicts: 0 } }))).toBe(
      "2 staged, 3 modified",
    );
  });
});
