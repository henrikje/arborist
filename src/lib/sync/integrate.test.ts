import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatVerboseCommits } from "../render/status-verbose";
import { makeRepo } from "../status/test-helpers";
import { classifyRepo } from "./classify-integrate";
import {
  type RepoAssessment,
  describeIntegrateAction,
  formatIntegratePlan,
  maybeWriteBaseFallbackConfig,
  maybeWriteRetargetConfig,
  resolveRetargetConfigTarget,
} from "./integrate";

const DIR = "/tmp/test-repo";
const SHA = "abc1234";

function normalizeIntegrateAssessment(overrides: Record<string, unknown>): Record<string, unknown> {
  const {
    retargetFrom,
    retargetTo,
    retargetBlocked,
    retargetWarning,
    retargetReplayCount,
    retargetAlreadyOnTarget,
    retargetReason,
    commits,
    totalCommits,
    matchedCount,
    mergeBaseSha,
    outgoingCommits,
    totalOutgoingCommits,
    diffStats,
    conflictCommits,
    ...next
  } = overrides;
  const retarget = {
    from: retargetFrom as string | undefined,
    to: retargetTo as string | undefined,
    blocked: retargetBlocked as boolean | undefined,
    warning: retargetWarning as string | undefined,
    replayCount: retargetReplayCount as number | undefined,
    alreadyOnTarget: retargetAlreadyOnTarget as number | undefined,
    reason: retargetReason as RepoAssessment["retarget"] extends infer TRetarget
      ? TRetarget extends { reason?: infer TReason }
        ? TReason
        : never
      : never,
  };
  const verbose = {
    commits: commits as RepoAssessment["verbose"] extends infer TVerbose
      ? TVerbose extends { commits?: infer TCommits }
        ? TCommits
        : never
      : never,
    totalCommits: totalCommits as number | undefined,
    matchedCount: matchedCount as number | undefined,
    mergeBaseSha: mergeBaseSha as string | undefined,
    outgoingCommits: outgoingCommits as RepoAssessment["verbose"] extends infer TVerbose
      ? TVerbose extends { outgoingCommits?: infer TCommits }
        ? TCommits
        : never
      : never,
    totalOutgoingCommits: totalOutgoingCommits as number | undefined,
    diffStats: diffStats as RepoAssessment["verbose"] extends infer TVerbose
      ? TVerbose extends { diffStats?: infer TDiff }
        ? TDiff
        : never
      : never,
    conflictCommits: conflictCommits as RepoAssessment["verbose"] extends infer TVerbose
      ? TVerbose extends { conflictCommits?: infer TConflicts }
        ? TConflicts
        : never
      : never,
  };

  if (
    retarget.from ||
    retarget.to ||
    retarget.blocked ||
    retarget.warning ||
    retarget.replayCount ||
    retarget.alreadyOnTarget ||
    retarget.reason
  ) {
    next.retarget = retarget;
  }
  if (
    verbose.commits ||
    verbose.totalCommits ||
    verbose.matchedCount ||
    verbose.mergeBaseSha ||
    verbose.outgoingCommits ||
    verbose.totalOutgoingCommits ||
    verbose.diffStats ||
    verbose.conflictCommits
  ) {
    next.verbose = verbose;
  }

  return next;
}

