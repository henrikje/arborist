import { describe, expect, test } from "bun:test";
import { computeFlags } from "./flags";
import { makeRepo } from "./test-helpers";
import type { RepoStatus } from "./types";
import {
  matchesAge,
  repoMatchesWhere,
  resolveAgeFilter,
  resolveWhereFilter,
  validateWhere,
  workspaceMatchesWhere,
} from "./where";

describe("validateWhere", () => {
  test("returns null for valid single term", () => {
    expect(validateWhere("dirty")).toBeNull();
  });

  test("returns null for valid comma-separated terms", () => {
    expect(validateWhere("dirty,gone,ahead-share")).toBeNull();
  });

  test("returns null for at-risk derived term", () => {
    expect(validateWhere("at-risk")).toBeNull();
  });

  test("returns null for all valid terms", () => {
    expect(
      validateWhere(
        "dirty,staged,modified,untracked,ahead-share,no-share,behind-share,behind-base,ahead-base,conflict,diverged,wrong-branch,detached,operation,gone,shallow,merged,base-merged,base-missing,timed-out,at-risk,stale,clean,pushed,safe",
      ),
    ).toBeNull();
  });

  test("returns null for stale term", () => {
    expect(validateWhere("stale")).toBeNull();
  });

  test("returns null for merged term", () => {
    expect(validateWhere("merged")).toBeNull();
  });

  test("returns null for base-merged term", () => {
    expect(validateWhere("base-merged")).toBeNull();
  });

  test("returns error for invalid term", () => {
    const err = validateWhere("invalid");
    expect(err).toContain("Unknown filter term: invalid");
    expect(err).toContain("Valid terms:");
  });

  test("returns error for multiple invalid terms", () => {
    const err = validateWhere("foo,bar");
    expect(err).toContain("Unknown filter terms: foo, bar");
  });

  test("returns error when mix of valid and invalid", () => {
    const err = validateWhere("dirty,nope");
    expect(err).toContain("Unknown filter term: nope");
  });

  test("returns null for valid AND expression", () => {
    expect(validateWhere("dirty+ahead-share")).toBeNull();
  });

  test("returns null for mixed AND/OR expression", () => {
    expect(validateWhere("dirty+ahead-share,gone")).toBeNull();
  });

  test("returns error for invalid term in AND group", () => {
    const err = validateWhere("dirty+invalid");
    expect(err).toContain("Unknown filter term: invalid");
  });

  test("returns error for invalid term in mixed AND/OR", () => {
    const err = validateWhere("dirty+ahead-share,invalid");
    expect(err).toContain("Unknown filter term: invalid");
  });
});

