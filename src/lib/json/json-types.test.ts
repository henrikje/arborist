import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import type { RepoStatus, WorkspaceSummary } from "../status/types";
import {
  BranchJsonOutputSchema,
  ListJsonEntrySchema,
  LogJsonOutputSchema,
  LogJsonRepoSchema,
  RepoListJsonEntrySchema,
  StatusJsonOutputSchema,
  StatusJsonRepoSchema,
} from "./json-types";

// These tests verify structural compatibility at compile time (via type
// annotations) and runtime conformance (via zod .parse()).

describe("json-types structural compatibility", () => {
  test("RepoStatus is assignable to StatusJsonRepo", () => {
    const repo: RepoStatus = {} as RepoStatus;
    const _json: Parameters<typeof StatusJsonRepoSchema.parse>[0] = repo;
    expect(true).toBe(true);
  });

  test("StatusJsonOutput extends WorkspaceSummary with prediction counts", () => {
    // WorkspaceSummary is the base data; StatusJsonOutput adds baseConflictCount
    // and pullConflictCount (computed at command level, not during gathering).
    // This test documents that divergence is intentional.
    type OutputKeys = keyof z.infer<typeof StatusJsonOutputSchema>;
    type SummaryKeys = keyof WorkspaceSummary;
    type AddedKeys = Exclude<OutputKeys, SummaryKeys>;
    const _check: AddedKeys extends "baseConflictCount" | "pullConflictCount" ? true : false = true;
    expect(_check).toBe(true);
  });
});

describe("json-types zod validation", () => {
  test("StatusJsonRepoSchema parses a representative repo", () => {
    const repo = {
      name: "api",
      identity: {
        worktreeKind: "linked" as const,
        headMode: { kind: "attached" as const, branch: "feat-x" },
        shallow: false,
      },
      local: { staged: 1, modified: 2, untracked: 0, conflicts: 0 },
      base: {
        remote: "upstream",
        ref: "upstream/main",
        configuredRef: null,
        ahead: 3,
        behind: 1,
        baseMergedIntoDefault: null,
      },
      share: {
        remote: "origin",
        ref: "origin/feat-x",
        refMode: "implicit" as const,
        toPush: 2,
        toPull: 0,
      },
      operation: null,
      lastCommit: "2025-01-15T10:30:00Z",
    };
    expect(() => StatusJsonRepoSchema.parse(repo)).not.toThrow();
  });

  test("StatusJsonRepoSchema parses repo with replayPlan including mergedPrefix", () => {
    const repo = {
      name: "api",
      identity: {
        worktreeKind: "linked" as const,
        headMode: { kind: "attached" as const, branch: "feat-x" },
        shallow: false,
      },
      local: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        ahead: 4,
        behind: 6,
        baseMergedIntoDefault: null,
        replayPlan: {
          totalLocal: 4,
          alreadyOnTarget: 3,
          toReplay: 1,
          contiguous: true,
          mergedPrefix: true,
        },
      },
      share: {
        remote: "origin",
        ref: null,
        refMode: "noRef" as const,
        toPush: null,
        toPull: null,
      },
      operation: null,
      lastCommit: "2025-01-15T10:30:00Z",
    };
    expect(() => StatusJsonRepoSchema.parse(repo)).not.toThrow();
  });

  test("StatusJsonRepoSchema parses repo with predictions", () => {
    const repo = {
      name: "api",
      identity: {
        worktreeKind: "linked" as const,
        headMode: { kind: "attached" as const, branch: "feat-x" },
        shallow: false,
      },
      local: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
      base: {
        remote: "upstream",
        ref: "upstream/main",
        configuredRef: null,
        ahead: 3,
        behind: 2,
        baseMergedIntoDefault: null,
      },
      share: {
        remote: "origin",
        ref: "origin/feat-x",
        refMode: "implicit" as const,
        toPush: 2,
        toPull: 1,
      },
      predictions: { baseConflict: true, pullConflict: false },
      operation: null,
      lastCommit: "2025-01-15T10:30:00Z",
    };
    expect(() => StatusJsonRepoSchema.parse(repo)).not.toThrow();
  });

  test("StatusJsonRepoSchema parses detached repo with null base", () => {
    const repo = {
      name: "web",
      identity: {
        worktreeKind: "linked" as const,
        headMode: { kind: "detached" as const },
        shallow: false,
      },
      local: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
      base: null,
      share: {
        remote: "origin",
        ref: null,
        refMode: "noRef" as const,
        toPush: null,
        toPull: null,
      },
      operation: null,
      lastCommit: null,
    };
    expect(() => StatusJsonRepoSchema.parse(repo)).not.toThrow();
  });

  test("StatusJsonOutputSchema parses a representative output", () => {
    const output = {
      workspace: "my-feature",
      branch: "feat-x",
      base: "main",
      repos: [],
      total: 0,
      atRiskCount: 0,
      baseConflictCount: 0,
      pullConflictCount: 0,
      outdatedOnlyCount: 0,
      statusCounts: [],
      lastCommit: null,
    };
    expect(() => StatusJsonOutputSchema.parse(output)).not.toThrow();
  });

  test("LogJsonRepoSchema parses repo with commits", () => {
    const repo = {
      name: "api",
      status: "ok" as const,
      commits: [{ hash: "abc123def", shortHash: "abc123d", subject: "Add feature" }],
    };
    expect(() => LogJsonRepoSchema.parse(repo)).not.toThrow();
  });

  test("LogJsonOutputSchema parses a representative output", () => {
    const output = {
      workspace: "my-feature",
      branch: "feat-x",
      base: "main",
      repos: [],
      totalCommits: 0,
    };
    expect(() => LogJsonOutputSchema.parse(output)).not.toThrow();
  });

  test("RepoListJsonEntrySchema parses an entry", () => {
    const entry = {
      name: "api",
      url: "git@github.com:org/api.git",
      share: { name: "origin", url: "git@github.com:org/api.git" },
      base: { name: "origin", url: "git@github.com:org/api.git" },
    };
    expect(() => RepoListJsonEntrySchema.parse(entry)).not.toThrow();
  });

  test("ListJsonEntrySchema parses a basic entry", () => {
    const entry = {
      workspace: "test",
      active: true,
      branch: "main",
      base: null,
      repoCount: 2,
      status: null,
    };
    expect(() => ListJsonEntrySchema.parse(entry)).not.toThrow();
  });

  test("ListJsonEntrySchema parses an entry with status details", () => {
    const entry = {
      workspace: "feat",
      active: false,
      branch: "feat-x",
      base: "main",
      repoCount: 3,
      status: null,
      atRiskCount: 1,
      statusCounts: [{ label: "ahead share", count: 1 }],
      lastCommit: "2025-01-15T10:30:00Z",
    };
    expect(() => ListJsonEntrySchema.parse(entry)).not.toThrow();
  });

  test("BranchJsonOutputSchema parses a representative output", () => {
    const output = {
      branch: "feat-x",
      base: "main",
      repos: [
        { name: "api", branch: "feat-x" },
        { name: "web", branch: null },
      ],
    };
    expect(() => BranchJsonOutputSchema.parse(output)).not.toThrow();
  });
});
