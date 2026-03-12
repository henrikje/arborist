import { getCommitsBetweenFull } from "../git/git";
import { matchDivergedCommits } from "./commit-matching";
import { detectBranchMerged } from "./merge-detection";
import { computePatchIds } from "./patch-id";

export interface ReplayPlanAnalysis {
  totalLocal: number;
  alreadyOnTarget: number;
  toReplay: number;
  contiguous: boolean;
  boundaryRef?: string;
  /** True when alreadyOnTarget was determined via detectBranchMerged heuristic, not patch-id matching. */
  mergedPrefix?: boolean;
}

/**
 * Analyze which local commits still need replay onto the target base.
 * Contiguous=true means already-on-target commits are an older prefix and replay commits are a top suffix.
 */
export async function analyzeReplayPlan(repoDir: string, baseRef: string): Promise<ReplayPlanAnalysis | null> {
  const localCommits = await getCommitsBetweenFull(repoDir, baseRef, "HEAD");
  const totalLocal = localCommits.length;
  if (totalLocal === 0) {
    return { totalLocal: 0, alreadyOnTarget: 0, toReplay: 0, contiguous: true };
  }

  const matchResult = await matchDivergedCommits(repoDir, baseRef);
  const matchedLocal = new Set<string>(matchResult.rebaseMatches.values());
  if (matchResult.squashMatch) {
    for (const hash of matchResult.squashMatch.localHashes) matchedLocal.add(hash);
  }

  // Fallback: detect merged prefix when new commits sit on top of already-merged work.
  if (matchedLocal.size === 0 && totalLocal > 1) {
    const prefixLimit = Math.min(totalLocal - 1, 10);
    const merged = await detectBranchMerged(repoDir, baseRef, 200, "HEAD", prefixLimit);
    if (merged?.newCommitsAfterMerge && merged.newCommitsAfterMerge > 0 && merged.newCommitsAfterMerge <= totalLocal) {
      const toReplay = merged.newCommitsAfterMerge;
      const alreadyOnTarget = totalLocal - toReplay;
      return {
        totalLocal,
        alreadyOnTarget,
        toReplay,
        contiguous: true,
        boundaryRef: `HEAD~${toReplay}`,
        mergedPrefix: true,
      };
    }
  }

  const localOldestToNewest = [...localCommits].reverse().map((c) => c.fullHash);
  const firstUnmatched = localOldestToNewest.findIndex((hash) => !matchedLocal.has(hash));

  if (firstUnmatched === -1) {
    return {
      totalLocal,
      alreadyOnTarget: totalLocal,
      toReplay: 0,
      contiguous: true,
    };
  }

  const hasMatchedAfterBoundary = localOldestToNewest.slice(firstUnmatched + 1).some((hash) => matchedLocal.has(hash));
  if (hasMatchedAfterBoundary) {
    const alreadyOnTarget = [...localOldestToNewest].filter((hash) => matchedLocal.has(hash)).length;
    return {
      totalLocal,
      alreadyOnTarget,
      toReplay: Math.max(0, totalLocal - alreadyOnTarget),
      contiguous: false,
    };
  }

  const toReplay = totalLocal - firstUnmatched;
  return {
    totalLocal,
    alreadyOnTarget: firstUnmatched,
    toReplay,
    contiguous: true,
    ...(toReplay > 0 ? { boundaryRef: `HEAD~${toReplay}` } : {}),
  };
}

export async function analyzeRetargetReplay(
  repoDir: string,
  oldBaseRef: string,
  newBaseRef: string,
): Promise<{ totalLocal: number; alreadyOnTarget: number; toReplay: number } | null> {
  const [localMap, newBaseMap] = await Promise.all([
    computePatchIds(repoDir, oldBaseRef, "HEAD"),
    computePatchIds(repoDir, oldBaseRef, newBaseRef),
  ]);

  if (!localMap || !newBaseMap) return null;

  const newBaseIds = new Set(newBaseMap.keys());

  let alreadyOnTarget = 0;
  for (const patchId of localMap.keys()) {
    if (newBaseIds.has(patchId)) alreadyOnTarget++;
  }
  const totalLocal = localMap.size;
  return { totalLocal, alreadyOnTarget, toReplay: totalLocal - alreadyOnTarget };
}
