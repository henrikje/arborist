import { basename } from "node:path";
import { detectRebasedCommits, detectReplacedCommits, detectSquashedCommits } from "../analysis/commit-matching";
import { detectBranchMerged, findMergeCommitForBranch, findTicketReferencedCommit } from "../analysis/merge-detection";
import { analyzeReplayPlan } from "../analysis/replay-analysis";
import { readWorkspaceConfig } from "../core/config";
import { latestCommitDate } from "../core/time";
import {
  branchIsInWorktree,
  detectOperation,
  getHeadCommitDate,
  gitLocal,
  isLinkedWorktree,
  isShallowRepo,
  parseStatusPorcelain,
} from "../git/git";
import type { GitCache } from "../git/git-cache";
import { buildPrUrl, parseRemoteUrl } from "../git/remote-url";
import type { RepoRemotes } from "../git/remotes";
import { getRepoActivityDate, getWorkspaceActivityDate } from "../workspace/activity";
import { workspaceBranch } from "../workspace/branch";
import { workspaceRepoDirs } from "../workspace/repos";
import { type AnalysisCache, type AnalysisCacheEntry, analysisCacheKey } from "./analysis-cache";
import { computeSummaryAggregates } from "./flags";
import { extractPrNumber } from "./pr-detection";
import { detectTicketFromName } from "./ticket-detection";
import type { RepoRefs, RepoStatus, WorkspaceSummary } from "./types";

/** Build the full git ref for a base section (e.g. "origin/main"). */
export function baseRef(base: NonNullable<RepoStatus["base"]>): string {
  return base.remote ? `${base.remote}/${base.ref}` : base.ref;
}

// ── Pure Helpers (extracted for testability) ──

/** Parse `git rev-list --left-right --count` stdout into two numbers. */
export function parseLeftRight(stdout: string): { left: number; right: number } {
  const parts = stdout.trim().split(/\s+/);
  return {
    left: Number.parseInt(parts[0] ?? "0", 10),
    right: Number.parseInt(parts[1] ?? "0", 10),
  };
}

/** Determine whether merge detection should run for a repo. */
export function shouldRunMergeDetection(
  baseStatus: RepoStatus["base"],
  shareStatus: RepoStatus["share"],
  detached: boolean,
  actualBranch: string,
): boolean {
  if (baseStatus === null || detached) return false;
  const hasWork = baseStatus.ahead > 0 || baseStatus.behind > 0;
  const isGone = shareStatus.refMode === "gone";
  const isOnBaseBranch = actualBranch === baseStatus.ref;
  const skipForNeverPushed = baseStatus.ahead === 0 && shareStatus.refMode === "noRef";
  return (hasWork || isGone) && !isOnBaseBranch && !skipForNeverPushed;
}

/** Compute which merge detection strategies to use. */
export function computeMergeDetectionStrategy(
  baseStatus: NonNullable<RepoStatus["base"]>,
  shareStatus: RepoStatus["share"],
): { shouldCheckSquash: boolean; shouldCheckPrefixes: boolean; prefixLimit: number } {
  const shareUpToDate = shareStatus.toPush === 0 && shareStatus.toPull === 0 && shareStatus.refMode !== "noRef";
  const shouldCheckSquash = shareStatus.refMode === "gone" || shareUpToDate;

  const shouldCheckPrefixes =
    shareStatus.refMode !== "noRef" &&
    shareStatus.toPush !== null &&
    shareStatus.toPush > 0 &&
    (shareStatus.toPull === null || shareStatus.toPull === 0);

  let prefixLimit: number;
  if (shouldCheckPrefixes) {
    prefixLimit = Math.min(shareStatus.toPush ?? 0, 10);
  } else {
    prefixLimit = baseStatus.ahead > 1 ? Math.min(baseStatus.ahead - 1, 10) : 0;
  }

  return { shouldCheckSquash, shouldCheckPrefixes, prefixLimit };
}

// ── Share Divergence Detection ──

