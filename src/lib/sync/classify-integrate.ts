import { detectBranchMerged } from "../analysis/merge-detection";
import { analyzeRetargetReplay } from "../analysis/replay-analysis";
import { branchExistsLocally, getShortHead, git, remoteBranchExists } from "../git/git";
import { computeFlags } from "../status/flags";
import type { SkipFlag } from "../status/skip-flags";
import type { RepoStatus } from "../status/types";
import type { RepoAssessment } from "./types";

export type IntegrateMode = "rebase" | "merge";

interface IntegrateClassifierDependencies {
  analyzeRetargetReplay: typeof analyzeRetargetReplay;
  branchExistsLocally: typeof branchExistsLocally;
  detectBranchMerged: typeof detectBranchMerged;
  getShortHead: typeof getShortHead;
  git: typeof git;
  remoteBranchExists: typeof remoteBranchExists;
}

const defaultDependencies: IntegrateClassifierDependencies = {
  analyzeRetargetReplay,
  branchExistsLocally,
  detectBranchMerged,
  getShortHead,
  git,
  remoteBranchExists,
};

interface DefaultBranchResolver {
  getDefaultBranch(repoDir: string, remote: string): Promise<string | null>;
}

function withoutSkipFields<T extends { skipReason?: string; skipFlag?: SkipFlag }>(assessment: T) {
  const { skipReason: _skipReason, skipFlag: _skipFlag, ...next } = assessment;
  return next;
}

