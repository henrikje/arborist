import { gitLocal } from "../git/git";
import type { BasePatchIdCache } from "../git/git-cache";
import { computeCumulativePatchId, computeDiffTreePatchId, computePatchIds, computeRecentPatchIds } from "./patch-id";

export interface MergeDetectionResult {
  kind: "merge" | "squash";
  /** The commit on the base branch that represents the merge/squash. */
  matchingCommit?: { hash: string; subject: string };
  /** Number of new commits on top of the merged branch (0 or undefined = exact match). */
  newCommitsAfterMerge?: number;
}

/** Check if a branch range matches a squash commit on the base via cumulative patch-id. */
async function checkSquashMatch(
  repoDir: string,
  baseBranchRef: string,
  branchRef: string,
  commitLimit: number,
  basePatchIdMap?: Map<string, string>,
): Promise<MergeDetectionResult | null> {
  const mergeBaseResult = await gitLocal(repoDir, "merge-base", branchRef, baseBranchRef);
  if (mergeBaseResult.exitCode !== 0) return null;
  const mergeBase = mergeBaseResult.stdout.trim();
  if (!mergeBase) return null;

  // Cumulative patch-id for the entire branch range
  const cumulativePatchId = await computeCumulativePatchId(repoDir, mergeBase, branchRef);
  if (!cumulativePatchId) return null;

  // Per-commit patch-ids for recent base commits (use shared map when available)
  const perCommitMap = basePatchIdMap ?? (await computePatchIds(repoDir, mergeBase, baseBranchRef, commitLimit));
  if (!perCommitMap) return null;

  for (const [patchId, commitHash] of perCommitMap) {
    if (patchId === cumulativePatchId) {
      // Retrieve the commit subject for PR number extraction
      const subjectResult = await gitLocal(repoDir, "log", "-1", "--format=%s", commitHash);
      const subject = subjectResult.exitCode === 0 ? subjectResult.stdout.trim() : "";
      return { kind: "squash", matchingCommit: { hash: commitHash, subject } };
    }
  }

  return null;
}

export async function detectBranchMerged(
  repoDir: string,
  baseBranchRef: string,
  commitLimit = 200,
  branchRef = "HEAD",
  prefixLimit = 0,
  basePatchIdCache?: BasePatchIdCache,
): Promise<MergeDetectionResult | null> {
  // Phase 1: Ancestor check (instant) — detects merge commits and fast-forwards
  const ancestor = await gitLocal(repoDir, "merge-base", "--is-ancestor", branchRef, baseBranchRef);
  if (ancestor.exitCode === 0) {
    // Guard: if both refs resolve to the same commit, the branch hasn't diverged —
    // it's "equal" to the base, not "merged" into it. This avoids false positives
    // for branches that were created from the base but never had unique commits.
    const [branchSha, baseSha] = await Promise.all([
      gitLocal(repoDir, "rev-parse", branchRef),
      gitLocal(repoDir, "rev-parse", baseBranchRef),
    ]);
    if (branchSha.exitCode === 0 && baseSha.exitCode === 0 && branchSha.stdout.trim() === baseSha.stdout.trim()) {
      return null;
    }
    return { kind: "merge" };
  }

  // Resolve base branch patch-id map (shared across Phase 2 + Phase 3, and across workspaces)
  const basePatchIdMap = await resolveBasePatchIdMap(repoDir, baseBranchRef, commitLimit, basePatchIdCache);

  // Phase 2: Squash check on full range
  const squashResult = await checkSquashMatch(repoDir, baseBranchRef, branchRef, commitLimit, basePatchIdMap);
  if (squashResult) return squashResult;

  // Phase 3: Prefix loop — check HEAD~1, HEAD~2, ..., HEAD~prefixLimit
  // Detects branches that were merged but have new commits on top.
  for (let k = 1; k <= prefixLimit; k++) {
    const prefixRef = `${branchRef}~${k}`;
    // Validate the prefix ref resolves
    const verifyResult = await gitLocal(repoDir, "rev-parse", "--verify", prefixRef);
    if (verifyResult.exitCode !== 0) break;

    // Phase 1 on prefix: ancestor check
    const prefixAncestor = await gitLocal(repoDir, "merge-base", "--is-ancestor", prefixRef, baseBranchRef);
    if (prefixAncestor.exitCode === 0) {
      return { kind: "merge", newCommitsAfterMerge: k };
    }

    // Phase 2 on prefix: squash check
    const prefixSquash = await checkSquashMatch(repoDir, baseBranchRef, prefixRef, commitLimit, basePatchIdMap);
    if (prefixSquash) {
      return { ...prefixSquash, newCommitsAfterMerge: k };
    }
  }

  return null;
}

/**
 * Resolve the per-commit patch-id map for a base branch, using the cache when available.
 * The map covers the most recent `commitLimit` commits from the base branch tip.
 */
