import { git } from "../git/git";
import { debugGit, isDebug } from "../terminal/debug";
import { computeCumulativePatchId, computePatchIds, crossMatchPatchIds } from "./patch-id";

export interface CommitMatchResult {
  rebaseMatches: Map<string, string>; // incomingHash → localHash
  squashMatch: { incomingHash: string; localHashes: string[] } | null;
}

export async function matchDivergedCommits(repoDir: string, baseRef: string): Promise<CommitMatchResult> {
  const result: CommitMatchResult = { rebaseMatches: new Map(), squashMatch: null };

  // Phase 1: 1:1 rebase matching
  const [localMap, incomingMap] = await Promise.all([
    computePatchIds(repoDir, baseRef, "HEAD"),
    computePatchIds(repoDir, "HEAD", baseRef),
  ]);

  if (!localMap || !incomingMap) return result;

  result.rebaseMatches = crossMatchPatchIds(localMap, incomingMap);

  // Phase 2: Full-range squash detection (only when local has > 1 commit and unmatched incoming exist)
  const localCommitCount = localMap.size;
  const unmatchedIncoming = [...incomingMap.entries()].filter(([, hash]) => !result.rebaseMatches.has(hash));

  if (localCommitCount > 1 && unmatchedIncoming.length > 0) {
    const mergeBaseResult = await git(repoDir, "merge-base", "HEAD", baseRef);
    if (mergeBaseResult.exitCode === 0) {
      const mergeBase = mergeBaseResult.stdout.trim();
      if (mergeBase) {
        const cumulativePatchId = await computeCumulativePatchId(repoDir, mergeBase, "HEAD");
        if (cumulativePatchId) {
          for (const [patchId, incomingHash] of unmatchedIncoming) {
            if (patchId === cumulativePatchId) {
              const allLocalHashes = [...localMap.values()];
              result.squashMatch = { incomingHash, localHashes: allLocalHashes };
              break;
            }
          }
        }
      }
    }
  }

  return result;
}

export async function detectRebasedCommits(
  repoDir: string,
  trackingRef: string,
): Promise<{ count: number; rebasedLocalHashes: Set<string>; rebasedRemoteHashes: Set<string> } | null> {
  const [localMap, remoteMap] = await Promise.all([
    computePatchIds(repoDir, trackingRef, "HEAD"),
    computePatchIds(repoDir, "HEAD", trackingRef),
  ]);

  if (!localMap || !remoteMap) return null;

  const rebasedLocalHashes = new Set<string>();
  const remoteIds = new Set(remoteMap.keys());
  for (const [patchId, hash] of localMap) {
    if (remoteIds.has(patchId)) rebasedLocalHashes.add(hash);
  }

  const rebasedRemoteHashes = new Set<string>();
  const localPatchIds = new Set(localMap.keys());
  for (const [patchId, hash] of remoteMap) {
    if (localPatchIds.has(patchId)) rebasedRemoteHashes.add(hash);
  }

  return { count: rebasedLocalHashes.size, rebasedLocalHashes, rebasedRemoteHashes };
}

export async function detectReplacedCommits(
  repoDir: string,
  trackingRef: string,
  branch: string,
  excludeHashes?: Set<string>,
): Promise<{ count: number; replacedHashes: Set<string> } | null> {
  const start = isDebug() ? performance.now() : 0;
  const [reflogResult, remoteResult] = await Promise.all([
    git(repoDir, "log", "-g", "--format=%H", "-n", "200", branch),
    git(repoDir, "log", "--format=%H", `HEAD..${trackingRef}`),
  ]);
  if (isDebug()) {
    const elapsed = performance.now() - start;
    debugGit(`git -C ${repoDir} log -g --format=%H -n 200 ${branch}`, elapsed, reflogResult.exitCode);
    debugGit(`git -C ${repoDir} log --format=%H HEAD..${trackingRef}`, elapsed, remoteResult.exitCode);
  }

  if (reflogResult.exitCode !== 0 || remoteResult.exitCode !== 0) return null;

  const reflogHashes = new Set<string>();
  for (const line of reflogResult.stdout.split("\n")) {
    const hash = line.trim();
    if (hash) reflogHashes.add(hash);
  }

  const replacedHashes = new Set<string>();
  for (const line of remoteResult.stdout.split("\n")) {
    const hash = line.trim();
    if (hash && reflogHashes.has(hash) && !excludeHashes?.has(hash)) {
      replacedHashes.add(hash);
    }
  }

  return { count: replacedHashes.size, replacedHashes };
}

export async function detectSquashedCommits(
  repoDir: string,
  trackingRef: string,
  toPull: number,
): Promise<{ count: number } | null> {
  const mergeBaseResult = await git(repoDir, "merge-base", "HEAD", trackingRef);
  if (mergeBaseResult.exitCode !== 0) return null;
  const mergeBase = mergeBaseResult.stdout.trim();
  if (!mergeBase) return null;

  const [localPatchId, remotePatchId] = await Promise.all([
    computeCumulativePatchId(repoDir, mergeBase, "HEAD"),
    computeCumulativePatchId(repoDir, mergeBase, trackingRef),
  ]);

  if (!localPatchId || !remotePatchId) return null;

  if (localPatchId === remotePatchId) {
    return { count: toPull };
  }

  return { count: 0 };
}
