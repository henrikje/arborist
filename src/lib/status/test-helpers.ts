import type { RepoStatus } from "./types";

export function makeRepo(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return {
    name: "test-repo",
    identity: {
      worktreeKind: "linked",
      headMode: { kind: "attached", branch: "feature" },
      shallow: false,
    },
    local: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
    base: {
      remote: "origin",
      ref: "main",
      configuredRef: null,
      ahead: 0,
      behind: 0,
      baseMergedIntoDefault: null,
    },
    share: {
      remote: "origin",
      ref: "origin/feature",
      refMode: "configured",
      toPush: 0,
      toPull: 0,
    },
    operation: null,
    lastCommit: null,
    lastActivity: null,
    lastActivityFile: null,
    ...overrides,
  };
}