describe("classifyRepo", () => {
  test("up-to-date when behind base is 0", () => {
    const a = classifyRepo(makeRepo(), DIR, "feature", [], false, SHA);
    expect(a.outcome).toBe("up-to-date");
    expect(a.baseBranch).toBe("main");
  });

  test("will-operate when behind base > 0", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 1,
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
    expect(a.outcome).toBe("will-operate");
    expect(a.behind).toBe(3);
    expect(a.ahead).toBe(1);
    expect(a.baseBranch).toBe("main");
  });

  test("skips when fetch failed", () => {
    const a = classifyRepo(makeRepo(), DIR, "feature", ["test-repo"], false, SHA);
    expect(a.outcome).toBe("skip");
    expect(a.skipReason).toBe("fetch failed");
    expect(a.skipFlag).toBe("fetch-failed");
  });

  test("skips when operation in progress", () => {
    const a = classifyRepo(makeRepo({ operation: "rebase" }), DIR, "feature", [], false, SHA);
    expect(a.outcome).toBe("skip");
    expect(a.skipReason).toBe("rebase in progress");
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
    expect(a.skipReason).toBe("HEAD is detached");
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
    expect(a.skipReason).toContain("on branch other, expected feature");
    expect(a.skipReason).toContain("--include-wrong-branch");
    expect(a.skipFlag).toBe("wrong-branch");
  });

  test("includes wrong branch with includeWrongBranch", () => {
    const a = classifyRepo(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
      true,
    );
    expect(a.outcome).toBe("up-to-date");
    expect(a.wrongBranch).toBe(true);
    expect(a.branch).toBe("other");
  });

  test("non-wrong-branch repo has workspace branch", () => {
    const a = classifyRepo(makeRepo(), DIR, "feature", [], false, SHA);
    expect(a.branch).toBe("feature");
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
    expect(a.skipReason).toContain("uncommitted changes");
    expect(a.skipReason).toContain("--autostash");
    expect(a.skipFlag).toBe("dirty");
  });

  test("dirty skip carries baseBranch when up to date", () => {
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
    expect(a.baseBranch).toBe("main");
    expect(a.behind).toBe(0);
  });

  test("dirty skip does not carry baseBranch when behind", () => {
    const a = classifyRepo(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
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
    expect(a.baseBranch).toBeUndefined();
  });

  test("sets needsStash when dirty with autostash and staged files", () => {
    const a = classifyRepo(
      makeRepo({
        local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
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

  test("sets needsStash when dirty with autostash and modified files", () => {
    const a = classifyRepo(
      makeRepo({
        local: { staged: 0, modified: 3, untracked: 0, conflicts: 0 },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
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

  test("does not set needsStash when only untracked files with autostash", () => {
    const a = classifyRepo(
      makeRepo({
        local: { staged: 0, modified: 0, untracked: 5, conflicts: 0 },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
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
    expect(a.needsStash).toBeUndefined();
  });

  test("skips when no base branch", () => {
    const a = classifyRepo(makeRepo({ base: null }), DIR, "feature", [], false, SHA);
    expect(a.outcome).toBe("skip");
    expect(a.skipReason).toBe("no base branch");
    expect(a.skipFlag).toBe("no-base-branch");
  });

  test("skips when no base remote", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: null,
          ref: "main",
          configuredRef: null,
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
    expect(a.skipReason).toBe("no base remote");
    expect(a.skipFlag).toBe("no-base-remote");
  });

  test("skips when branch is squash-merged into base", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 11,
          behind: 1,
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
    expect(a.skipReason).toBe("already squash-merged into main");
    expect(a.skipFlag).toBe("already-merged");
  });

  test("skips when branch is merged into base", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 0,
          behind: 3,
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
    expect(a.skipReason).toBe("already merged into main");
    expect(a.skipFlag).toBe("already-merged");
  });

  test("merge takes priority over baseMergedIntoDefault", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: "feat/auth",
          ahead: 5,
          behind: 2,
          merge: { kind: "squash" },
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
    expect(a.skipFlag).toBe("already-merged");
  });

  test("skips when base branch merged into default", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "feat/auth",
          configuredRef: "feat/auth",
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
    expect(a.skipReason).toContain("base branch feat/auth was merged into default");
    expect(a.skipReason).toContain("--retarget");
    expect(a.skipFlag).toBe("base-merged-into-default");
  });

  test("baseMergedIntoDefault falls back to ref when configuredRef is null", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "develop",
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
    expect(a.skipReason).toContain("base branch develop was merged into default");
    expect(a.skipFlag).toBe("base-merged-into-default");
  });

  test("shallow passes through", () => {
    const a = classifyRepo(
      makeRepo({
        identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "feature" }, shallow: true },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    expect(a.shallow).toBe(true);
  });

  test("headSha passes through", () => {
    const a = classifyRepo(makeRepo(), DIR, "feature", [], false, "deadbeef");
    expect(a.headSha).toBe("deadbeef");
  });

  test("baseRemote is set from base.remote", () => {
    const a = classifyRepo(makeRepo(), DIR, "feature", [], false, SHA);
    expect(a.baseRemote).toBe("origin");
  });

  test("ahead passes through for up-to-date", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 5,
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
    expect(a.ahead).toBe(5);
  });

  test("classifies merged-with-new-work as skip with already-merged (classifyRepo only)", () => {
    const a = classifyRepo(
      makeRepo({
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
          ahead: 3,
          behind: 0,
          merge: { kind: "squash", newCommitsAfter: 1 },
          baseMergedIntoDefault: null,
        },
      }),
      DIR,
      "feature",
      [],
      false,
      SHA,
    );
    // classifyRepo itself returns already-merged skip — assessRepo overrides to will-operate
    expect(a.outcome).toBe("skip");
    expect(a.skipFlag).toBe("already-merged");
  });

  test("does not set needsStash when only conflicts with autostash", () => {
    const a = classifyRepo(
      makeRepo({
        local: { staged: 0, modified: 0, untracked: 0, conflicts: 2 },
        base: {
          remote: "origin",
          ref: "main",
          configuredRef: null,
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
    expect(a.needsStash).toBeUndefined();
  });
});

describe("formatIntegratePlan", () => {
  function makeAssessment(overrides: Record<string, unknown> = {}): RepoAssessment {
    return {
      repo: "repo-a",
      repoDir: "/tmp/repo-a",
      outcome: "will-operate",
      branch: "feature",
      behind: 3,
      ahead: 1,
      baseRemote: "origin",
      baseBranch: "main",
      headSha: "abc1234",
      shallow: false,
      ...normalizeIntegrateAssessment(overrides),
    } as RepoAssessment;
  }

  test("shows rebase action", () => {
    const plan = formatIntegratePlan([makeAssessment()], "rebase");
    expect(plan).toContain("rebase feature onto origin/main");
  });

  test("shows merge action", () => {
    const plan = formatIntegratePlan([makeAssessment()], "merge");
    expect(plan).toContain("merge origin/main into feature");
  });

  test("shows behind/ahead counts", () => {
    const plan = formatIntegratePlan([makeAssessment({ behind: 5, ahead: 2 })], "rebase");
    expect(plan).toContain("5 behind");
    expect(plan).toContain("2 ahead");
  });

  test("shows fast-forward for merge with ahead=0", () => {
    const plan = formatIntegratePlan([makeAssessment({ ahead: 0 })], "merge");
    expect(plan).toContain("(fast-forward)");
  });

  test("shows three-way for merge with ahead>0", () => {
    const plan = formatIntegratePlan([makeAssessment({ ahead: 2 })], "merge");
    expect(plan).toContain("(three-way)");
  });

  test("shows conflict likely for rebase", () => {
    const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "conflict" })], "rebase");
    expect(plan).toContain("conflict likely");
  });

  test("shows will conflict for merge", () => {
    const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "conflict" })], "merge");
    expect(plan).toContain("will conflict");
  });

  test("shows no conflict for rebase with no-conflict prediction", () => {
    const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "no-conflict" })], "rebase");
    expect(plan).toContain("no conflict");
  });

  test("shows no conflict for merge with no-conflict prediction", () => {
    const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "no-conflict" })], "merge");
    expect(plan).toContain("no conflict");
  });

  test("shows conflict unlikely for rebase", () => {
    const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "clean" })], "rebase");
    expect(plan).toContain("conflict unlikely");
  });

  test("shows no conflict for merge", () => {
    const plan = formatIntegratePlan([makeAssessment({ conflictPrediction: "clean" })], "merge");
    expect(plan).toContain("no conflict");
  });

  test("shows retarget display", () => {
    const plan = formatIntegratePlan(
      [makeAssessment({ retargetFrom: "feat/old", retargetTo: "main", baseBranch: "main" })],
      "rebase",
    );
    expect(plan).toContain("rebase onto origin/main from feat/old (retarget)");
  });

  test("shows branch-merged replay display with already-merged count", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          retargetFrom: "abc1234567890",
          retargetTo: "main",
          baseBranch: "main",
          retargetReason: "branch-merged",
          retargetReplayCount: 1,
          retargetAlreadyOnTarget: 11,
          ahead: 1,
        }),
      ],
      "rebase",
    );
    expect(plan).toContain("rebase onto origin/main (merged) — rebase 1 new commit, skip 11 already merged");
    expect(plan).not.toContain("retarget");
  });

  test("shows branch-merged replay display with multiple new commits", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          retargetFrom: "abc1234567890",
          retargetTo: "main",
          baseBranch: "main",
          retargetReason: "branch-merged",
          retargetReplayCount: 3,
          retargetAlreadyOnTarget: 8,
          ahead: 3,
        }),
      ],
      "rebase",
    );
    expect(plan).toContain("rebase onto origin/main (merged) — rebase 3 new commits, skip 8 already merged");
  });

  test("shows retarget warning", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          retargetFrom: "feat/old",
          retargetTo: "main",
          baseBranch: "main",
          retargetWarning: "base branch feat/old may not be merged",
        }),
      ],
      "rebase",
    );
    expect(plan).toContain("base branch feat/old may not be merged");
  });

  test("shows retarget with autostash hint", () => {
    const plan = formatIntegratePlan(
      [makeAssessment({ retargetFrom: "feat/old", retargetTo: "main", baseBranch: "main", needsStash: true })],
      "rebase",
    );
    expect(plan).toContain("(retarget)");
    expect(plan).toContain("(autostash)");
  });

  test("shows retarget with stash pop conflict likely", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          retargetFrom: "feat/old",
          retargetTo: "main",
          baseBranch: "main",
          needsStash: true,
          stashPopConflictFiles: ["file.ts"],
        }),
      ],
      "rebase",
    );
    expect(plan).toContain("(retarget)");
    expect(plan).toContain("stash pop conflict likely");
  });

  test("shows retarget with stash pop conflict unlikely", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          retargetFrom: "feat/old",
          retargetTo: "main",
          baseBranch: "main",
          needsStash: true,
          stashPopConflictFiles: [],
        }),
      ],
      "rebase",
    );
    expect(plan).toContain("(retarget)");
    expect(plan).toContain("stash pop conflict unlikely");
  });

  test("shows autostash hint", () => {
    const plan = formatIntegratePlan([makeAssessment({ needsStash: true })], "rebase");
    expect(plan).toContain("(autostash)");
  });

  test("shows stash pop conflict likely hint", () => {
    const plan = formatIntegratePlan(
      [makeAssessment({ needsStash: true, stashPopConflictFiles: ["file.ts"] })],
      "rebase",
    );
    expect(plan).toContain("stash pop conflict likely");
  });

  test("shows stash pop conflict unlikely hint", () => {
    const plan = formatIntegratePlan([makeAssessment({ needsStash: true, stashPopConflictFiles: [] })], "rebase");
    expect(plan).toContain("stash pop conflict unlikely");
  });

  test("shows up-to-date", () => {
    const plan = formatIntegratePlan([makeAssessment({ outcome: "up-to-date" })], "rebase");
    expect(plan).toContain("up to date");
  });

  test("shows up-to-date for dirty skip when behind is 0", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          outcome: "skip",
          skipFlag: "dirty",
          skipReason: "uncommitted changes",
          baseBranch: "main",
          behind: 0,
        }),
      ],
      "rebase",
    );
    expect(plan).toContain("up to date");
    expect(plan).not.toContain("skipped");
  });

  test("shows skipped for dirty skip when behind base", () => {
    const plan = formatIntegratePlan(
      [makeAssessment({ outcome: "skip", skipFlag: "dirty", skipReason: "uncommitted changes", behind: 3 })],
      "rebase",
    );
    expect(plan).toContain("skipped");
    expect(plan).not.toContain("up to date");
  });

  test("shows skipped with reason", () => {
    const plan = formatIntegratePlan([makeAssessment({ outcome: "skip", skipReason: "HEAD is detached" })], "rebase");
    expect(plan).toContain("skipped");
    expect(plan).toContain("HEAD is detached");
  });

  test("shows shallow clone warning", () => {
    const plan = formatIntegratePlan([makeAssessment({ shallow: true })], "rebase");
    expect(plan).toContain("shallow clone");
    expect(plan).toContain("rebase may fail");
  });

  test("no shallow warning when not shallow", () => {
    const plan = formatIntegratePlan([makeAssessment({ shallow: false })], "rebase");
    expect(plan).not.toContain("shallow clone");
  });

  test("shows verbose commits when verbose is true", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          commits: [
            { shortHash: "def5678", subject: "feat: add new auth flow" },
            { shortHash: "890abcd", subject: "fix: handle edge case" },
          ],
          totalCommits: 2,
        }),
      ],
      "rebase",
      true,
    );
    expect(plan).toContain("Incoming from origin/main:");
    expect(plan).toContain("def5678");
    expect(plan).toContain("feat: add new auth flow");
    expect(plan).toContain("890abcd");
    expect(plan).toContain("fix: handle edge case");
  });

  test("does not show verbose commits when verbose is false", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          commits: [{ shortHash: "def5678", subject: "feat: add new auth flow" }],
          totalCommits: 1,
        }),
      ],
      "rebase",
      false,
    );
    expect(plan).not.toContain("Incoming from");
    expect(plan).not.toContain("def5678");
  });

  test("shows truncation hint when totalCommits exceeds commit list", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          commits: [{ shortHash: "def5678", subject: "feat: something" }],
          totalCommits: 30,
        }),
      ],
      "rebase",
      true,
    );
    expect(plan).toContain("... and 29 more");
  });

  test("does not show verbose commits for up-to-date repos", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          outcome: "up-to-date",
          commits: [{ shortHash: "def5678", subject: "feat: something" }],
          totalCommits: 1,
        }),
      ],
      "rebase",
      true,
    );
    expect(plan).not.toContain("Incoming from");
  });

  test("does not show verbose commits for skipped repos", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          outcome: "skip",
          skipReason: "HEAD is detached",
          commits: [{ shortHash: "def5678", subject: "feat: something" }],
          totalCommits: 1,
        }),
      ],
      "rebase",
      true,
    );
    expect(plan).not.toContain("Incoming from");
  });

  test("shows matched count breakdown in behind string", () => {
    const plan = formatIntegratePlan([makeAssessment({ behind: 5, ahead: 3, matchedCount: 3 })], "rebase", true);
    expect(plan).toContain("5 behind (3 same, 2 new)");
  });

  test("preserves existing behind format when matchedCount is 0", () => {
    const plan = formatIntegratePlan([makeAssessment({ behind: 5, ahead: 3, matchedCount: 0 })], "rebase");
    expect(plan).toContain("5 behind");
    expect(plan).not.toContain("same");
    expect(plan).not.toContain("new)");
  });

  test("preserves existing behind format when matchedCount is undefined", () => {
    const plan = formatIntegratePlan([makeAssessment({ behind: 5, ahead: 3 })], "rebase");
    expect(plan).toContain("5 behind");
    expect(plan).not.toContain("same");
    expect(plan).not.toContain("new)");
  });

  test("shows rebaseOf annotation on verbose commits", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          commits: [
            { shortHash: "abc1234", subject: "feat: add auth flow", rebaseOf: "def5678" },
            { shortHash: "890abcd", subject: "fix: typo in readme" },
          ],
          totalCommits: 2,
        }),
      ],
      "rebase",
      true,
    );
    expect(plan).toContain("(same as def5678)");
    // The unannotated commit should appear without a tag
    expect(plan).toContain("890abcd");
    expect(plan).toContain("fix: typo in readme");
    expect(plan).not.toContain("890abcd fix: typo in readme (same as");
    expect(plan).not.toContain("890abcd fix: typo in readme (squash of");
  });

  test("shows squashOf annotation on verbose commits", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          commits: [{ shortHash: "fed4321", subject: "squash: combine changes", squashOf: ["aaa1111", "bbb2222"] }],
          totalCommits: 1,
        }),
      ],
      "rebase",
      true,
    );
    expect(plan).toContain("(squash of aaa1111..bbb2222)");
  });

  // ── Graph tests ─────────────────────────────────────────────

  test("shows graph for will-operate repos", () => {
    const plan = formatIntegratePlan([makeAssessment({ mergeBaseSha: "ghi9012" })], "rebase", false, true);
    expect(plan).toContain("merge-base");
    expect(plan).toContain("ghi9012");
    expect(plan).toContain("origin/main");
  });

  test("does not show graph for up-to-date repos", () => {
    const plan = formatIntegratePlan(
      [makeAssessment({ outcome: "up-to-date", mergeBaseSha: "ghi9012" })],
      "rebase",
      false,
      true,
    );
    expect(plan).not.toContain("merge-base");
  });

  test("does not show graph for skipped repos", () => {
    const plan = formatIntegratePlan(
      [makeAssessment({ outcome: "skip", skipReason: "HEAD is detached", mergeBaseSha: "ghi9012" })],
      "rebase",
      false,
      true,
    );
    expect(plan).not.toContain("merge-base");
  });

  test("graph suppresses separate verbose section when both flags are true", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          mergeBaseSha: "ghi9012",
          commits: [{ shortHash: "def5678", subject: "feat: add new auth flow" }],
          totalCommits: 1,
        }),
      ],
      "rebase",
      true,
      true,
    );
    // Graph should be present
    expect(plan).toContain("merge-base");
    // Separate "Incoming from..." section should NOT be present
    expect(plan).not.toContain("Incoming from");
  });

  test("shows diff stats on verbose label when diffStats present", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          commits: [{ shortHash: "def5678", subject: "feat: add auth" }],
          totalCommits: 1,
          diffStats: { files: 47, insertions: 320, deletions: 180 },
        }),
      ],
      "rebase",
      true,
    );
    expect(plan).toContain("47 files changed, +320, -180");
  });

  test("does not show diff stats when diffStats is undefined", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          commits: [{ shortHash: "def5678", subject: "feat: add auth" }],
          totalCommits: 1,
        }),
      ],
      "rebase",
      true,
    );
    expect(plan).not.toContain("files changed");
  });

  test("shows retarget replay breakdown when alreadyOnTarget > 0", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          retargetFrom: "feat/old",
          retargetTo: "main",
          baseBranch: "main",
          retargetReplayCount: 2,
          retargetAlreadyOnTarget: 3,
        }),
      ],
      "rebase",
    );
    expect(plan).toContain("5 local, 3 already on target, 2 to rebase");
  });

  test("shows simplified retarget replay when alreadyOnTarget is 0", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          retargetFrom: "feat/old",
          retargetTo: "main",
          baseBranch: "main",
          retargetReplayCount: 4,
          retargetAlreadyOnTarget: 0,
        }),
      ],
      "rebase",
    );
    expect(plan).toContain("4 to rebase");
    expect(plan).not.toContain("already on target");
  });

  test("shows no replay info when retarget replay fields are undefined", () => {
    const plan = formatIntegratePlan(
      [makeAssessment({ retargetFrom: "feat/old", retargetTo: "main", baseBranch: "main" })],
      "rebase",
    );
    expect(plan).not.toContain("to rebase");
    expect(plan).not.toContain("already on target");
  });

  test("retarget graph shows replay breakdown when enriched", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          retargetFrom: "feat/old",
          retargetTo: "main",
          baseBranch: "main",
          mergeBaseSha: "xyz7890",
          retargetReplayCount: 2,
          retargetAlreadyOnTarget: 3,
        }),
      ],
      "rebase",
      false,
      true,
    );
    expect(plan).toContain("5 local, 3 already on target, 2 to rebase");
  });

  test("retarget repos get retarget-style graph", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          retargetFrom: "feat/old",
          retargetTo: "main",
          baseBranch: "main",
          mergeBaseSha: "xyz7890",
        }),
      ],
      "rebase",
      false,
      true,
    );
    expect(plan).toContain("--x--");
    expect(plan).toContain("feat/old");
    expect(plan).toContain("old base, merged");
    expect(plan).toContain("new base");
  });

  // ── Header & alignment tests ────────────────────────────────

  test("includes REPO and ACTION column headers", () => {
    const plan = formatIntegratePlan([makeAssessment()], "rebase");
    expect(plan).toContain("REPO");
    expect(plan).toContain("ACTION");
  });

  test("aligns actions across repos with different name lengths", () => {
    const plan = formatIntegratePlan(
      [makeAssessment({ repo: "short" }), makeAssessment({ repo: "much-longer-repo-name", outcome: "up-to-date" })],
      "rebase",
    );
    // Both action texts should start at the same column
    const lines = plan.split("\n").filter((l) => l.trim().length > 0);
    const actionStarts = lines
      .slice(1)
      .map((l) => (l.indexOf("rebase") !== -1 ? l.indexOf("rebase") : l.indexOf("up to date")));
    // All action columns should start at the same position
    const nonNeg = actionStarts.filter((s) => s >= 0);
    expect(nonNeg.length).toBe(2);
    expect(nonNeg[0]).toBe(nonNeg[1]);
  });

  // ── Wrong branch annotation tests ────────────────────────────────

  test("shows wrong branch hint when wrong branch repos are included", () => {
    const plan = formatIntegratePlan([makeAssessment({ wrongBranch: true, branch: "other-branch" })], "rebase");
    expect(plan).toContain("1 repo on a different branch than the workspace");
  });

  test("uses wrong branch in rebase action", () => {
    const plan = formatIntegratePlan([makeAssessment({ wrongBranch: true, branch: "other-branch" })], "rebase");
    expect(plan).toContain("rebase other-branch onto origin/main");
  });

  test("uses wrong branch in merge action", () => {
    const plan = formatIntegratePlan([makeAssessment({ wrongBranch: true, branch: "other-branch" })], "merge");
    expect(plan).toContain("merge origin/main into other-branch");
  });

  test("no wrong branch hint when no wrong branch repos", () => {
    const plan = formatIntegratePlan([makeAssessment()], "rebase");
    expect(plan).not.toContain("different branch than the workspace");
  });

  test("afterRow emits verbose commits for will-operate repos", () => {
    const plan = formatIntegratePlan(
      [
        makeAssessment({
          commits: [{ shortHash: "def5678", subject: "feat: add auth" }],
          totalCommits: 1,
        }),
        makeAssessment({ repo: "repo-b", outcome: "up-to-date" }),
      ],
      "rebase",
      true,
    );
    expect(plan).toContain("Incoming from origin/main:");
    expect(plan).toContain("def5678");
  });

  test("shows baseFallback suffix for will-operate", () => {
    const plan = formatIntegratePlan([makeAssessment({ baseFallback: "big-filter-overview" })], "rebase");
    expect(plan).toContain("base big-filter-overview not found");
  });

  test("shows baseFallback suffix for up-to-date", () => {
    const plan = formatIntegratePlan(
      [makeAssessment({ outcome: "up-to-date", baseFallback: "big-filter-overview" })],
      "rebase",
    );
    expect(plan).toContain("base big-filter-overview not found");
  });
});