describe("repoMatchesWhere", () => {
  test("matches dirty repo", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "dirty")).toBe(true);
  });

  test("does not match clean repo for dirty", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "dirty")).toBe(false);
  });

  test("matches with comma OR — first term matches", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "dirty,gone")).toBe(true);
  });

  test("matches with comma OR — second term matches", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "dirty,gone")).toBe(true);
  });

  test("does not match when no terms match", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "dirty,gone")).toBe(false);
  });

  test("matches at-risk derived term", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "at-risk")).toBe(true);
  });

  test("at-risk does not match clean repo", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "at-risk")).toBe(false);
  });

  test("AND matches when both terms true", () => {
    const flags = computeFlags(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "dirty+ahead-share")).toBe(true);
  });

  test("AND fails when only one term true", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "dirty+ahead-share")).toBe(false);
  });

  test("mixed AND/OR — first AND group matches", () => {
    const flags = computeFlags(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "dirty+ahead-share,gone")).toBe(true);
  });

  test("mixed AND/OR — second OR term matches", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "dirty+ahead-share,gone")).toBe(true);
  });

  test("mixed AND/OR — neither group matches", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "dirty+ahead-share,gone")).toBe(false);
  });

  test("AND with aggregate term", () => {
    const flags = computeFlags(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "at-risk+ahead-share")).toBe(true);
  });

  test("matches each raw flag term", () => {
    const cases: [string, Partial<RepoStatus>][] = [
      [
        "ahead-share",
        {
          share: {
            remote: "origin",
            ref: "origin/feature",
            refMode: "configured",
            toPush: 2,
            toPull: 0,
          },
        },
      ],
      [
        "no-share",
        {
          share: {
            remote: "origin",
            ref: null,
            refMode: "noRef" as const,
            toPush: null,
            toPull: null,
          },
        },
      ],
      [
        "behind-share",
        {
          share: {
            remote: "origin",
            ref: "origin/feature",
            refMode: "configured",
            toPush: 0,
            toPull: 3,
          },
        },
      ],
      [
        "ahead-base",
        {
          base: {
            remote: "origin",
            ref: "main",
            configuredRef: null,
            resolvedVia: "remote",
            ahead: 3,
            behind: 0,
            baseMergedIntoDefault: null,
          },
        },
      ],
      ["staged", { local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }],
      ["modified", { local: { staged: 0, modified: 1, untracked: 0, conflicts: 0 } }],
      ["untracked", { local: { staged: 0, modified: 0, untracked: 1, conflicts: 0 } }],
      ["conflict", { local: { staged: 0, modified: 0, untracked: 0, conflicts: 2 } }],
      [
        "behind-base",
        {
          base: {
            remote: "origin",
            ref: "main",
            configuredRef: null,
            resolvedVia: "remote",
            ahead: 0,
            behind: 2,
            baseMergedIntoDefault: null,
          },
        },
      ],
      [
        "diverged",
        {
          base: {
            remote: "origin",
            ref: "main",
            configuredRef: null,
            resolvedVia: "remote",
            ahead: 2,
            behind: 3,
            baseMergedIntoDefault: null,
          },
        },
      ],
      [
        "wrong-branch",
        { identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false } },
      ],
      ["detached", { identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false } }],
      ["operation", { operation: "rebase" }],

      [
        "gone",
        {
          share: {
            remote: "origin",
            ref: null,
            refMode: "gone",
            toPush: null,
            toPull: null,
          },
        },
      ],
      [
        "shallow",
        { identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true } },
      ],
      [
        "merged",
        {
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
        },
      ],
      [
        "base-merged",
        {
          base: {
            remote: "origin",
            ref: "feat/auth",
            configuredRef: null,
            resolvedVia: "remote",
            ahead: 0,
            behind: 3,
            baseMergedIntoDefault: "merge",
          },
        },
      ],
      [
        "base-missing",
        {
          base: {
            remote: "origin",
            ref: "main",
            configuredRef: "feat/auth",
            resolvedVia: "remote",
            ahead: 1,
            behind: 0,
            baseMergedIntoDefault: null,
          },
        },
      ],
    ];
    for (const [term, overrides] of cases) {
      const flags = computeFlags(makeRepo(overrides), "feature");
      expect(repoMatchesWhere(flags, term)).toBe(true);
    }
  });
});

describe("local sub-filters", () => {
  test("staged does not match repo with only modified files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 1, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "staged")).toBe(false);
  });

  test("staged does not match repo with only untracked files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 0, untracked: 1, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "staged")).toBe(false);
  });

  test("modified does not match repo with only staged files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "modified")).toBe(false);
  });

  test("untracked does not match repo with only modified files", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 0, modified: 1, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "untracked")).toBe(false);
  });

  test("staged+^modified matches repo with clean staging area", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "staged+^modified")).toBe(true);
  });

  test("staged+^modified does not match repo with both staged and modified", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 1, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "staged+^modified")).toBe(false);
  });

  test("none of staged, modified, untracked match clean repo", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "staged")).toBe(false);
    expect(repoMatchesWhere(flags, "modified")).toBe(false);
    expect(repoMatchesWhere(flags, "untracked")).toBe(false);
  });
});

