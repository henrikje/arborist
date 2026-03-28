import { getShortHead } from "../git/git";
import { computeFlags } from "../status/flags";
import type { RepoStatus } from "../status/types";
import type { ExtractAssessment } from "./types";

export interface ExtractClassifierDeps {
  getShortHead: typeof getShortHead;
}

const defaultDeps: ExtractClassifierDeps = {
  getShortHead,
};

export async function assessExtractRepo(
  status: RepoStatus,
  repoDir: string,
  branch: string,
  direction: "prefix" | "suffix",
  targetBranch: string,
  resolvedBoundary: string | null,
  mergeBase: string,
  fetchFailed: string[],
  options: {
    autostash: boolean;
    includeWrongBranch: boolean;
  },
  dependencies?: Partial<ExtractClassifierDeps>,
): Promise<ExtractAssessment> {
  const deps = { ...defaultDeps, ...dependencies };
  const headSha = status.headSha ?? (await deps.getShortHead(repoDir));

  const base = {
    repo: status.name,
    repoDir,
    branch,
    direction,
    targetBranch,
    boundary: resolvedBoundary,
    mergeBase,
    commitsExtracted: 0,
    commitsRemaining: 0,
    headSha,
    shallow: status.identity.shallow,
    baseRemote: status.base?.remote ?? "",
    baseResolvedLocally: status.base?.resolvedVia === "local",
    wrongBranch: undefined as boolean | undefined,
    needsStash: undefined as boolean | undefined,
  };

  // ── Blocker checks ──

  if (fetchFailed.includes(status.name)) {
    return { ...base, outcome: "skip", skipReason: "fetch failed", skipFlag: "fetch-failed" };
  }

  if (status.operation) {
    return {
      ...base,
      outcome: "skip",
      skipReason: `${status.operation} in progress`,
      skipFlag: "operation-in-progress",
    };
  }

  if (status.identity.headMode.kind === "detached") {
    return { ...base, outcome: "skip", skipReason: "detached HEAD", skipFlag: "detached-head" };
  }

  // Wrong branch check
  const flags = computeFlags(status, branch);
  if (flags.isWrongBranch) {
    if (!options.includeWrongBranch) {
      return { ...base, outcome: "skip", skipReason: "wrong branch", skipFlag: "wrong-branch" };
    }
    base.wrongBranch = true;
    base.branch = status.identity.headMode.kind === "attached" ? status.identity.headMode.branch : branch;
  }

  if (!status.base) {
    return { ...base, outcome: "skip", skipReason: "no base branch", skipFlag: "no-base-branch" };
  }

  // ── No-op checks ──

  const aheadOfBase = status.base.ahead;
  if (aheadOfBase === 0) {
    return { ...base, outcome: "no-op" };
  }

  if (!resolvedBoundary) {
    // No split point specified for this repo — all commits stay in original
    return { ...base, commitsRemaining: aheadOfBase, outcome: "no-op" };
  }

  // ── Dirty check (only for repos that will be modified) ──

  if (flags.isDirty) {
    if (!options.autostash) {
      return { ...base, outcome: "skip", skipReason: "uncommitted changes", skipFlag: "dirty" };
    }
    if (flags.hasStaged || flags.hasModified) {
      base.needsStash = true;
    }
  }

  // Commit counts are computed in the command's postAssess step via git rev-list.
  // The classifier sets placeholders; postAssess overwrites them with accurate values.
  base.commitsExtracted = 0;
  base.commitsRemaining = aheadOfBase;

  return { ...base, outcome: "will-extract" };
}
