import { describe, expect, test } from "bun:test";
import { computeFlags } from "./flags";
import { makeRepo } from "./test-helpers";
import type { RepoStatus } from "./types";
import { repoMatchesWhere, validateWhere, workspaceMatchesWhere } from "./where";

describe("validateWhere", () => {
  test("returns null for valid single term", () => {
    expect(validateWhere("dirty")).toBeNull();
  });

  test("returns null for valid comma-separated terms", () => {
    expect(validateWhere("dirty,gone,unpushed")).toBeNull();
  });

  test("returns null for at-risk derived term", () => {
    expect(validateWhere("at-risk")).toBeNull();
  });

  test("returns null for all valid terms", () => {
    expect(
      validateWhere(
        "dirty,unpushed,behind-share,behind-base,diverged,drifted,detached,operation,gone,shallow,merged,base-merged,base-missing,at-risk,stale,clean,pushed,synced-base,synced-share,synced,safe",
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
    expect(validateWhere("dirty+unpushed")).toBeNull();
  });

  test("returns null for mixed AND/OR expression", () => {
    expect(validateWhere("dirty+unpushed,gone")).toBeNull();
  });

  test("returns error for invalid term in AND group", () => {
    const err = validateWhere("dirty+invalid");
    expect(err).toContain("Unknown filter term: invalid");
  });

  test("returns error for invalid term in mixed AND/OR", () => {
    const err = validateWhere("dirty+unpushed,invalid");
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
          rebased: null,
          replaced: null,
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
          rebased: null,
          replaced: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "dirty+unpushed")).toBe(true);
  });

  test("AND fails when only one term true", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "dirty+unpushed")).toBe(false);
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
          rebased: null,
          replaced: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "dirty+unpushed,gone")).toBe(true);
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
          rebased: null,
          replaced: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "dirty+unpushed,gone")).toBe(true);
  });

  test("mixed AND/OR — neither group matches", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "dirty+unpushed,gone")).toBe(false);
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
          rebased: null,
          replaced: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "at-risk+unpushed")).toBe(true);
  });

  test("matches each raw flag term", () => {
    const cases: [string, Partial<RepoStatus>][] = [
      [
        "unpushed",
        {
          share: {
            remote: "origin",
            ref: "origin/feature",
            refMode: "configured",
            toPush: 2,
            toPull: 0,
            rebased: null,
            replaced: null,
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
            rebased: null,
            replaced: null,
          },
        },
      ],
      [
        "behind-base",
        {
          base: {
            remote: "origin",
            ref: "main",
            configuredRef: null,
            ahead: 0,
            behind: 2,
            mergedIntoBase: null,
            baseMergedIntoDefault: null,
            detectedPr: null,
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
            ahead: 2,
            behind: 3,
            mergedIntoBase: null,
            baseMergedIntoDefault: null,
            detectedPr: null,
          },
        },
      ],
      [
        "drifted",
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
            rebased: null,
            replaced: null,
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
            ahead: 0,
            behind: 0,
            mergedIntoBase: "squash",
            baseMergedIntoDefault: null,
            detectedPr: null,
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
            ahead: 0,
            behind: 3,
            mergedIntoBase: null,
            baseMergedIntoDefault: "merge",
            detectedPr: null,
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
            ahead: 1,
            behind: 0,
            mergedIntoBase: null,
            baseMergedIntoDefault: null,
            detectedPr: null,
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
          rebased: null,
          replaced: null,
        },
      }),
    ];
    expect(workspaceMatchesWhere(repos, "feature", "at-risk")).toBe(false);
  });

  test("AND is per-repo — workspace with dirty repo-a and unpushed repo-b does NOT match dirty+unpushed", () => {
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
          rebased: null,
          replaced: null,
        },
      }),
    ];
    expect(workspaceMatchesWhere(repos, "feature", "dirty+unpushed")).toBe(false);
  });

  test("AND matches workspace when single repo satisfies all terms", () => {
    const repos = [
      makeRepo({ name: "clean-repo" }),
      makeRepo({
        name: "dirty-unpushed-repo",
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
          rebased: null,
          replaced: null,
        },
      }),
    ];
    expect(workspaceMatchesWhere(repos, "feature", "dirty+unpushed")).toBe(true);
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
  test("matches needsPull", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 0,
          toPull: 3,
          rebased: null,
          replaced: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "stale")).toBe(true);
  });

  test("matches needsRebase", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          mergedIntoBase: null,
          baseMergedIntoDefault: null,
          detectedPr: null,
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
          ahead: 2,
          behind: 3,
          mergedIntoBase: null,
          baseMergedIntoDefault: null,
          detectedPr: null,
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

  test("pushed matches repo with no unpushed commits", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "pushed")).toBe(true);
  });

  test("pushed does not match unpushed repo", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
          rebased: null,
          replaced: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "pushed")).toBe(false);
  });

  test("synced-base matches repo with no rebase needed and not diverged", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "synced-base")).toBe(true);
  });

  test("synced-base does not match repo behind base", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          mergedIntoBase: null,
          baseMergedIntoDefault: null,
          detectedPr: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "synced-base")).toBe(false);
  });

  test("synced-base does not match diverged repo", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 2,
          behind: 3,
          mergedIntoBase: null,
          baseMergedIntoDefault: null,
          detectedPr: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "synced-base")).toBe(false);
  });

  test("synced-share matches repo with no pull needed", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "synced-share")).toBe(true);
  });

  test("synced-share does not match repo behind share", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 0,
          toPull: 3,
          rebased: null,
          replaced: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "synced-share")).toBe(false);
  });

  test("safe matches repo with no at-risk flags", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "safe")).toBe(true);
  });

  test("safe does not match dirty repo", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "safe")).toBe(false);
  });

  test("safe does not match unpushed repo", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 2,
          toPull: 0,
          rebased: null,
          replaced: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "safe")).toBe(false);
  });

  test("synced matches repo with no stale flags", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "synced")).toBe(true);
  });

  test("synced does not match repo behind base", () => {
    const flags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          mergedIntoBase: null,
          baseMergedIntoDefault: null,
          detectedPr: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "synced")).toBe(false);
  });

  test("synced does not match repo behind share", () => {
    const flags = computeFlags(
      makeRepo({
        share: {
          remote: "origin",
          ref: "origin/feature",
          refMode: "configured",
          toPush: 0,
          toPull: 3,
          rebased: null,
          replaced: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "synced")).toBe(false);
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
          ahead: 0,
          behind: 2,
          mergedIntoBase: null,
          baseMergedIntoDefault: null,
          detectedPr: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(flags, "^stale")).toBe(false);
  });

  test("^ composable with AND: ^dirty+^unpushed", () => {
    const flags = computeFlags(makeRepo(), "feature");
    expect(repoMatchesWhere(flags, "^dirty+^unpushed")).toBe(true);
  });

  test("^ AND fails when one condition unmet", () => {
    const flags = computeFlags(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }), "feature");
    expect(repoMatchesWhere(flags, "^dirty+^unpushed")).toBe(false);
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
          rebased: null,
          replaced: null,
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

  test("validateWhere accepts ^dirty+^unpushed", () => {
    expect(validateWhere("^dirty+^unpushed")).toBeNull();
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

  test("^stale behaves same as synced", () => {
    const syncedFlags = computeFlags(makeRepo(), "feature");
    const staleFlags = computeFlags(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 2,
          mergedIntoBase: null,
          baseMergedIntoDefault: null,
          detectedPr: null,
        },
      }),
      "feature",
    );
    expect(repoMatchesWhere(syncedFlags, "^stale")).toBe(repoMatchesWhere(syncedFlags, "synced"));
    expect(repoMatchesWhere(staleFlags, "^stale")).toBe(repoMatchesWhere(staleFlags, "synced"));
  });
});