describe("workspaceMatchesWhere", () => {
  test("matches when any repo matches (ANY-repo semantics)", () => {
    const repos = [
      makeRepo({ name: "clean-repo" }),
      makeRepo({ name: "dirty-repo", local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
    ];
    expect(workspaceMatchesWhere(repos, "feature", "dirty")).toBe(true);
  });

  test("does not match when no repos match", () => {
    const repos = [makeRepo({ name: "clean-a" }), makeRepo({ name: "clean-b" })];
    expect(workspaceMatchesWhere(repos, "feature", "dirty")).toBe(false);
  });

  test("at-risk does not match workspace with only gone repos", () => {
    const repos = [
      makeRepo({ name: "clean-repo" }),
      makeRepo({
        name: "gone-repo",
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
    ];
    expect(workspaceMatchesWhere(repos, "feature", "at-risk")).toBe(false);
  });

  test("AND is per-repo — workspace with dirty repo-a and ahead-share repo-b does NOT match dirty+ahead-share", () => {
    const repos = [
      makeRepo({ name: "repo-a", local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
      makeRepo({
        name: "repo-b",
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
    ];
    expect(workspaceMatchesWhere(repos, "feature", "dirty+ahead-share")).toBe(false);
  });

  test("AND matches workspace when single repo satisfies all terms", () => {
    const repos = [
      makeRepo({ name: "clean-repo" }),
      makeRepo({
        name: "dirty-ahead-share-repo",
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
    ];
    expect(workspaceMatchesWhere(repos, "feature", "dirty+ahead-share")).toBe(true);
  });

  test("matches at-risk across repos when dirty", () => {
    const repos = [
      makeRepo({ name: "clean-repo" }),
      makeRepo({
        name: "dirty-repo",
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
      }),
    ];
    expect(workspaceMatchesWhere(repos, "feature", "at-risk")).toBe(true);
  });
});

describe("stale filter", () => {
  test("matches isBehindShare", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 0,
          toPull: 3,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "stale")).toBe(true);
  });

  test("matches isBehindBase", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 2,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "stale")).toBe(true);
  });

  test("matches isDiverged", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 2,
          behind: 3,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "stale")).toBe(true);
  });

  test("does not match clean repo", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "stale")).toBe(false);
  });

  test("does not match dirty repo", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "stale")).toBe(false);
  });
});

describe("positive filter terms", () => {
  test("clean matches repo with no local changes", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "clean")).toBe(true);
  });

  test("clean does not match dirty repo", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "clean")).toBe(false);
  });

  test("pushed matches repo with no ahead-share commits", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "pushed")).toBe(true);
  });

  test("pushed does not match ahead-share repo", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "pushed")).toBe(false);
  });

  test("pushed does not match never-pushed repo with no work", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "noRef" as const,
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "pushed")).toBe(false);
  });

  test("pushed does not match never-pushed repo with work", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "noRef" as const,
          toPush: null,
          toPull: null,
        },
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
      "feature",
    );
    expect(repoMatchesWhere(flags, "pushed")).toBe(false);
  });

  test("no-share matches never-pushed repo", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: null,
          refMode: "noRef" as const,
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "no-share")).toBe(true);
  });

  test("no-share does not match pushed repo", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "no-share")).toBe(false);
  });

  test("safe matches repo with no at-risk flags", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "safe")).toBe(true);
  });

  test("safe does not match dirty repo", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "safe")).toBe(false);
  });

  test("safe does not match ahead-share repo", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "safe")).toBe(false);
  });

  test("positive terms composable with AND", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "clean+pushed")).toBe(true);
  });

  test("positive AND fails when one condition unmet", () => {
    const flags = computeFlags(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "clean+pushed")).toBe(false);
  });
});

describe("^ negation prefix", () => {
  test("^dirty matches clean repo", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "^dirty")).toBe(true);
  });

  test("^dirty does not match dirty repo", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "^dirty")).toBe(false);
  });

  test("^at-risk matches safe repo", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "^at-risk")).toBe(true);
  });

  test("^at-risk does not match at-risk repo", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "^at-risk")).toBe(false);
  });

  test("^stale matches synced repo", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "^stale")).toBe(true);
  });

  test("^stale does not match repo behind base", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          resolvedVia: "remote",
          ahead: 0,
          behind: 2,
          baseMergedIntoDefault: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "^stale")).toBe(false);
  });

  test("^ composable with AND: ^dirty+^ahead-share", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "^dirty+^ahead-share")).toBe(true);
  });

  test("^ AND fails when one condition unmet", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "^dirty+^ahead-share")).toBe(false);
  });

  test("^ composable with OR: ^dirty,gone", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "^dirty,gone")).toBe(true);
  });

  test("^ with OR — second term matches", () => {
    const flags = computeFlags(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        share: {
          remote: "origin",
          ref: null,
          refMode: "gone",
          toPush: null,
          toPull: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "^dirty,gone")).toBe(true);
  });

  test("validateWhere accepts ^dirty", () => {
    expect(validateWhere("^dirty")).toBeNull();
  });

  test("validateWhere accepts ^at-risk", () => {
    expect(validateWhere("^at-risk")).toBeNull();
  });

  test("validateWhere accepts ^dirty+^ahead-share", () => {
    expect(validateWhere("^dirty+^ahead-share")).toBeNull();
  });

  test("validateWhere rejects ^invalid", () => {
    const err = validateWhere("^invalid");
    expect(err).toContain("Unknown filter term: ^invalid");
    expect(err).toContain("prefix with ^ to negate");
  });

  test("validateWhere rejects mixed valid and ^invalid", () => {
    const err = validateWhere("dirty,^nope");
    expect(err).toContain("Unknown filter term: ^nope");
  });
});