async function detectShareDivergence(
  repoDir: string,
  trackingRef: string,
  branch: string,
  toPush: number | null,
  toPull: number | null,
): Promise<{ outdated?: NonNullable<RepoStatus["share"]["outdated"]> }> {
  if (toPush === null || toPush <= 0 || toPull === null || toPull <= 0) return {};

  let rebased = 0;
  let replaced = 0;
  let squashed = 0;

  const rebasedResult = await detectRebasedCommits(repoDir, trackingRef);
  rebased = rebasedResult?.count ?? 0;
  const unmatchedPull = toPull - rebased;
  if (unmatchedPull > 0) {
    const rebasedRemoteHashes = rebasedResult?.rebasedRemoteHashes ?? new Set<string>();
    const replacedResult = await detectReplacedCommits(repoDir, trackingRef, branch, rebasedRemoteHashes);
    replaced = replacedResult?.count ?? 0;
  }
  const unmatchedAfterReplace = toPull - rebased - replaced;
  if (unmatchedAfterReplace > 0) {
    const squashedResult = await detectSquashedCommits(repoDir, trackingRef, toPull);
    squashed = squashedResult?.count ?? 0;
  }

  const total = rebased + replaced + squashed;
  if (total === 0) return {};
  return { outdated: { total, rebased, replaced, squashed } };
}

// ── Status Gathering ──

