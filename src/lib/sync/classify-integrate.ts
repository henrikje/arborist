import { getShortHead, gitLocal } from "../git/git";
import { computeFlags } from "../status/flags";
import type { SkipFlag } from "../status/skip-flags";
import type { RepoStatus } from "../status/types";
import type { RepoAssessment } from "./types";

export type IntegrateMode = "rebase" | "merge";

interface IntegrateClassifierDependencies {
  getShortHead: typeof getShortHead;
  git: typeof gitLocal;
}

const defaultDependencies: IntegrateClassifierDependencies = {
  getShortHead,
  git: gitLocal,
};

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
    baseResolvedLocally: false,
    headSha,
    shallow: status.identity.shallow,
    wrongBranch: undefined as boolean | undefined,
    needsStash: undefined as boolean | undefined,
    baseFallback: undefined as string | undefined,
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

  if (status.base === null) {
    return { ...base, outcome: "skip", skipReason: "no base branch", skipFlag: "no-base-branch" };
  }

  if (!status.base.remote && status.base.resolvedVia !== "local") {
    return { ...base, outcome: "skip", skipReason: "no base remote", skipFlag: "no-base-remote" };
  }
  base.baseRemote = status.base.remote ?? "";
  base.baseResolvedLocally = status.base.resolvedVia === "local";

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
      skipReason: `base branch ${status.base.configuredRef ?? status.base.ref} was merged into default (use 'arb retarget')`,
      skipFlag: "base-merged-into-default",
    };
  }

  if (status.base.configuredRef != null) {
    base.baseFallback = status.base.configuredRef;
  }

  if (status.base.behind === 0) {
    return { ...base, outcome: "up-to-date", baseBranch: status.base.ref, behind: 0, ahead: status.base.ahead };
  }

  const flags = computeFlags(status, branch);
  if (flags.isDirty) {
    if (!autostash) {
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
    autostash: boolean;
    includeWrongBranch: boolean;
    mode: IntegrateMode;
  },
  dependencies: Partial<IntegrateClassifierDependencies> = {},
): Promise<RepoAssessment> {
  const deps = { ...defaultDependencies, ...dependencies };
  const headSha = status.headSha ?? (await deps.getShortHead(repoDir));
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
  const isFullyMerged = classified.skipFlag === "already-merged" && !isMergedNewWork;

  if (classified.outcome === "skip" && !isMergedNewWork && !isFullyMerged) {
    return classified;
  }

  const mergedNewWorkAssessment = await assessMergedNewWork({
    classified,
    base,
    isMergedNewWork,
    mode: options.mode,
    repoDir,
    deps,
    status,
    branch,
    autostash: options.autostash,
  });
  if (mergedNewWorkAssessment) return mergedNewWorkAssessment;

  // Fully-merged branches: reset to base instead of skipping.
  // For rebase mode, use --onto to move the branch pointer to the base (0 commits replayed).
  // For merge mode, fast-forward merge to the base.
  if (isFullyMerged && base) {
    const behind = base.behind;
    const ahead = base.ahead;

    if (behind === 0 && ahead === 0) {
      return { ...withoutSkipFields(classified), outcome: "up-to-date", baseBranch: base.ref, behind: 0, ahead: 0 };
    }

    const flags = computeFlags(status, branch);
    if (flags.isDirty && !options.autostash) {
      return {
        ...classified,
        outcome: "skip" as const,
        skipReason: "uncommitted changes (use --autostash)",
        skipFlag: "dirty" as const,
      };
    }
    const needsStash =
      flags.isDirty && options.autostash && (status.local.staged > 0 || status.local.modified > 0) ? true : undefined;

    if (options.mode === "rebase") {
      return {
        ...withoutSkipFields(classified),
        outcome: "will-operate",
        baseBranch: base.ref,
        behind,
        ahead: 0,
        needsStash,
        retarget: {
          from: headSha,
          to: base.ref,
          replayCount: 0,
          alreadyOnTarget: ahead,
          reason: "branch-merged",
        },
      };
    }

    // Merge mode
    if (behind > 0) {
      return {
        ...withoutSkipFields(classified),
        outcome: "will-operate",
        baseBranch: base.ref,
        behind,
        ahead,
        needsStash,
      };
    }

    return { ...withoutSkipFields(classified), outcome: "up-to-date", baseBranch: base.ref, behind: 0, ahead };
  }

  // Auto-replay-plan optimization: when the base branch has squash-merged some of
  // the feature branch's commits, detect contiguous replay plans and use --onto
  // to skip already-merged commits during a normal rebase.
  if (
    options.mode === "rebase" &&
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

  return classified;
}

async function assessMergedNewWork(input: {
  classified: RepoAssessment;
  base: RepoStatus["base"];
  isMergedNewWork: boolean;
  mode: IntegrateMode;
  repoDir: string;
  deps: IntegrateClassifierDependencies;
  status: RepoStatus;
  branch: string;
  autostash: boolean;
}): Promise<RepoAssessment | null> {
  const { classified, base, isMergedNewWork, mode, repoDir, deps, status, branch, autostash } = input;
  if (!isMergedNewWork || !base) return null;

  // Up-to-date check before dirty (per GUIDELINES.md § Classification check order).
  // Only merge mode has an up-to-date case — rebase always retargets.
  if (mode === "merge" && base.behind === 0) {
    return {
      ...withoutSkipFields(classified),
      outcome: "up-to-date",
      baseBranch: base.ref,
      behind: 0,
      ahead: base.ahead,
    };
  }

  // All remaining paths need work — check dirty before will-operate
  const flags = computeFlags(status, branch);
  if (flags.isDirty && !autostash) {
    return {
      ...classified,
      outcome: "skip" as const,
      skipReason: "uncommitted changes (use --autostash)",
      skipFlag: "dirty" as const,
    };
  }
  const needsStash =
    flags.isDirty && autostash && (status.local.staged > 0 || status.local.modified > 0) ? true : undefined;

  if (mode === "merge") {
    return {
      ...withoutSkipFields(classified),
      outcome: "will-operate",
      baseBranch: base.ref,
      behind: base.behind,
      ahead: base.ahead,
      needsStash,
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
    needsStash,
    retarget: {
      from: boundarySha,
      to: base.ref,
      replayCount,
      alreadyOnTarget: Math.max(0, base.ahead - replayCount),
      reason: "branch-merged",
    },
  };
}
