import { basename } from "node:path";
import { readWorkspaceConfig } from "../core/config";
import { latestCommitDate } from "../core/time";
import {
  branchExistsLocally,
  branchIsInWorktree,
  detectOperation,
  getHeadCommitDate,
  git,
  isLinkedWorktree,
  isShallowRepo,
  parseGitStatus,
  remoteBranchExists,
} from "../git/git";
import type { GitCache } from "../git/git-cache";
import { detectBranchMerged, findMergeCommitForBranch, findTicketReferencedCommit } from "../git/merge-detection";
import {
  analyzeReplayPlan,
  detectRebasedCommits,
  detectReplacedCommits,
  detectSquashedCommits,
} from "../git/rebase-analysis";
import { buildPrUrl, parseRemoteUrl } from "../git/remote-url";
import type { RepoRemotes } from "../git/remotes";
import { getRepoActivityDate, getWorkspaceActivityDate } from "../workspace/activity";
import { workspaceBranch } from "../workspace/branch";
import { workspaceRepoDirs } from "../workspace/repos";
import { computeSummaryAggregates } from "./flags";
import { extractPrNumber } from "./pr-detection";
import { detectTicketFromName } from "./ticket-detection";
import type { RepoStatus, WorkspaceSummary } from "./types";

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

// ── Status Gathering ──