describe("resolveRetargetConfigTarget", () => {
  function makeAssessment(overrides: Record<string, unknown> = {}): RepoAssessment {
    return {
      repo: "repo-a",
      repoDir: "/tmp/repo-a",
      outcome: "will-operate",
      branch: "feature",
      behind: 3,
      ahead: 1,
      baseRemote: "origin",
      baseBranch: "main",
      headSha: "abc1234",
      shallow: false,
      ...normalizeIntegrateAssessment(overrides),
    } as RepoAssessment;
  }

  test("returns null when no config retarget assessments exist", () => {
    const target = resolveRetargetConfigTarget([makeAssessment(), makeAssessment({ retargetReason: "branch-merged" })]);
    expect(target).toBeNull();
  });

  test("returns target when up-to-date retarget assessment exists", () => {
    const target = resolveRetargetConfigTarget([
      makeAssessment({
        outcome: "up-to-date",
        retargetFrom: "feat/old",
        retargetTo: "main",
        retargetReason: "base-merged",
      }),
    ]);
    expect(target).toBe("main");
  });

  test("ignores branch-merged replay retarget assessments", () => {
    const target = resolveRetargetConfigTarget([
      makeAssessment({
        retargetFrom: "abc1234",
        retargetTo: "main",
        retargetReason: "branch-merged",
      }),
      makeAssessment({
        outcome: "up-to-date",
        retargetFrom: "feat/old",
        retargetTo: "feat/A",
        retargetReason: "base-merged",
      }),
    ]);
    expect(target).toBe("feat/A");
  });

  test("throws when retarget targets disagree", () => {
    expect(() =>
      resolveRetargetConfigTarget([
        makeAssessment({ retargetFrom: "feat/old", retargetTo: "main", retargetReason: "base-merged" }),
        makeAssessment({
          repo: "repo-b",
          retargetFrom: "feat/old",
          retargetTo: "release/1.0",
          retargetReason: "base-merged",
        }),
      ]),
    ).toThrow("Cannot retarget: repos disagree on target base (main, release/1.0).");
  });
});