export async function gatherRepoStatus(
  repoDir: string,
  reposDir: string,
  configBase: string | null,
  remotes: RepoRemotes | undefined,
  cache: GitCache,
  analysisCache?: AnalysisCache,
): Promise<RepoStatus> {
  const repo = basename(repoDir);
  const repoPath = `${reposDir}/${repo}`;

  // ── Section 1: Identity ──

  // Worktree kind check
  const worktreeKind: "full" | "linked" = isLinkedWorktree(repoDir) ? "linked" : "full";

  // Parallel group: branch, porcelain status, shallow check, git-dir for operations, head SHA
  const [branchResult, statusResult, shallow, gitDirResult, fullHeadResult] = await Promise.all([
    gitLocal(repoDir, "symbolic-ref", "--short", "HEAD"),
    gitLocal(repoDir, "status", "--porcelain"),
    isShallowRepo(repoDir),
    detectOperation(repoDir),
    gitLocal(repoDir, "rev-parse", "HEAD"),
  ]);
  const fullHeadSha = fullHeadResult.exitCode === 0 ? fullHeadResult.stdout.trim() : "";
  const headSha = fullHeadSha ? fullHeadSha.slice(0, 7) : undefined;

  // Short-circuit if any initial call timed out (exit code 124 = cloud-stalled filesystem)
  if (branchResult.exitCode === 124 || statusResult.exitCode === 124) {
    return {
      name: repo,
      identity: { worktreeKind, headMode: { kind: "detached" }, shallow: false },
      local: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
      base: null,
      share: { remote: "", ref: null, refMode: "noRef", toPush: null, toPull: null },
      operation: null,
      timedOut: true,
      lastCommit: null,
      lastActivity: null,
      lastActivityFile: null,
    };
  }

  const local =
    statusResult.exitCode !== 0
      ? { staged: 0, modified: 0, untracked: 0, conflicts: 0 }
      : parseStatusPorcelain(statusResult.stdout);

  const actualBranch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : "";
  const detached = actualBranch === "";
  const headMode: RepoStatus["identity"]["headMode"] = detached
    ? { kind: "detached" }
    : { kind: "attached", branch: actualBranch };

  // Resolve remote names (upstream for base, share for tracking).
  // When caller didn't pre-resolve, resolve here. Errors propagate.
  const resolvedRemotes = remotes ?? (await cache.resolveRemotes(repoPath));
  const baseRemote = resolvedRemotes.base;
  const shareRemote = resolvedRemotes.share;

  // ── Section 2: Local (working tree status) ──
  // Gathered above in the parallel group (parseGitStatus → local).

  // ── Section 3: Base (integration status vs upstream default branch) ──

  let baseStatus: RepoStatus["base"] = null;
  let compareRef: string | null = null;
  if (!detached) {
    // Base branch resolution
    let defaultBranch: string | null = null;
    let fellBack = false;
    if (configBase) {
      const baseExists = await cache.remoteBranchExists(repoPath, configBase, baseRemote);
      if (baseExists) {
        defaultBranch = configBase;
      }
    }
    if (!defaultBranch && baseRemote) {
      defaultBranch = await cache.getDefaultBranch(repoPath, baseRemote);
      if (configBase && defaultBranch) fellBack = true;
    }

    if (defaultBranch) {
      compareRef = baseRemote ? `${baseRemote}/${defaultBranch}` : defaultBranch;
      const lr = await gitLocal(repoDir, "rev-list", "--left-right", "--count", `${compareRef}...HEAD`);
      if (lr.exitCode === 0) {
        const { left: behind, right: ahead } = parseLeftRight(lr.stdout);
        baseStatus = {
          remote: baseRemote ?? null,
          ref: defaultBranch,
          configuredRef: fellBack ? configBase : null,
          ahead,
          behind,
          baseMergedIntoDefault: null,
        };
      }
    }
  }

  // ── Section 4: Share (push/pull status vs share remote) ──
  // Note: share divergence detection is deferred to the analysis phase below
  // so it can be served from the analysis cache.

  let shareStatus: RepoStatus["share"];
  let shareDivergenceRef: string | null = null; // ref to use for divergence detection
  if (!detached) {
    // Step 1: Try configured tracking branch
    const upstreamResult = await gitLocal(repoDir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
    if (upstreamResult.exitCode === 0) {
      const trackingRef = upstreamResult.stdout.trim();
      const pushLr = await gitLocal(repoDir, "rev-list", "--left-right", "--count", `${trackingRef}...HEAD`);
      let toPush: number | null = null;
      let toPull: number | null = null;
      if (pushLr.exitCode === 0) {
        const { left, right } = parseLeftRight(pushLr.stdout);
        toPull = left;
        toPush = right;
      }
      shareStatus = {
        remote: shareRemote,
        ref: trackingRef,
        refMode: "configured",
        toPush,
        toPull,
      };
      shareDivergenceRef = trackingRef;
    } else if (await cache.remoteBranchExists(repoPath, actualBranch, shareRemote)) {
      // Step 2: No tracking config but remote ref exists → implicit
      const implicitRef = `${shareRemote}/${actualBranch}`;
      const pushLr = await gitLocal(repoDir, "rev-list", "--left-right", "--count", `${implicitRef}...HEAD`);
      let toPush: number | null = null;
      let toPull: number | null = null;
      if (pushLr.exitCode === 0) {
        const { left, right } = parseLeftRight(pushLr.stdout);
        toPull = left;
        toPush = right;
      }
      shareStatus = {
        remote: shareRemote,
        ref: implicitRef,
        refMode: "implicit",
        toPush,
        toPull,
      };
      shareDivergenceRef = implicitRef;
    } else {
      // Step 3: Check if tracking config exists (→ gone) or not (→ noRef)
      const configRemote = await gitLocal(repoDir, "config", `branch.${actualBranch}.remote`);
      const isGone = configRemote.exitCode === 0 && configRemote.stdout.trim().length > 0;
      shareStatus = {
        remote: shareRemote,
        ref: null,
        refMode: isGone ? "gone" : "noRef",
        toPush: null,
        toPull: null,
      };
    }
  } else {
    // Detached — share is present but no ref comparison possible
    shareStatus = {
      remote: shareRemote,
      ref: null,
      refMode: "noRef",
      toPush: null,
      toPull: null,
    };
  }

  // ── Analysis phase (share divergence, replay plan, merge detection) ──
  // These are expensive and cacheable. Check the analysis cache first.

  const needsDivergence =
    shareStatus.toPush !== null && shareStatus.toPush > 0 && shareStatus.toPull !== null && shareStatus.toPull > 0;
  const needsReplayPlan = baseStatus !== null && compareRef !== null && baseStatus.ahead > 0 && baseStatus.behind > 0;
  const needsMergeDetection =
    shouldRunMergeDetection(baseStatus, shareStatus, detached, actualBranch) && baseStatus !== null;
  const needsAnalysis = needsDivergence || needsReplayPlan || needsMergeDetection;

  if (needsAnalysis) {
    // Resolve SHAs for cache key (base + share in parallel; HEAD already resolved above)
    const shareRefForSha = shareStatus.ref ?? "";
    const baseRefForSha = compareRef ?? "";
    const [baseShaResult, shareShaResult] = await Promise.all([
      baseRefForSha
        ? gitLocal(repoDir, "rev-parse", baseRefForSha)
        : Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
      shareRefForSha
        ? gitLocal(repoDir, "rev-parse", shareRefForSha)
        : Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    ]);
    const headSHA = fullHeadSha;
    const baseSHA = baseShaResult.exitCode === 0 ? baseShaResult.stdout.trim() : "";
    const shareSHA = shareShaResult.exitCode === 0 ? shareShaResult.stdout.trim() : "";

    const cacheKey = analysisCacheKey(repo, headSHA, baseSHA, shareSHA);
    const cached = analysisCache?.lookup(cacheKey);

    if (cached) {
      // ── Cache hit: populate from cached data ──
      if (cached.outdated) {
        shareStatus.outdated = cached.outdated;
      }
      if (baseStatus && cached.merge) {
        baseStatus.merge = cached.merge;
      }
      if (baseStatus && cached.replayPlan) {
        baseStatus.replayPlan = cached.replayPlan;
      }
    } else {
      // ── Cache miss: run expensive analysis ──

      // Share divergence detection
      if (needsDivergence && shareDivergenceRef) {
        const divergence = await detectShareDivergence(
          repoDir,
          shareDivergenceRef,
          actualBranch,
          shareStatus.toPush,
          shareStatus.toPull,
        );
        if (divergence.outdated) {
          shareStatus.outdated = divergence.outdated;
        }
      }

      // Replay plan analysis
      if (needsReplayPlan && baseStatus && compareRef) {
        const replayPlan = await analyzeReplayPlan(repoDir, compareRef);
        if (replayPlan) {
          baseStatus.replayPlan = {
            totalLocal: replayPlan.totalLocal,
            alreadyOnTarget: replayPlan.alreadyOnTarget,
            toReplay: replayPlan.toReplay,
            contiguous: replayPlan.contiguous,
            ...(replayPlan.mergedPrefix && { mergedPrefix: true }),
            ...(replayPlan.allRebaseMatched && { allRebaseMatched: true }),
          };
        }
      }

      // Merge detection
      if (needsMergeDetection && baseStatus) {
        const mergeCompareRef = baseRemote ? `${baseRemote}/${baseStatus.ref}` : baseStatus.ref;
        await runMergeDetection(repoDir, repoPath, baseStatus, shareStatus, mergeCompareRef, actualBranch, cache);
      }

      // Store in analysis cache (only if at least one analysis produced a result)
      const hasCacheableResult = baseStatus?.merge || baseStatus?.replayPlan || shareStatus.outdated;
      if (analysisCache && hasCacheableResult) {
        const entry: AnalysisCacheEntry = {
          merge: baseStatus?.merge,
          replayPlan: baseStatus?.replayPlan,
          outdated: shareStatus.outdated,
          timestamp: new Date().toISOString(),
        };
        analysisCache.store(cacheKey, entry);
      }
    }
  }

  // ── Stacked base merge detection ──
  // When configBase is set and resolved, check if the base branch itself
  // has been merged into the repo's true default branch.
  // Not cached — cheap (2-3 calls) and depends on configBase which varies per workspace.
  if (configBase && baseStatus !== null && baseRemote && !detached) {
    if (baseStatus.ref === configBase) {
      // Base branch exists on remote — use remote ref for detection
      const trueDefault = await cache.getDefaultBranch(repoPath, baseRemote);
      if (trueDefault && trueDefault !== configBase) {
        const configBaseRef = `${baseRemote}/${configBase}`;
        const defaultRef = `${baseRemote}/${trueDefault}`;
        const result = await detectBranchMerged(repoDir, defaultRef, 200, configBaseRef);
        baseStatus.baseMergedIntoDefault = result?.kind ?? null;
      }
    } else {
      // Base branch gone from remote — try local branch ref for detection.
      // Skip when the local branch is checked out in a worktree — it's likely
      // an arb workspace branch (readonly repo outside the stack), not a leftover
      // from a merged feature branch.
      const localExists = await cache.branchExistsLocally(repoPath, configBase);
      if (localExists) {
        const inWorktree = await branchIsInWorktree(repoPath, configBase);
        if (!inWorktree) {
          const defaultRef = `${baseRemote}/${baseStatus.ref}`;
          const result = await detectBranchMerged(repoDir, defaultRef, 200, configBase);
          baseStatus.baseMergedIntoDefault = result?.kind ?? null;
        }
      }
    }
  }

  return {
    name: repo,
    identity: { worktreeKind, headMode, shallow },
    local,
    base: baseStatus,
    share: shareStatus,
    operation: gitDirResult,
    headSha,
    lastCommit: null,
    lastActivity: null,
    lastActivityFile: null,
  };
}

/** Run merge detection and PR attribution. Extracted for cache miss path. */
async function runMergeDetection(
  repoDir: string,
  repoPath: string,
  baseStatus: NonNullable<RepoStatus["base"]>,
  shareStatus: RepoStatus["share"],
  compareRef: string,
  actualBranch: string,
  cache: GitCache,
): Promise<void> {
  let { shouldCheckSquash, shouldCheckPrefixes, prefixLimit } = computeMergeDetectionStrategy(baseStatus, shareStatus);

  // For never-pushed branches, enable squash detection only when the replay plan
  // confirms all local commits are already on target — avoids false positives from
  // coincidental cumulative-diff matches and interference with stacked base-merge detection.
  if (
    !shouldCheckSquash &&
    shareStatus.refMode === "noRef" &&
    baseStatus.replayPlan &&
    baseStatus.replayPlan.alreadyOnTarget === baseStatus.replayPlan.totalLocal &&
    baseStatus.replayPlan.toReplay === 0
  ) {
    shouldCheckSquash = true;
  }

  let mergeMatchingCommit: { hash: string; subject: string } | undefined;
  let mergeCommitHash: string | undefined;

  // Replay-plan merge detection: when all matched commits are 1:1 rebase
  // matches on the base, the branch is effectively merged (rebase-merge or
  // cherry-pick), possibly with new commits on top. Only fires for rebase
  // matches — squash merges are handled by Phase 2 with richer PR attribution.
  if (baseStatus.replayPlan && baseStatus.replayPlan.alreadyOnTarget > 1 && baseStatus.replayPlan.allRebaseMatched) {
    const rp = baseStatus.replayPlan;
    const merge: NonNullable<typeof baseStatus.merge> = { kind: "merge" };
    if (rp.toReplay > 0) {
      merge.newCommitsAfter = rp.toReplay;
    }
    const afterRef = rp.toReplay > 0 ? `HEAD~${rp.toReplay}` : "HEAD";
    const mc = await findMergeCommitForBranch(repoDir, compareRef, actualBranch, 50, afterRef);
    if (mc) {
      mergeMatchingCommit = mc;
      mergeCommitHash = mc.hash;
      merge.commitHash = mc.hash;
    }
    baseStatus.merge = merge;
    if (!mergeMatchingCommit || !extractPrNumber(mergeMatchingCommit.subject)) {
      const ticket = detectTicketFromName(actualBranch);
      if (ticket) {
        const ticketCommit = await findTicketReferencedCommit(repoDir, ticket);
        if (ticketCommit) mergeMatchingCommit = ticketCommit;
      }
    }
  }

  if (!baseStatus.merge) {
    type MergeInfo = NonNullable<(typeof baseStatus)["merge"]>;

    // Phase 1: Ancestor check (instant) — detects merge commits and fast-forwards
    const ancestorResult = await gitLocal(repoDir, "merge-base", "--is-ancestor", "HEAD", compareRef);
    if (ancestorResult.exitCode === 0) {
      const merge: MergeInfo = { kind: "merge" };
      const mergeCommit = await findMergeCommitForBranch(repoDir, compareRef, actualBranch, 50, "HEAD");
      if (mergeCommit) {
        mergeMatchingCommit = mergeCommit;
        mergeCommitHash = mergeCommit.hash;
        merge.commitHash = mergeCommit.hash;
      }
      baseStatus.merge = merge;
      if (!mergeMatchingCommit || !extractPrNumber(mergeMatchingCommit.subject)) {
        const ticket = detectTicketFromName(actualBranch);
        if (ticket) {
          const ticketCommit = await findTicketReferencedCommit(repoDir, ticket);
          if (ticketCommit) mergeMatchingCommit = ticketCommit;
        }
      }
    } else if (shouldCheckSquash || shouldCheckPrefixes) {
      // Phase 2: Squash merge detection via cumulative patch-id (with prefix fallback)
      let squashResult = await detectBranchMerged(
        repoDir,
        compareRef,
        200,
        "HEAD",
        prefixLimit,
        cache.basePatchIdCache,
      );

      // Guard: after `reset --hard <base>` + `git pull`, the merge commit's first parent
      // is the base tip. The prefix loop finds HEAD~k is-ancestor of base, but the feature
      // was never merged into base — it's a local pull-merge.
      if (squashResult?.newCommitsAfterMerge != null && squashResult.kind === "merge" && shareStatus.ref) {
        const n = squashResult.newCommitsAfterMerge;
        const [prefixHash, baseHash] = await Promise.all([
          gitLocal(repoDir, "rev-parse", `HEAD~${n}`),
          gitLocal(repoDir, "rev-parse", compareRef),
        ]);
        if (
          prefixHash.exitCode === 0 &&
          baseHash.exitCode === 0 &&
          prefixHash.stdout.trim() === baseHash.stdout.trim()
        ) {
          const shareAheadResult = await gitLocal(repoDir, "rev-list", "--count", `${compareRef}..${shareStatus.ref}`);
          if (shareAheadResult.exitCode === 0 && Number.parseInt(shareAheadResult.stdout.trim(), 10) > 0) {
            squashResult = null;
          }
        }
      }

      if (squashResult) {
        const merge: MergeInfo = { kind: squashResult.kind };
        if (squashResult.newCommitsAfterMerge) {
          merge.newCommitsAfter = squashResult.newCommitsAfterMerge;
        }
        if (squashResult.matchingCommit) {
          mergeMatchingCommit = squashResult.matchingCommit;
          merge.commitHash = squashResult.matchingCommit.hash;
        } else if (squashResult.kind === "merge" && squashResult.newCommitsAfterMerge) {
          const n = squashResult.newCommitsAfterMerge;
          const mc = await findMergeCommitForBranch(repoDir, compareRef, actualBranch, 50, `HEAD~${n}`);
          if (mc) {
            mergeMatchingCommit = mc;
            mergeCommitHash = mc.hash;
            merge.commitHash = mc.hash;
          }
        }
        baseStatus.merge = merge;
        if (!mergeMatchingCommit || !extractPrNumber(mergeMatchingCommit.subject)) {
          const ticket = detectTicketFromName(actualBranch);
          if (ticket) {
            const ticketCommit = await findTicketReferencedCommit(repoDir, ticket);
            if (ticketCommit) mergeMatchingCommit = ticketCommit;
          }
        }
      }
    }
  }

  // Extract PR number from matching commit subject
  if (baseStatus.merge && mergeMatchingCommit) {
    const prNumber = extractPrNumber(mergeMatchingCommit.subject);
    if (prNumber) {
      let prUrl: string | null = null;
      const shareRemote = shareStatus.remote;
      const remoteUrl = await cache.getRemoteUrl(repoPath, shareRemote);
      if (remoteUrl) {
        const parsed = parseRemoteUrl(remoteUrl);
        if (parsed) prUrl = buildPrUrl(parsed, prNumber);
      }
      baseStatus.merge.detectedPr = { number: prNumber, url: prUrl, mergeCommit: mergeCommitHash };
    }
  }
}

/** Lightweight ref-topology gather — resolves identity, base ref, and share ref
 * without running expensive rev-list, merge detection, or divergence analysis. */
export async function gatherRepoRefs(
  repoDir: string,
  reposDir: string,
  configBase: string | null,
  remotes: RepoRemotes | undefined,
  cache: GitCache,
): Promise<RepoRefs> {
  const repo = basename(repoDir);
  const repoPath = `${reposDir}/${repo}`;

  // Identity: resolve HEAD branch
  const branchResult = await gitLocal(repoDir, "symbolic-ref", "--short", "HEAD");
  const actualBranch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : "";
  const detached = actualBranch === "";
  const headMode: RepoRefs["identity"]["headMode"] = detached
    ? { kind: "detached" }
    : { kind: "attached", branch: actualBranch };

  const resolvedRemotes = remotes ?? (await cache.resolveRemotes(repoPath));
  const baseRemote = resolvedRemotes.base;
  const shareRemote = resolvedRemotes.share;

  // Base: resolve ref identity only (no ahead/behind counts)
  let baseRefs: RepoRefs["base"] = null;
  if (!detached) {
    let defaultBranch: string | null = null;
    let fellBack = false;
    if (configBase) {
      const baseExists = await cache.remoteBranchExists(repoPath, configBase, baseRemote);
      if (baseExists) defaultBranch = configBase;
    }
    if (!defaultBranch && baseRemote) {
      defaultBranch = await cache.getDefaultBranch(repoPath, baseRemote);
      if (configBase && defaultBranch) fellBack = true;
    }
    if (defaultBranch) {
      baseRefs = {
        remote: baseRemote ?? null,
        ref: defaultBranch,
        configuredRef: fellBack ? configBase : null,
      };
    }
  }

  // Share: resolve ref and refMode only (no push/pull counts, no divergence)
  let shareRefs: RepoRefs["share"];
  if (!detached) {
    const upstreamResult = await gitLocal(repoDir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
    if (upstreamResult.exitCode === 0) {
      shareRefs = { remote: shareRemote, ref: upstreamResult.stdout.trim(), refMode: "configured" };
    } else if (await cache.remoteBranchExists(repoPath, actualBranch, shareRemote)) {
      shareRefs = { remote: shareRemote, ref: `${shareRemote}/${actualBranch}`, refMode: "implicit" };
    } else {
      const configRemote = await gitLocal(repoDir, "config", `branch.${actualBranch}.remote`);
      const isGone = configRemote.exitCode === 0 && configRemote.stdout.trim().length > 0;
      shareRefs = { remote: shareRemote, ref: null, refMode: isGone ? "gone" : "noRef" };
    }
  } else {
    shareRefs = { remote: shareRemote, ref: null, refMode: "noRef" };
  }

  return { name: repo, identity: { headMode }, base: baseRefs, share: shareRefs };
}

export async function gatherWorkspaceSummary(
  wsDir: string,
  reposDir: string,
  onProgress: ((scanned: number, total: number) => void) | undefined,
  cache: GitCache,
  options?: {
    gatherActivity?: boolean;
    previousResults?: Map<string, RepoStatus>;
    analysisCache?: AnalysisCache;
    repoFilter?: Set<string>;
  },
): Promise<WorkspaceSummary> {
  const workspace = basename(wsDir);
  const wb = await workspaceBranch(wsDir);
  const branch = wb?.branch ?? workspace.toLowerCase();
  const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;
  let repoDirs = workspaceRepoDirs(wsDir);
  if (options?.repoFilter) {
    repoDirs = repoDirs.filter((d) => options.repoFilter?.has(basename(d)));
  }
  let scanned = 0;

  const repoResults = await Promise.all(
    repoDirs.map(async (repoDir) => {
      const repo = basename(repoDir);
      const canonicalPath = `${reposDir}/${repo}`;

      // Reuse previous scan result when the caller knows the repo is unchanged (e.g. fetch was a no-op).
      const previous = options?.previousResults?.get(repo);
      if (previous) {
        const [commitDate, activityDate] = await Promise.all([
          getHeadCommitDate(repoDir),
          options?.gatherActivity ? getRepoActivityDate(repoDir) : Promise.resolve(null),
        ]);
        scanned++;
        onProgress?.(scanned, repoDirs.length);
        return { status: previous, commitDate, activityDate };
      }

      const remotes = await cache.resolveRemotes(canonicalPath);

      const [status, commitDate, activityDate] = await Promise.all([
        gatherRepoStatus(repoDir, reposDir, configBase, remotes, cache, options?.analysisCache),
        getHeadCommitDate(repoDir),
        options?.gatherActivity ? getRepoActivityDate(repoDir) : Promise.resolve(null),
      ]);
      scanned++;
      onProgress?.(scanned, repoDirs.length);
      return { status, commitDate, activityDate };
    }),
  );

  const repos = repoResults.map((r) => {
    r.status.lastCommit = r.commitDate;
    r.status.lastActivity = r.activityDate?.date ?? null;
    r.status.lastActivityFile = r.activityDate?.file ?? null;
    return r.status;
  });

  const { atRiskCount, outdatedOnlyCount, statusCounts } = computeSummaryAggregates(repos, branch);

  const lastCommit = latestCommitDate(repoResults.map((r) => r.commitDate));

  // Workspace-level activity: max of per-repo activity + non-repo workspace items (Phase A)
  // Also take lastCommit as a lower bound — a fresh commit always marks the workspace as active.
  let lastActivity: string | null = null;
  let lastActivityFile: string | null = null;
  if (options?.gatherActivity) {
    const filesResult = await getWorkspaceActivityDate(wsDir, repoDirs);
    const filesDate = filesResult?.date ?? null;
    lastActivity = latestCommitDate([filesDate, lastCommit]);
    // If the file-based date won (or tied), record the file. If lastCommit won, file is null.
    if (filesResult && lastActivity === filesDate) {
      lastActivityFile = filesResult.file;
    }
  }

  return {
    workspace,
    branch,
    base: configBase,
    repos,
    total: repos.length,
    atRiskCount,
    outdatedOnlyCount,
    statusCounts,
    lastCommit,
    lastActivity,
    lastActivityFile,
  };
}