export async function gatherRepoStatus(
  repoDir: string,
  reposDir: string,
  configBase: string | null,
  remotes: RepoRemotes | undefined,
  cache: GitCache,
): Promise<RepoStatus> {
  const repo = basename(repoDir);
  const repoPath = `${reposDir}/${repo}`;

  // ── Section 1: Identity ──

  // Worktree kind check
  const worktreeKind: "full" | "linked" = isLinkedWorktree(repoDir) ? "linked" : "full";

  // Parallel group: branch, porcelain status, shallow check, git-dir for operations
  const [branchResult, local, shallow, gitDirResult] = await Promise.all([
    git(repoDir, "symbolic-ref", "--short", "HEAD"),
    parseGitStatus(repoDir),
    isShallowRepo(repoDir),
    detectOperation(repoDir),
  ]);

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
      const baseExists = await remoteBranchExists(repoPath, configBase, baseRemote);
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
      const lr = await git(repoDir, "rev-list", "--left-right", "--count", `${compareRef}...HEAD`);
      if (lr.exitCode === 0) {
        const { left: behind, right: ahead } = parseLeftRight(lr.stdout);
        baseStatus = {
          remote: baseRemote ?? null,
          ref: defaultBranch,
          configuredRef: fellBack ? configBase : null,
          ahead,
          behind,
          mergedIntoBase: null,
          baseMergedIntoDefault: null,
          detectedPr: null,
        };
      }
    }
  }

  // ── Section 4: Share (push/pull status vs share remote) ──

  let shareStatus: RepoStatus["share"];
  if (!detached) {
    // Step 1: Try configured tracking branch
    const upstreamResult = await git(repoDir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
    if (upstreamResult.exitCode === 0) {
      const trackingRef = upstreamResult.stdout.trim();
      // refMode = configured
      const pushLr = await git(repoDir, "rev-list", "--left-right", "--count", `${trackingRef}...HEAD`);
      let toPush: number | null = null;
      let toPull: number | null = null;
      if (pushLr.exitCode === 0) {
        const { left, right } = parseLeftRight(pushLr.stdout);
        toPull = left;
        toPush = right;
      }
      let rebased: number | null = null;
      let replaced: number | null = null;
      let squashed: number | null = null;
      if (toPush !== null && toPush > 0 && toPull !== null && toPull > 0) {
        const rebasedResult = await detectRebasedCommits(repoDir, trackingRef);
        rebased = rebasedResult?.count ?? null;
        const unmatchedPull = toPull - (rebased ?? 0);
        if (unmatchedPull > 0) {
          const rebasedRemoteHashes = rebasedResult?.rebasedRemoteHashes ?? new Set<string>();
          const replacedResult = await detectReplacedCommits(repoDir, trackingRef, actualBranch, rebasedRemoteHashes);
          replaced = replacedResult?.count ?? null;
        }
        const unmatchedAfterReplace = toPull - (rebased ?? 0) - (replaced ?? 0);
        if (unmatchedAfterReplace > 0) {
          const squashedResult = await detectSquashedCommits(repoDir, trackingRef, toPull);
          squashed = squashedResult?.count ?? null;
        }
      }
      shareStatus = {
        remote: shareRemote,
        ref: trackingRef,
        refMode: "configured",
        toPush,
        toPull,
        rebased,
        replaced,
        squashed,
      };
    } else if (await remoteBranchExists(repoDir, actualBranch, shareRemote)) {
      // Step 2: No tracking config but remote ref exists → implicit
      const implicitRef = `${shareRemote}/${actualBranch}`;
      const pushLr = await git(repoDir, "rev-list", "--left-right", "--count", `${implicitRef}...HEAD`);
      let toPush: number | null = null;
      let toPull: number | null = null;
      if (pushLr.exitCode === 0) {
        const { left, right } = parseLeftRight(pushLr.stdout);
        toPull = left;
        toPush = right;
      }
      let rebased: number | null = null;
      let replaced: number | null = null;
      let squashed: number | null = null;
      if (toPush !== null && toPush > 0 && toPull !== null && toPull > 0) {
        const rebasedResult = await detectRebasedCommits(repoDir, implicitRef);
        rebased = rebasedResult?.count ?? null;
        const unmatchedPull = toPull - (rebased ?? 0);
        if (unmatchedPull > 0) {
          const rebasedRemoteHashes = rebasedResult?.rebasedRemoteHashes ?? new Set<string>();
          const replacedResult = await detectReplacedCommits(repoDir, implicitRef, actualBranch, rebasedRemoteHashes);
          replaced = replacedResult?.count ?? null;
        }
        const unmatchedAfterReplace = toPull - (rebased ?? 0) - (replaced ?? 0);
        if (unmatchedAfterReplace > 0) {
          const squashedResult = await detectSquashedCommits(repoDir, implicitRef, toPull);
          squashed = squashedResult?.count ?? null;
        }
      }
      shareStatus = {
        remote: shareRemote,
        ref: implicitRef,
        refMode: "implicit",
        toPush,
        toPull,
        rebased,
        replaced,
        squashed,
      };
    } else {
      // Step 3: Check if tracking config exists (→ gone) or not (→ noRef)
      const configRemote = await git(repoDir, "config", `branch.${actualBranch}.remote`);
      const isGone = configRemote.exitCode === 0 && configRemote.stdout.trim().length > 0;
      shareStatus = {
        remote: shareRemote,
        ref: null,
        refMode: isGone ? "gone" : "noRef",
        toPush: null,
        toPull: null,
        rebased: null,
        replaced: null,
        squashed: null,
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
      rebased: null,
      replaced: null,
      squashed: null,
    };
  }

  // Analyze replay-only rebase opportunities for diverged branches.
  if (baseStatus && compareRef && baseStatus.ahead > 0 && baseStatus.behind > 0) {
    const replayPlan = await analyzeReplayPlan(repoDir, compareRef);
    if (replayPlan) {
      baseStatus.replayPlan = {
        totalLocal: replayPlan.totalLocal,
        alreadyOnTarget: replayPlan.alreadyOnTarget,
        toReplay: replayPlan.toReplay,
        contiguous: replayPlan.contiguous,
      };
    }
  }

  // ── Merge detection ──
  // Run when there's divergence from base (ahead/behind > 0), OR when the remote branch is
  // gone (catches fast-forward merges where ahead=0, behind=0 after the branch was deleted).
  // Skip when on the base branch itself (base-is-share scenario, e.g. main tracking origin/main).
  // Skip when branch was never pushed and has no unique commits — the ancestor check would
  // trivially pass (HEAD is always an ancestor of a ref ahead of it with no diverging commits).
  // Ancestor check is cheap (single git command), always run when eligible.
  // Squash check is more expensive — only run when branch is gone OR share is up to date.
  let mergeMatchingCommit: { hash: string; subject: string } | undefined;
  if (shouldRunMergeDetection(baseStatus, shareStatus, detached, actualBranch) && baseStatus !== null) {
    const compareRef = baseRemote ? `${baseRemote}/${baseStatus.ref}` : baseStatus.ref;
    const { shouldCheckSquash, shouldCheckPrefixes, prefixLimit } = computeMergeDetectionStrategy(
      baseStatus,
      shareStatus,
    );

    // Phase 1: Ancestor check (instant) — detects merge commits and fast-forwards
    let mergeCommitHash: string | undefined;
    const ancestorResult = await git(repoDir, "merge-base", "--is-ancestor", "HEAD", compareRef);
    if (ancestorResult.exitCode === 0) {
      baseStatus.mergedIntoBase = "merge";
      // Try to find the merge commit that references this branch for PR attribution
      const mergeCommit = await findMergeCommitForBranch(repoDir, compareRef, actualBranch, 50, "HEAD");
      if (mergeCommit) {
        mergeMatchingCommit = mergeCommit;
        mergeCommitHash = mergeCommit.hash;
        baseStatus.mergeCommitHash = mergeCommit.hash;
      }
      // Ticket fallback: if no merge commit found, or merge commit doesn't yield a PR number
      if (!mergeMatchingCommit || !extractPrNumber(mergeMatchingCommit.subject)) {
        const ticket = detectTicketFromName(actualBranch);
        if (ticket) {
          const ticketCommit = await findTicketReferencedCommit(repoDir, ticket);
          if (ticketCommit) mergeMatchingCommit = ticketCommit;
        }
      }
    } else if (shouldCheckSquash || shouldCheckPrefixes) {
      // Phase 2: Squash merge detection via cumulative patch-id (with prefix fallback)
      let squashResult = await detectBranchMerged(repoDir, compareRef, 200, "HEAD", prefixLimit);

      // Guard: after `reset --hard <base>` + `git pull`, the merge commit's first parent
      // is the base tip. The prefix loop finds HEAD~k is-ancestor of base, but the feature
      // was never merged into base — it's a local pull-merge.
      if (squashResult?.newCommitsAfterMerge != null && squashResult.kind === "merge" && shareStatus.ref) {
        const n = squashResult.newCommitsAfterMerge;
        const [prefixHash, baseHash] = await Promise.all([
          git(repoDir, "rev-parse", `HEAD~${n}`),
          git(repoDir, "rev-parse", compareRef),
        ]);
        if (
          prefixHash.exitCode === 0 &&
          baseHash.exitCode === 0 &&
          prefixHash.stdout.trim() === baseHash.stdout.trim()
        ) {
          // HEAD~k is literally the base tip. Check if share has content not in base.
          const shareAheadResult = await git(repoDir, "rev-list", "--count", `${compareRef}..${shareStatus.ref}`);
          if (shareAheadResult.exitCode === 0 && Number.parseInt(shareAheadResult.stdout.trim(), 10) > 0) {
            squashResult = null;
          }
        }
      }

      if (squashResult) {
        baseStatus.mergedIntoBase = squashResult.kind;
        if (squashResult.newCommitsAfterMerge) {
          baseStatus.newCommitsAfterMerge = squashResult.newCommitsAfterMerge;
        }
        if (squashResult.matchingCommit) {
          mergeMatchingCommit = squashResult.matchingCommit;
          baseStatus.mergeCommitHash = squashResult.matchingCommit.hash;
        } else if (squashResult.kind === "merge" && squashResult.newCommitsAfterMerge) {
          // Regular merge detected via prefix — find the merge commit for attribution
          const n = squashResult.newCommitsAfterMerge;
          const mc = await findMergeCommitForBranch(repoDir, compareRef, actualBranch, 50, `HEAD~${n}`);
          if (mc) {
            mergeMatchingCommit = mc;
            mergeCommitHash = mc.hash;
            baseStatus.mergeCommitHash = mc.hash;
          }
        }
        // Ticket fallback: if squash commit doesn't yield a PR number
        if (!mergeMatchingCommit || !extractPrNumber(mergeMatchingCommit.subject)) {
          const ticket = detectTicketFromName(actualBranch);
          if (ticket) {
            const ticketCommit = await findTicketReferencedCommit(repoDir, ticket);
            if (ticketCommit) mergeMatchingCommit = ticketCommit;
          }
        }
      }
    }

    // Extract PR number from matching commit subject
    if (baseStatus.mergedIntoBase && mergeMatchingCommit) {
      const prNumber = extractPrNumber(mergeMatchingCommit.subject);
      if (prNumber) {
        // Try to construct a PR URL from the share remote URL
        let prUrl: string | null = null;
        const remoteUrl = await cache.getRemoteUrl(repoPath, shareRemote);
        if (remoteUrl) {
          const parsed = parseRemoteUrl(remoteUrl);
          if (parsed) prUrl = buildPrUrl(parsed, prNumber);
        }
        baseStatus.detectedPr = { number: prNumber, url: prUrl, mergeCommit: mergeCommitHash };
      }
    }
  }

  // ── Stacked base merge detection ──
  // When configBase is set and resolved, check if the base branch itself
  // has been merged into the repo's true default branch.
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
      const localExists = await branchExistsLocally(repoPath, configBase);
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
    lastCommit: null,
    lastActivity: null,
    lastActivityFile: null,
  };
}

export async function gatherWorkspaceSummary(
  wsDir: string,
  reposDir: string,
  onProgress: ((scanned: number, total: number) => void) | undefined,
  cache: GitCache,
  options?: { gatherActivity?: boolean; previousResults?: Map<string, RepoStatus> },
): Promise<WorkspaceSummary> {
  const workspace = basename(wsDir);
  const wb = await workspaceBranch(wsDir);
  const branch = wb?.branch ?? workspace.toLowerCase();
  const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;
  const repoDirs = workspaceRepoDirs(wsDir);
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
        gatherRepoStatus(repoDir, reposDir, configBase, remotes, cache),
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

  const { atRiskCount, rebasedOnlyCount, statusLabels, statusCounts } = computeSummaryAggregates(repos, branch);

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
    rebasedOnlyCount,
    statusLabels,
    statusCounts,
    lastCommit,
    lastActivity,
    lastActivityFile,
  };
}
