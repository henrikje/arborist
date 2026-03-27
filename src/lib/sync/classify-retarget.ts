import { detectBranchMerged } from "../analysis/merge-detection";
import { analyzeRetargetReplay } from "../analysis/replay-analysis";
import { branchExistsLocally, getShortHead, remoteBranchExists } from "../git/git";
import { computeFlags } from "../status/flags";
import type { RepoStatus } from "../status/types";
import type { RetargetAssessment } from "./types";

export interface RetargetClassifierDeps {
  remoteBranchExists: typeof remoteBranchExists;
  branchExistsLocally: typeof branchExistsLocally;
  detectBranchMerged: typeof detectBranchMerged;
  getShortHead: typeof getShortHead;
  analyzeRetargetReplay: typeof analyzeRetargetReplay;
}

const defaultDeps: RetargetClassifierDeps = {
  remoteBranchExists,
  branchExistsLocally,
  detectBranchMerged,
  getShortHead,
  analyzeRetargetReplay,
};

export async function assessRetargetRepo(
  status: RepoStatus,
  repoDir: string,
  branch: string,
  targetBranch: string | null,
  fetchFailed: string[],
  options: {
    autostash: boolean;
    includeWrongBranch: boolean;
    repoBaseRemote?: string;
    cache: { getDefaultBranch(repoDir: string, remote: string): Promise<string | null> };
  },
  dependencies?: Partial<RetargetClassifierDeps>,
): Promise<RetargetAssessment> {
  const deps = { ...defaultDeps, ...dependencies };
  const headSha = status.headSha ?? (await deps.getShortHead(repoDir));

  const base = {
    repo: status.name,
    repoDir,
    branch,
    targetBranch: targetBranch ?? "",
    baseRemote: "",
    baseResolvedLocally: undefined as boolean | undefined,
    oldBase: "",
    headSha,
    shallow: status.identity.shallow,
    baseMerged: false,
    wrongBranch: undefined as boolean | undefined,
    needsStash: undefined as boolean | undefined,
  };

  // ── Blocker checks ──

  if (fetchFailed.includes(status.name)) {
    return { ...base, outcome: "skip", skipReason: "fetch failed", skipFlag: "fetch-failed" };
  }

  if (status.operation !== null) {
    return {
      ...base,
      outcome: "skip",
      skipReason: `${status.operation} in progress`,
      skipFlag: "operation-in-progress",
    };
  }

  if (status.identity.headMode.kind === "detached") {
    return { ...base, outcome: "skip", skipReason: "HEAD is detached", skipFlag: "detached-head" };
  }

  if (status.identity.headMode.branch !== branch) {
    if (!options.includeWrongBranch) {
      return {
        ...base,
        outcome: "skip",
        skipReason: `on branch ${status.identity.headMode.branch}, expected ${branch} (use --include-wrong-branch)`,
        skipFlag: "wrong-branch",
      };
    }
    base.branch = status.identity.headMode.branch;
    base.wrongBranch = true;
  }

  // ── Resolve base remote ──

  if (status.base === null || (!status.base.remote && status.base.resolvedVia !== "local")) {
    return { ...base, outcome: "skip", skipReason: "no base branch", skipFlag: "no-base-branch" };
  }
  // For locally-resolved bases, use the repo's base remote name (from caller) for target checks.
  base.baseRemote = status.base.remote ?? options.repoBaseRemote ?? "";
  base.baseResolvedLocally = status.base.resolvedVia === "local";

  // ── Resolve target branch ──

  let resolvedTarget = targetBranch;
  if (resolvedTarget === null) {
    resolvedTarget = await options.cache.getDefaultBranch(repoDir, base.baseRemote);
    if (!resolvedTarget) {
      return {
        ...base,
        outcome: "skip",
        skipReason: "cannot resolve default branch for retarget",
        skipFlag: "retarget-no-default",
      };
    }
  }
  base.targetBranch = resolvedTarget;

  // ── Check target exists on remote ──

  const targetExists = await deps.remoteBranchExists(repoDir, resolvedTarget, base.baseRemote);
  if (!targetExists) {
    return {
      ...base,
      outcome: "skip",
      skipReason: `target branch ${resolvedTarget} not found on ${base.baseRemote}`,
      skipFlag: "retarget-target-not-found",
    };
  }

  // ── Resolve old base ──

  const oldBaseName = status.base.configuredRef ?? status.base.ref ?? "";
  base.oldBase = oldBaseName;

  // Already targeting this base — nothing to retarget (use 'arb rebase' to sync)
  if (oldBaseName === resolvedTarget) {
    return {
      ...base,
      outcome: "skip",
      skipReason: `already based on ${oldBaseName} (use 'arb rebase' to sync)`,
      skipFlag: "retarget-same-base",
    };
  }

  const oldBaseRemoteExists = await deps.remoteBranchExists(repoDir, oldBaseName, base.baseRemote);
  const oldBaseLocalExists = !oldBaseRemoteExists ? await deps.branchExistsLocally(repoDir, oldBaseName) : false;
  if (!oldBaseRemoteExists && !oldBaseLocalExists) {
    return {
      ...base,
      outcome: "skip",
      skipReason: `base branch ${oldBaseName} not found — cannot determine rebase boundary`,
      skipFlag: "retarget-base-not-found",
    };
  }

  // ── Determine if base was merged ──

  const baseMerged = status.base.baseMergedIntoDefault != null;
  base.baseMerged = baseMerged;

  const targetRef = `${base.baseRemote}/${resolvedTarget}`;
  const oldBaseRef = oldBaseRemoteExists ? `${base.baseRemote}/${oldBaseName}` : oldBaseName;

  let retargetWarning: string | undefined;
  if (baseMerged) {
    const mergeDetection = await deps.detectBranchMerged(repoDir, targetRef, 200, oldBaseRef);
    if (mergeDetection === null) {
      retargetWarning = `base branch ${oldBaseName} may not be merged`;
    }
  }

  // ── Check up-to-date ──

  if (status.base.ref === resolvedTarget && status.base.behind === 0) {
    return {
      ...base,
      outcome: "up-to-date",
      warning: retargetWarning,
    };
  }

  // ── Dirty check — only reached for repos that need retarget ──

  const flags = computeFlags(status, branch);
  if (flags.isDirty) {
    if (!options.autostash) {
      return {
        ...base,
        outcome: "skip",
        skipReason: "uncommitted changes (use --autostash)",
        skipFlag: "dirty",
      };
    }
    if (status.local.staged > 0 || status.local.modified > 0) {
      base.needsStash = true;
    }
  }

  // ── Compute replay analysis ──

  const replayAnalysis = await deps.analyzeRetargetReplay(repoDir, oldBaseRef, targetRef);

  return {
    ...base,
    outcome: "will-retarget",
    warning: retargetWarning,
    ...(replayAnalysis && {
      replayCount: replayAnalysis.toReplay,
      alreadyOnTarget: replayAnalysis.alreadyOnTarget,
    }),
  };
}