describe("maybeWriteRetargetConfig", () => {
  function makeAssessment(overrides: Record<string, unknown> = {}): RepoAssessment {
    return {
      repo: "repo-a",
      repoDir: "/tmp/repo-a",
      outcome: "up-to-date",
      branch: "feature",
      behind: 0,
      ahead: 2,
      baseRemote: "origin",
      baseBranch: "main",
      headSha: "abc1234",
      shallow: false,
      retarget: { from: "feat/old", to: "main", reason: "base-merged" },
      ...normalizeIntegrateAssessment(overrides),
    } as RepoAssessment;
  }

  test("does not write config on dry-run (no-op retarget path)", async () => {
    const wsDir = mkdtempSync(join(tmpdir(), "arb-retarget-dryrun-"));
    try {
      mkdirSync(join(wsDir, ".arbws"), { recursive: true });
      const configFile = join(wsDir, ".arbws", "config.json");
      writeFileSync(configFile, `${JSON.stringify({ branch: "feature", base: "feat/old" }, null, 2)}\n`);

      const wrote = await maybeWriteRetargetConfig({
        dryRun: true,
        wsDir,
        branch: "feature",
        assessments: [makeAssessment()],
        retargetConfigTarget: "main",
        cache: { getDefaultBranch: async () => "main" },
      });

      expect(wrote).toBe(false);
      expect(readFileSync(configFile, "utf-8")).toBe(
        `${JSON.stringify({ branch: "feature", base: "feat/old" }, null, 2)}\n`,
      );
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  test("writes config when not dry-run", async () => {
    const wsDir = mkdtempSync(join(tmpdir(), "arb-retarget-write-"));
    try {
      mkdirSync(join(wsDir, ".arbws"), { recursive: true });
      const configFile = join(wsDir, ".arbws", "config.json");
      writeFileSync(configFile, `${JSON.stringify({ branch: "feature", base: "feat/old" }, null, 2)}\n`);

      const wrote = await maybeWriteRetargetConfig({
        dryRun: false,
        wsDir,
        branch: "feature",
        assessments: [makeAssessment()],
        retargetConfigTarget: "main",
        cache: { getDefaultBranch: async () => "main" },
      });

      expect(wrote).toBe(true);
      expect(JSON.parse(readFileSync(configFile, "utf-8"))).toEqual({ branch: "feature" });
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  test("returns false when retargetConfigTarget is null", async () => {
    const wrote = await maybeWriteRetargetConfig({
      wsDir: "/tmp/fake",
      branch: "feature",
      assessments: [makeAssessment()],
      retargetConfigTarget: null,
      cache: { getDefaultBranch: async () => "main" },
    });
    expect(wrote).toBe(false);
  });

  test("returns false when no matching assessment found", async () => {
    const wrote = await maybeWriteRetargetConfig({
      wsDir: "/tmp/fake",
      branch: "feature",
      assessments: [makeAssessment({ retargetTo: "other-branch", retargetReason: "base-merged" })],
      retargetConfigTarget: "main",
      cache: { getDefaultBranch: async () => "main" },
    });
    expect(wrote).toBe(false);
  });

  test("returns false when hasConflicts is true", async () => {
    const wrote = await maybeWriteRetargetConfig({
      wsDir: "/tmp/fake",
      branch: "feature",
      assessments: [makeAssessment()],
      retargetConfigTarget: "main",
      cache: { getDefaultBranch: async () => "main" },
      hasConflicts: true,
    });
    expect(wrote).toBe(false);
  });

  test("writes config WITH base key when retarget target differs from default", async () => {
    const wsDir = mkdtempSync(join(tmpdir(), "arb-retarget-nondefault-"));
    try {
      mkdirSync(join(wsDir, ".arbws"), { recursive: true });
      const configFile = join(wsDir, ".arbws", "config.json");
      writeFileSync(configFile, `${JSON.stringify({ branch: "feature", base: "feat/old" }, null, 2)}\n`);

      const wrote = await maybeWriteRetargetConfig({
        dryRun: false,
        wsDir,
        branch: "feature",
        assessments: [makeAssessment({ retargetTo: "release/v2" })],
        retargetConfigTarget: "release/v2",
        cache: { getDefaultBranch: async () => "main" },
      });

      expect(wrote).toBe(true);
      expect(JSON.parse(readFileSync(configFile, "utf-8"))).toEqual({ branch: "feature", base: "release/v2" });
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  test("writes config WITHOUT base key when retarget target matches repo default branch", async () => {
    const wsDir = mkdtempSync(join(tmpdir(), "arb-retarget-default-"));
    try {
      mkdirSync(join(wsDir, ".arbws"), { recursive: true });
      const configFile = join(wsDir, ".arbws", "config.json");
      writeFileSync(configFile, `${JSON.stringify({ branch: "feature", base: "feat/old" }, null, 2)}\n`);

      const wrote = await maybeWriteRetargetConfig({
        dryRun: false,
        wsDir,
        branch: "feature",
        assessments: [makeAssessment()],
        retargetConfigTarget: "main",
        cache: { getDefaultBranch: async () => "main" },
      });

      expect(wrote).toBe(true);
      expect(JSON.parse(readFileSync(configFile, "utf-8"))).toEqual({ branch: "feature" });
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });
});

describe("maybeWriteBaseFallbackConfig", () => {
  function makeAssessment(overrides: Record<string, unknown> = {}): RepoAssessment {
    return {
      repo: "repo-a",
      repoDir: "/tmp/repo-a",
      outcome: "will-operate",
      branch: "feature",
      behind: 3,
      ahead: 1,
      baseRemote: "origin",
      baseBranch: "main",
      headSha: "abc1234",
      shallow: false,
      ...normalizeIntegrateAssessment(overrides),
    } as RepoAssessment;
  }

  test("returns null on dry-run", async () => {
    const result = await maybeWriteBaseFallbackConfig({
      dryRun: true,
      wsDir: "/tmp/fake",
      branch: "feature",
      assessments: [makeAssessment({ baseFallback: "old-branch" })],
    });
    expect(result).toBeNull();
  });

  test("returns null when hasConflicts is true", async () => {
    const result = await maybeWriteBaseFallbackConfig({
      wsDir: "/tmp/fake",
      branch: "feature",
      assessments: [makeAssessment({ baseFallback: "old-branch" })],
      hasConflicts: true,
    });
    expect(result).toBeNull();
  });

  test("returns null when no baseFallback on any assessment", async () => {
    const result = await maybeWriteBaseFallbackConfig({
      wsDir: "/tmp/fake",
      branch: "feature",
      assessments: [makeAssessment()],
    });
    expect(result).toBeNull();
  });

  test("returns null when base-merged-into-default skip exists", async () => {
    const result = await maybeWriteBaseFallbackConfig({
      wsDir: "/tmp/fake",
      branch: "feature",
      assessments: [
        makeAssessment({ baseFallback: "old-branch" }),
        makeAssessment({ outcome: "skip", skipReason: "base branch merged", skipFlag: "base-merged-into-default" }),
      ],
    });
    expect(result).toBeNull();
  });

  test("writes config without base key when baseFallback is present", async () => {
    const wsDir = mkdtempSync(join(tmpdir(), "arb-fallback-"));
    try {
      mkdirSync(join(wsDir, ".arbws"), { recursive: true });
      const configFile = join(wsDir, ".arbws", "config.json");
      writeFileSync(configFile, `${JSON.stringify({ branch: "feature", base: "old-branch" }, null, 2)}\n`);

      const result = await maybeWriteBaseFallbackConfig({
        dryRun: false,
        wsDir,
        branch: "feature",
        assessments: [makeAssessment({ baseFallback: "old-branch" })],
      });

      expect(result).toEqual({ from: "old-branch", to: "main" });
      expect(JSON.parse(readFileSync(configFile, "utf-8"))).toEqual({ branch: "feature" });
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  test("returns null when all assessments are skips (no non-skip with baseFallback)", async () => {
    const result = await maybeWriteBaseFallbackConfig({
      wsDir: "/tmp/fake",
      branch: "feature",
      assessments: [makeAssessment({ outcome: "skip", skipReason: "fetch failed", skipFlag: "fetch-failed" })],
    });
    expect(result).toBeNull();
  });

  test("works with up-to-date assessment that has baseFallback", async () => {
    const wsDir = mkdtempSync(join(tmpdir(), "arb-fallback-uptodate-"));
    try {
      mkdirSync(join(wsDir, ".arbws"), { recursive: true });
      const configFile = join(wsDir, ".arbws", "config.json");
      writeFileSync(configFile, `${JSON.stringify({ branch: "feature", base: "old-branch" }, null, 2)}\n`);

      const result = await maybeWriteBaseFallbackConfig({
        dryRun: false,
        wsDir,
        branch: "feature",
        assessments: [makeAssessment({ outcome: "up-to-date", baseFallback: "old-branch" })],
      });

      expect(result).toEqual({ from: "old-branch", to: "main" });
      expect(JSON.parse(readFileSync(configFile, "utf-8"))).toEqual({ branch: "feature" });
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  test("returns resolved baseBranch as 'to' field", async () => {
    const wsDir = mkdtempSync(join(tmpdir(), "arb-fallback-custom-"));
    try {
      mkdirSync(join(wsDir, ".arbws"), { recursive: true });
      const configFile = join(wsDir, ".arbws", "config.json");
      writeFileSync(configFile, `${JSON.stringify({ branch: "feature", base: "old-branch" }, null, 2)}\n`);

      const result = await maybeWriteBaseFallbackConfig({
        dryRun: false,
        wsDir,
        branch: "feature",
        assessments: [makeAssessment({ baseFallback: "old-branch", baseBranch: "develop" })],
      });

      expect(result).toEqual({ from: "old-branch", to: "develop" });
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  test("returns null when some non-skip repos lack baseFallback (mixed multi-repo)", async () => {
    const result = await maybeWriteBaseFallbackConfig({
      wsDir: "/tmp/fake",
      branch: "feature",
      assessments: [
        makeAssessment({ repo: "repo-a", baseFallback: "old-branch" }),
        makeAssessment({ repo: "repo-b" }), // no baseFallback — base still exists on this repo's remote
      ],
    });
    expect(result).toBeNull();
  });
});

describe("formatVerboseCommits", () => {
  test("appends diff stats to label when provided", () => {
    const out = formatVerboseCommits(
      [{ shortHash: "abc1234", subject: "feat: something" }],
      1,
      "Incoming from origin/main:",
      { diffStats: { files: 5, insertions: 100, deletions: 20 } },
    );
    expect(out).toContain("5 files changed, +100, -20");
    expect(out).toContain("abc1234");
  });

  test("uses singular 'file' for 1 file", () => {
    const out = formatVerboseCommits(
      [{ shortHash: "abc1234", subject: "feat: something" }],
      1,
      "Incoming from origin/main:",
      { diffStats: { files: 1, insertions: 10, deletions: 5 } },
    );
    expect(out).toContain("1 file changed");
    expect(out).not.toContain("1 files changed");
  });

  test("does not modify label when no options provided", () => {
    const out = formatVerboseCommits(
      [{ shortHash: "abc1234", subject: "feat: something" }],
      1,
      "Incoming from origin/main:",
    );
    expect(out).toContain("Incoming from origin/main:");
    expect(out).not.toContain("files changed");
  });

  test("annotates conflicting commits with (conflict) and file list", () => {
    const out = formatVerboseCommits(
      [
        { shortHash: "abc1234", subject: "feat: add auth" },
        { shortHash: "def5678", subject: "fix: typo" },
        { shortHash: "ghi9012", subject: "refactor: routes" },
      ],
      3,
      "Incoming from origin/main:",
      {
        conflictCommits: [
          { shortHash: "abc1234", files: ["src/auth.ts", "src/middleware.ts"] },
          { shortHash: "ghi9012", files: ["src/routes.ts"] },
        ],
      },
    );
    expect(out).toContain("abc1234");
    expect(out).toContain("(conflict)");
    expect(out).toContain("src/auth.ts, src/middleware.ts");
    expect(out).toContain("ghi9012");
    expect(out).toContain("src/routes.ts");
    // Non-conflicting commit should not have (conflict)
    expect(out).toContain("def5678");
  });

  test("does not annotate commits when conflictCommits is empty", () => {
    const out = formatVerboseCommits(
      [{ shortHash: "abc1234", subject: "feat: something" }],
      1,
      "Incoming from origin/main:",
      { conflictCommits: [] },
    );
    expect(out).not.toContain("conflict");
  });

  test("conflict annotation coexists with rebaseOf tag", () => {
    const out = formatVerboseCommits(
      [{ shortHash: "abc1234", subject: "feat: something", rebaseOf: "xyz7890" }],
      1,
      "Incoming from origin/main:",
      { conflictCommits: [{ shortHash: "abc1234", files: ["file.ts"] }] },
    );
    expect(out).toContain("same as xyz7890");
    expect(out).toContain("(conflict)");
    expect(out).toContain("file.ts");
  });
});

// ── Semantic intermediate tests ───────────────────────────────

describe("describeIntegrateAction", () => {
  function makeAssessment(overrides: Record<string, unknown> = {}): RepoAssessment {
    return {
      repo: "repo-a",
      repoDir: "/tmp/repo-a",
      outcome: "will-operate",
      branch: "feature",
      behind: 3,
      ahead: 1,
      baseRemote: "origin",
      baseBranch: "main",
      headSha: "abc1234",
      shallow: false,
      ...normalizeIntegrateAssessment(overrides),
    } as RepoAssessment;
  }

  test("normal rebase", () => {
    const desc = describeIntegrateAction(makeAssessment(), "rebase");
    expect(desc.kind).toBe("rebase");
    expect(desc.baseRef).toBe("origin/main");
    expect(desc.branch).toBe("feature");
    expect(desc.diff).toEqual({ behind: 3, ahead: 1, matchedCount: undefined });
    expect(desc.mergeType).toBeUndefined();
    expect(desc.headSha).toBe("abc1234");
  });

  test("normal merge with fast-forward", () => {
    const desc = describeIntegrateAction(makeAssessment({ ahead: 0 }), "merge");
    expect(desc.kind).toBe("merge");
    expect(desc.mergeType).toBe("fast-forward");
  });

  test("normal merge with three-way", () => {
    const desc = describeIntegrateAction(makeAssessment({ ahead: 2 }), "merge");
    expect(desc.kind).toBe("merge");
    expect(desc.mergeType).toBe("three-way");
  });

  test("conflict prediction rebase — conflict → likely", () => {
    const desc = describeIntegrateAction(makeAssessment({ conflictPrediction: "conflict" }), "rebase");
    expect(desc.conflictRisk).toBe("likely");
  });

  test("conflict prediction merge — conflict → will-conflict", () => {
    const desc = describeIntegrateAction(makeAssessment({ conflictPrediction: "conflict" }), "merge");
    expect(desc.conflictRisk).toBe("will-conflict");
  });

  test("conflict prediction rebase — clean → unlikely", () => {
    const desc = describeIntegrateAction(makeAssessment({ conflictPrediction: "clean" }), "rebase");
    expect(desc.conflictRisk).toBe("unlikely");
  });

  test("conflict prediction merge — clean → no-conflict", () => {
    const desc = describeIntegrateAction(makeAssessment({ conflictPrediction: "clean" }), "merge");
    expect(desc.conflictRisk).toBe("no-conflict");
  });

  test("conflict prediction no-conflict", () => {
    const desc = describeIntegrateAction(makeAssessment({ conflictPrediction: "no-conflict" }), "rebase");
    expect(desc.conflictRisk).toBe("no-conflict");
  });

  test("conflict prediction null", () => {
    const desc = describeIntegrateAction(makeAssessment({ conflictPrediction: null }), "rebase");
    expect(desc.conflictRisk).toBeNull();
  });

  test("stash classification — none", () => {
    const desc = describeIntegrateAction(makeAssessment(), "rebase");
    expect(desc.stash).toBe("none");
  });

  test("stash classification — autostash", () => {
    const desc = describeIntegrateAction(makeAssessment({ needsStash: true }), "rebase");
    expect(desc.stash).toBe("autostash");
  });

  test("stash classification — pop-conflict-likely", () => {
    const desc = describeIntegrateAction(
      makeAssessment({ needsStash: true, stashPopConflictFiles: ["file.ts"] }),
      "rebase",
    );
    expect(desc.stash).toBe("pop-conflict-likely");
  });

  test("stash classification — pop-conflict-unlikely", () => {
    const desc = describeIntegrateAction(makeAssessment({ needsStash: true, stashPopConflictFiles: [] }), "rebase");
    expect(desc.stash).toBe("pop-conflict-unlikely");
  });

  test("retarget-merged", () => {
    const desc = describeIntegrateAction(
      makeAssessment({
        retargetFrom: "boundary-sha",
        retargetReason: "branch-merged",
        retargetReplayCount: 2,
        retargetAlreadyOnTarget: 3,
        ahead: 5,
      }),
      "rebase",
    );
    expect(desc.kind).toBe("retarget-merged");
    expect(desc.replayCount).toBe(2);
    expect(desc.skipCount).toBe(3);
    expect(desc.conflictRisk).toBeNull();
  });

  test("retarget-merged uses ahead as fallback replayCount", () => {
    const desc = describeIntegrateAction(
      makeAssessment({
        retargetFrom: "boundary-sha",
        retargetReason: "branch-merged",
        ahead: 5,
      }),
      "rebase",
    );
    expect(desc.replayCount).toBe(5);
  });

  test("retarget-config", () => {
    const desc = describeIntegrateAction(
      makeAssessment({
        retargetFrom: "feat/old",
        retargetTo: "main",
        retargetReplayCount: 4,
        retargetAlreadyOnTarget: 2,
        retargetWarning: "base branch feat/old may not be merged",
      }),
      "rebase",
    );
    expect(desc.kind).toBe("retarget-config");
    expect(desc.retargetFrom).toBe("feat/old");
    expect(desc.replayCount).toBe(4);
    expect(desc.skipCount).toBe(2);
    expect(desc.warning).toBe("base branch feat/old may not be merged");
  });

  test("matchedCount passes through in diff", () => {
    const desc = describeIntegrateAction(makeAssessment({ matchedCount: 5 }), "rebase");
    expect(desc.diff?.matchedCount).toBe(5);
  });

  test("passes through baseFallback", () => {
    const desc = describeIntegrateAction(makeAssessment({ baseFallback: "big-filter-overview" }), "rebase");
    expect(desc.baseFallback).toBe("big-filter-overview");
  });

  test("baseFallback is undefined when not set", () => {
    const desc = describeIntegrateAction(makeAssessment(), "rebase");
    expect(desc.baseFallback).toBeUndefined();
  });
});