export function classifyRepo(
  status: RepoStatus,
  repoDir: string,
  branch: string,
  fetchFailed: string[],
  autostash: boolean,
  headSha: string,
  includeWrongBranch?: boolean,
): RepoAssessment {
  const base = {
    repo: status.name,
    repoDir,
    branch,
    behind: 0,
    ahead: 0,
    baseRemote: "",
    headSha,
    shallow: status.identity.shallow,
    wrongBranch: undefined as boolean | undefined,
    needsStash: undefined as boolean | undefined,
  };

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
    if (!includeWrongBranch) {
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

  const flags = computeFlags(status, branch);
  if (flags.isDirty) {
    if (!autostash) {
      return {
        ...base,
        outcome: "skip",
        skipReason: "uncommitted changes (use --autostash)",
        skipFlag: "dirty",
        ...(status.base !== null &&
          status.base.behind === 0 && {
            baseBranch: status.base.ref,
            ahead: status.base.ahead,
          }),
      };
    }
    if (status.local.staged > 0 || status.local.modified > 0) {
      base.needsStash = true;
    }
  }

  if (status.base === null) {
    return { ...base, outcome: "skip", skipReason: "no base branch", skipFlag: "no-base-branch" };
  }

  if (!status.base.remote) {
    return { ...base, outcome: "skip", skipReason: "no base remote", skipFlag: "no-base-remote" };
  }
  base.baseRemote = status.base.remote;

  if (status.base.merge != null) {
    const strategy = status.base.merge.kind === "squash" ? "squash-merged" : "merged";
    return {
      ...base,
      outcome: "skip",
      skipReason: `already ${strategy} into ${status.base.ref}`,
      skipFlag: "already-merged",
      baseBranch: status.base.ref,
      behind: status.base.behind,
      ahead: status.base.ahead,
    };
  }

  if (status.base.baseMergedIntoDefault != null) {
    return {
      ...base,
      outcome: "skip",
      skipReason: `base branch ${status.base.configuredRef ?? status.base.ref} was merged into default (use --retarget)`,
      skipFlag: "base-merged-into-default",
    };
  }

  if (status.base.behind === 0) {
    return { ...base, outcome: "up-to-date", baseBranch: status.base.ref, behind: 0, ahead: status.base.ahead };
  }

  return {
    ...base,
    outcome: "will-operate",
    baseBranch: status.base.ref,
    behind: status.base.behind,
    ahead: status.base.ahead,
  };
}

export async function assessIntegrateRepo(
  status: RepoStatus,
  repoDir: string,
  branch: string,
  fetchFailed: string[],
  options: {
    retarget: boolean;
    retargetExplicit: string | null;
    autostash: boolean;
    includeWrongBranch: boolean;
    cache: DefaultBranchResolver;
    mode: IntegrateMode;
  },
  dependencies: Partial<IntegrateClassifierDependencies> = {},
): Promise<RepoAssessment> {
  const deps = { ...defaultDependencies, ...dependencies };
  const headSha = await deps.getShortHead(repoDir);
  const classified = classifyRepo(
    status,
    repoDir,
    branch,
    fetchFailed,
    options.autostash,
    headSha,
    options.includeWrongBranch,
  );
  const base = status.base;
  const isMergedNewWork =
    classified.skipFlag === "already-merged" && base?.merge?.newCommitsAfter != null && base.merge.newCommitsAfter > 0;

  if (classified.outcome === "skip" && classified.skipFlag !== "base-merged-into-default" && !isMergedNewWork) {
    return classified;
  }

  const mergedNewWorkAssessment = await assessMergedNewWork({
    classified,
    base,
    isMergedNewWork,
    mode: options.mode,
    repoDir,
    deps,
  });
  if (mergedNewWorkAssessment) return mergedNewWorkAssessment;

  const explicitRetargetAssessment = await assessExplicitRetarget({
    classified,
    base,
    repoDir,
    retargetExplicit: options.retargetExplicit,
    deps,
  });
  if (explicitRetargetAssessment) return explicitRetargetAssessment;

  const autoRetargetAssessment = await assessAutoRetarget({
    classified,
    base,
    repoDir,
    retarget: options.retarget,
    retargetExplicit: options.retargetExplicit,
    cache: options.cache,
    mode: options.mode,
    deps,
  });
  if (autoRetargetAssessment) return autoRetargetAssessment;

  return classified;
}

async function assessMergedNewWork(input: {
  classified: RepoAssessment;
  base: RepoStatus["base"];
  isMergedNewWork: boolean;
  mode: IntegrateMode;
  repoDir: string;
  deps: IntegrateClassifierDependencies;
}): Promise<RepoAssessment | null> {
  const { classified, base, isMergedNewWork, mode, repoDir, deps } = input;
  if (!isMergedNewWork || !base) return null;

  if (mode === "merge") {
    if (base.behind === 0) {
      return {
        ...withoutSkipFields(classified),
        outcome: "up-to-date",
        baseBranch: base.ref,
        behind: 0,
        ahead: base.ahead,
      };
    }
    return {
      ...withoutSkipFields(classified),
      outcome: "will-operate",
      baseBranch: base.ref,
      behind: base.behind,
      ahead: base.ahead,
    };
  }

  const replayCount = base.merge?.newCommitsAfter ?? 0;
  const boundaryResult = await deps.git(repoDir, "rev-parse", `HEAD~${replayCount}`);
  if (boundaryResult.exitCode !== 0) return null;
  const boundarySha = boundaryResult.stdout.trim();
  return {
    ...withoutSkipFields(classified),
    outcome: "will-operate",
    baseBranch: base.ref,
    behind: base.behind,
    ahead: replayCount,
    retarget: {
      from: boundarySha,
      to: base.ref,
      replayCount,
      alreadyOnTarget: Math.max(0, base.ahead - replayCount),
      reason: "branch-merged",
    },
  };
}

async function assessExplicitRetarget(input: {
  classified: RepoAssessment;
  base: RepoStatus["base"];
  repoDir: string;
  retargetExplicit: string | null;
  deps: IntegrateClassifierDependencies;
}): Promise<RepoAssessment | null> {
  const { classified, base, repoDir, retargetExplicit, deps } = input;
  if (!retargetExplicit) return null;

  if (base && base.configuredRef !== null && base.baseMergedIntoDefault == null) {
    return classified;
  }

  const baseRemote = classified.baseRemote;
  const targetExists = await deps.remoteBranchExists(repoDir, retargetExplicit, baseRemote);
  if (!targetExists) {
    return {
      ...classified,
      outcome: "skip",
      skipReason: `target branch ${retargetExplicit} not found on ${baseRemote}`,
      skipFlag: "retarget-target-not-found",
      retarget: { blocked: true },
    };
  }

  const oldBaseName = base?.configuredRef ?? base?.ref ?? "";
  const oldBaseRemoteExists = await deps.remoteBranchExists(repoDir, oldBaseName, baseRemote);
  const oldBaseLocalExists = !oldBaseRemoteExists ? await deps.branchExistsLocally(repoDir, oldBaseName) : false;
  if (!oldBaseRemoteExists && !oldBaseLocalExists) {
    return {
      ...classified,
      outcome: "skip",
      skipReason: `base branch ${oldBaseName} not found — cannot determine rebase boundary`,
      skipFlag: "retarget-base-not-found",
      retarget: { blocked: true },
    };
  }

  const targetRef = `${baseRemote}/${retargetExplicit}`;
  const oldBaseRef = oldBaseRemoteExists ? `${baseRemote}/${oldBaseName}` : oldBaseName;
  let retargetWarning: string | undefined;
  const mergeDetection = await deps.detectBranchMerged(repoDir, targetRef, 200, oldBaseRef);
  if (mergeDetection === null) {
    retargetWarning = `base branch ${oldBaseName} may not be merged`;
  }

  if (base?.ref === retargetExplicit && base?.behind === 0) {
    return {
      ...withoutSkipFields(classified),
      outcome: "up-to-date",
      baseBranch: retargetExplicit,
      retarget: {
        from: oldBaseName,
        to: retargetExplicit,
        warning: retargetWarning,
        reason: "base-merged",
      },
      behind: base.behind,
      ahead: base.ahead,
    };
  }

  const replayAnalysis = await deps.analyzeRetargetReplay(repoDir, oldBaseRef, targetRef);
  return {
    ...withoutSkipFields(classified),
    outcome: "will-operate",
    baseBranch: retargetExplicit,
    retarget: {
      from: oldBaseName,
      to: retargetExplicit,
      warning: retargetWarning,
      reason: "base-merged",
      ...(replayAnalysis && {
        replayCount: replayAnalysis.toReplay,
        alreadyOnTarget: replayAnalysis.alreadyOnTarget,
      }),
    },
    behind: base?.behind ?? 0,
    ahead: base?.ahead ?? 0,
  };
}

async function assessAutoRetarget(input: {
  classified: RepoAssessment;
  base: RepoStatus["base"];
  repoDir: string;
  retarget: boolean;
  retargetExplicit: string | null;
  cache: DefaultBranchResolver;
  mode: IntegrateMode;
  deps: IntegrateClassifierDependencies;
}): Promise<RepoAssessment | null> {
  const { classified, base, repoDir, retarget, retargetExplicit, cache, mode, deps } = input;

  if (
    mode === "rebase" &&
    retargetExplicit === null &&
    classified.outcome === "will-operate" &&
    base?.replayPlan?.contiguous &&
    !(base.replayPlan.mergedPrefix && base.merge == null)
  ) {
    const replayPlan = base.replayPlan;
    if (replayPlan.alreadyOnTarget > 0 && replayPlan.toReplay === 0) {
      return {
        ...withoutSkipFields(classified),
        outcome: "up-to-date",
        baseBranch: base.ref,
        behind: 0,
        ahead: base.ahead,
      };
    }
    if (replayPlan.alreadyOnTarget > 0 && replayPlan.toReplay > 0) {
      return {
        ...withoutSkipFields(classified),
        outcome: "will-operate",
        baseBranch: base.ref,
        behind: base.behind,
        ahead: replayPlan.toReplay,
        retarget: {
          from: `HEAD~${replayPlan.toReplay}`,
          to: base.ref,
          replayCount: replayPlan.toReplay,
          alreadyOnTarget: replayPlan.alreadyOnTarget,
          reason: "branch-merged",
        },
      };
    }
  }

  if (base?.baseMergedIntoDefault == null) return null;
  if (!retarget) return classified;

  const baseRemote = classified.baseRemote;
  const trueDefault = await cache.getDefaultBranch(repoDir, baseRemote);
  if (!trueDefault) {
    return {
      ...classified,
      outcome: "skip",
      skipReason: "cannot resolve default branch for retarget",
      skipFlag: "retarget-no-default",
    };
  }

  const oldBaseNameForReplay = base.configuredRef ?? base.ref;
  if (base.baseMergedIntoDefault === "squash") {
    const defaultRef = `${baseRemote}/${trueDefault}`;
    const alreadyOnDefault = await deps.git(repoDir, "merge-base", "--is-ancestor", defaultRef, "HEAD");
    if (alreadyOnDefault.exitCode === 0) {
      return {
        ...withoutSkipFields(classified),
        outcome: "up-to-date",
        baseBranch: trueDefault,
        retarget: {
          from: oldBaseNameForReplay,
          to: trueDefault,
          reason: "base-merged",
        },
        behind: base.behind,
        ahead: base.ahead,
      };
    }
  }

  const oldBaseRemoteRefExists = await deps.remoteBranchExists(repoDir, oldBaseNameForReplay, baseRemote);
  const oldBaseRefForReplay = oldBaseRemoteRefExists ? `${baseRemote}/${oldBaseNameForReplay}` : oldBaseNameForReplay;
  const newBaseRefForReplay = `${baseRemote}/${trueDefault}`;
  const replayAnalysis = await deps.analyzeRetargetReplay(repoDir, oldBaseRefForReplay, newBaseRefForReplay);

  return {
    ...withoutSkipFields(classified),
    outcome: "will-operate",
    baseBranch: trueDefault,
    retarget: {
      from: base.configuredRef ?? base.ref,
      to: trueDefault,
      reason: "base-merged",
      ...(replayAnalysis && {
        replayCount: replayAnalysis.toReplay,
        alreadyOnTarget: replayAnalysis.alreadyOnTarget,
      }),
    },
    behind: base.behind,
    ahead: base.ahead,
  };
}