describe("positive / negation equivalence", () => {
  test("^dirty behaves same as clean", () => {
    const cleanFlags = computeFlags(makeRepo(), "feature");
    const dirtyFlags = computeFlags(
      makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
      "feature",
    );
    expect(repoMatchesWhere(cleanFlags, "^dirty")).toBe(repoMatchesWhere(cleanFlags, "clean"));
    expect(repoMatchesWhere(dirtyFlags, "^dirty")).toBe(repoMatchesWhere(dirtyFlags, "clean"));
  });

  test("^at-risk behaves same as safe", () => {
    const safeFlags = computeFlags(makeRepo(), "feature");
    const riskyFlags = computeFlags(
      makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }),
      "feature",
    );
    expect(repoMatchesWhere(safeFlags, "^at-risk")).toBe(repoMatchesWhere(safeFlags, "safe"));
    expect(repoMatchesWhere(riskyFlags, "^at-risk")).toBe(repoMatchesWhere(riskyFlags, "safe"));
  });
});

describe("resolveWhereFilter", () => {
  test('dirty: true alone returns "dirty"', () => {
    expect(resolveWhereFilter({ dirty: true })).toBe("dirty");
  });

  test("dirty: true + where throws error (conflict)", () => {
    expect(() => resolveWhereFilter({ dirty: true, where: "ahead" })).toThrow("Cannot combine --dirty with --where");
  });

  test("neither dirty nor where returns undefined", () => {
    expect(resolveWhereFilter({})).toBeUndefined();
  });

  test("where only returns the where string", () => {
    expect(resolveWhereFilter({ where: "dirty" })).toBe("dirty");
  });

  test("invalid where throws error", () => {
    expect(() => resolveWhereFilter({ where: "invalid-term" })).toThrow("Unknown filter term");
  });
});

describe("resolveAgeFilter", () => {
  test("no options returns undefined", () => {
    expect(resolveAgeFilter({})).toBeUndefined();
  });

  test("valid olderThan returns filter with olderThan ms", () => {
    const filter = resolveAgeFilter({ olderThan: "30d" });
    expect(filter).toBeDefined();
    expect(filter?.olderThan).toBeGreaterThan(0);
  });

  test("valid newerThan returns filter with newerThan ms", () => {
    const filter = resolveAgeFilter({ newerThan: "2w" });
    expect(filter).toBeDefined();
    expect(filter?.newerThan).toBeGreaterThan(0);
  });

  test("invalid olderThan throws error", () => {
    expect(() => resolveAgeFilter({ olderThan: "invalid" })).toThrow("Invalid duration");
  });

  test("invalid newerThan throws error", () => {
    expect(() => resolveAgeFilter({ newerThan: "xyz" })).toThrow("Invalid duration");
  });

  test("both olderThan and newerThan returns filter with both", () => {
    const filter = resolveAgeFilter({ olderThan: "30d", newerThan: "7d" });
    expect(filter?.olderThan).toBeGreaterThan(0);
    expect(filter?.newerThan).toBeGreaterThan(0);
  });
});

describe("matchesAge", () => {
  test("null date with olderThan filter returns true", () => {
    expect(matchesAge(null, { olderThan: 1000 })).toBe(true);
  });

  test("null date with newerThan filter returns false", () => {
    expect(matchesAge(null, { newerThan: 1000 })).toBe(false);
  });

  test("null date with both filters returns true (olderThan takes priority for null)", () => {
    expect(matchesAge(null, { olderThan: 1000, newerThan: 500 })).toBe(true);
  });

  test("recent date does not match olderThan", () => {
    const recent = new Date().toISOString();
    expect(matchesAge(recent, { olderThan: 86400000 })).toBe(false);
  });

  test("old date matches olderThan", () => {
    const old = new Date(Date.now() - 86400000 * 60).toISOString();
    expect(matchesAge(old, { olderThan: 86400000 })).toBe(true);
  });

  test("recent date matches newerThan", () => {
    const recent = new Date().toISOString();
    expect(matchesAge(recent, { newerThan: 86400000 })).toBe(true);
  });

  test("old date does not match newerThan", () => {
    const old = new Date(Date.now() - 86400000 * 60).toISOString();
    expect(matchesAge(old, { newerThan: 86400000 })).toBe(false);
  });
});