async function resolveBasePatchIdMap(
  repoDir: string,
  baseBranchRef: string,
  commitLimit: number,
  cache?: BasePatchIdCache,
): Promise<Map<string, string> | undefined> {
  // Resolve the base branch to a SHA for a stable cache key
  const revParseResult = await gitLocal(repoDir, "rev-parse", baseBranchRef);
  if (revParseResult.exitCode !== 0) return undefined;
  const baseSHA = revParseResult.stdout.trim();
  if (!baseSHA) return undefined;

  // Cache hit — return shared map
  if (cache) {
    const cached = cache.get(baseSHA);
    if (cached) return cached;
  }

  // Cache miss — compute from the base branch tip (no from-ref, covers all callers' ranges)
  const map = await computeRecentPatchIds(repoDir, baseBranchRef, commitLimit);
  if (!map) return undefined;

  // Store in cache for reuse
  cache?.set(baseSHA, map);
  return map;
}

/**
 * Scan recent merge commits on the base branch to find one that references the given branch name.
 * Used to attribute regular merge commits (not squash) to a specific PR.
 *
 * Two strategies (single git log pass):
 * 1. Branch-name match: subject contains the branch name (preferred, returns immediately)
 * 2. Parentage match: afterRef appears as a non-first parent of a merge commit
 *    (fallback for --no-ff merges with edited/generic subjects)
 */
export async function findMergeCommitForBranch(
  repoDir: string,
  baseBranchRef: string,
  branchName: string,
  commitLimit = 50,
  afterRef?: string,
): Promise<{ hash: string; subject: string } | null> {
  // Resolve afterRef to a full hash for parentage comparison
  let resolvedAfterRef: string | undefined;
  if (afterRef) {
    const revParse = await gitLocal(repoDir, "rev-parse", afterRef);
    if (revParse.exitCode === 0) resolvedAfterRef = revParse.stdout.trim();
  }

  const range = afterRef ? `${afterRef}..${baseBranchRef}` : baseBranchRef;
  const result = await gitLocal(
    repoDir,
    "log",
    "--merges",
    "--format=%H %P%x09%s",
    `--max-count=${commitLimit}`,
    range,
  );
  if (result.exitCode !== 0) return null;

  let parentageMatch: { hash: string; subject: string } | null = null;

  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const tabIdx = line.indexOf("\t");
    if (tabIdx < 0) continue;
    const hashAndParents = line.slice(0, tabIdx).split(" ");
    const hash = hashAndParents[0];
    if (!hash) continue;
    const subject = line.slice(tabIdx + 1);

    // Strategy 1: branch-name match (immediate return)
    if (subject.includes(branchName)) {
      return { hash, subject };
    }

    // Strategy 2: parentage match (remember first hit, continue looking for name match)
    if (resolvedAfterRef && !parentageMatch) {
      const nonFirstParents = hashAndParents.slice(2); // skip commit hash and first parent
      if (nonFirstParents.includes(resolvedAfterRef)) {
        parentageMatch = { hash, subject };
      }
    }
  }

  return parentageMatch;
}

/**
 * Search recent commits reachable from HEAD for ones whose message (subject or body)
 * references the given ticket key. Returns the most recent match's hash and subject.
 *
 * Used as a fallback when findMergeCommitForBranch() returns null — e.g. when
 * individual commits were merged via separate PRs instead of a single branch merge.
 */
export async function findTicketReferencedCommit(
  repoDir: string,
  ticketKey: string,
  commitLimit = 100,
): Promise<{ hash: string; subject: string } | null> {
  const result = await gitLocal(
    repoDir,
    "log",
    "--format=%H %s",
    `--grep=${ticketKey}`,
    "-i",
    `--max-count=${commitLimit}`,
    "HEAD",
  );
  if (result.exitCode !== 0) return null;

  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const spaceIdx = line.indexOf(" ");
    if (spaceIdx < 0) continue;
    const hash = line.slice(0, spaceIdx);
    const subject = line.slice(spaceIdx + 1);
    return { hash, subject };
  }
  return null;
}

/**
 * Verify that a squash commit on the base covers exactly the already-merged local commits.
 * Compares cumulative patch-id of local commits (excluding new ones) against the squash commit's patch-id.
 */
export async function verifySquashRange(
  repoDir: string,
  baseBranchRef: string,
  squashHash: string,
  newCommitsAfterMerge: number,
): Promise<boolean> {
  try {
    const localRef = `HEAD~${newCommitsAfterMerge}`;
    const mergeBaseResult = await gitLocal(repoDir, "merge-base", localRef, baseBranchRef);
    if (mergeBaseResult.exitCode !== 0) return false;
    const mergeBase = mergeBaseResult.stdout.trim();
    if (!mergeBase) return false;

    const [cumulativePatchId, squashPatchId] = await Promise.all([
      computeCumulativePatchId(repoDir, mergeBase, localRef),
      computeDiffTreePatchId(repoDir, squashHash),
    ]);

    if (!cumulativePatchId || !squashPatchId) return false;

    return cumulativePatchId === squashPatchId;
  } catch {
    return false;
  }
}
