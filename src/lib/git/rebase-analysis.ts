import { debugGit, isDebug } from "../terminal/debug";
import { getCommitsBetweenFull, git } from "./git";
import { detectBranchMerged } from "./merge-detection";

export interface CommitMatchResult {
  rebaseMatches: Map<string, string>; // incomingHash → localHash
  squashMatch: { incomingHash: string; localHashes: string[] } | null;
}

export interface ReplayPlanAnalysis {
  totalLocal: number;
  alreadyOnTarget: number;
  toReplay: number;
  contiguous: boolean;
  boundaryRef?: string;
}

export async function matchDivergedCommits(repoDir: string, baseRef: string): Promise<CommitMatchResult> {
  const result: CommitMatchResult = { rebaseMatches: new Map(), squashMatch: null };

  // Phase 1: 1:1 rebase matching (same algorithm as detectRebasedCommits)
  const matchStart = isDebug() ? performance.now() : 0;
  const [localResult, incomingResult] = await Promise.all([
    Bun.$`git -C ${repoDir} log -p ${baseRef}..HEAD | git patch-id --stable`.quiet().nothrow(),
    Bun.$`git -C ${repoDir} log -p HEAD..${baseRef} | git patch-id --stable`.quiet().nothrow(),
  ]);
  if (isDebug()) {
    const elapsed = performance.now() - matchStart;
    debugGit(`git -C ${repoDir} log -p ${baseRef}..HEAD | git patch-id --stable`, elapsed, localResult.exitCode);
    debugGit(`git -C ${repoDir} log -p HEAD..${baseRef} | git patch-id --stable`, elapsed, incomingResult.exitCode);
  }

  if (localResult.exitCode !== 0 || incomingResult.exitCode !== 0) return result;

  const parse = (text: string) => {
    const map = new Map<string, string>(); // patchId → commitHash
    for (const line of text.split("\n")) {
      const [patchId, hash] = line.split(" ");
      if (patchId && hash) map.set(patchId, hash);
    }
    return map;
  };

  const localMap = parse(localResult.text()); // patchId → localHash
  const incomingMap = parse(incomingResult.text()); // patchId → incomingHash

  const localPatchIds = new Set(localMap.keys());
  for (const [patchId, incomingHash] of incomingMap) {
    if (localPatchIds.has(patchId)) {
      const localHash = localMap.get(patchId);
      if (localHash) result.rebaseMatches.set(incomingHash, localHash);
    }
  }

  // Phase 2: Full-range squash detection (only when local has > 1 commit and unmatched incoming exist)
  const localCommitCount = localMap.size;
  const unmatchedIncoming = [...incomingMap.entries()].filter(([, hash]) => !result.rebaseMatches.has(hash));

  if (localCommitCount > 1 && unmatchedIncoming.length > 0) {
    const mergeBaseResult = await git(repoDir, "merge-base", "HEAD", baseRef);
    if (mergeBaseResult.exitCode === 0) {
      const mergeBase = mergeBaseResult.stdout.trim();
      if (mergeBase) {
        const squashStart = isDebug() ? performance.now() : 0;
        const cumulativeResult = await Bun.$`git -C ${repoDir} diff ${mergeBase}..HEAD | git patch-id --stable`
          .quiet()
          .nothrow();
        if (isDebug()) {
          debugGit(
            `git -C ${repoDir} diff ${mergeBase}..HEAD | git patch-id --stable`,
            performance.now() - squashStart,
            cumulativeResult.exitCode,
          );
        }
        if (cumulativeResult.exitCode === 0) {
          const cumulativeLine = cumulativeResult.text().trim();
          const cumulativePatchId = cumulativeLine.split(" ")[0];
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
  }

  return result;
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

export async function detectRebasedCommits(
  repoDir: string,
  trackingRef: string,
): Promise<{ count: number; rebasedLocalHashes: Set<string>; rebasedRemoteHashes: Set<string> } | null> {
  const rebaseStart = isDebug() ? performance.now() : 0;
  const [localResult, remoteResult] = await Promise.all([
    Bun.$`git -C ${repoDir} log -p ${trackingRef}..HEAD | git patch-id --stable`.quiet().nothrow(),
    Bun.$`git -C ${repoDir} log -p HEAD..${trackingRef} | git patch-id --stable`.quiet().nothrow(),
  ]);
  if (isDebug()) {
    const elapsed = performance.now() - rebaseStart;
    debugGit(`git -C ${repoDir} log -p ${trackingRef}..HEAD | git patch-id --stable`, elapsed, localResult.exitCode);
    debugGit(`git -C ${repoDir} log -p HEAD..${trackingRef} | git patch-id --stable`, elapsed, remoteResult.exitCode);
  }

  if (localResult.exitCode !== 0 || remoteResult.exitCode !== 0) return null;

  const parse = (text: string) => {
    const map = new Map<string, string>(); // patchId → commitHash
    for (const line of text.split("\n")) {
      const [patchId, hash] = line.split(" ");
      if (patchId && hash) map.set(patchId, hash);
    }
    return map;
  };

  const localMap = parse(localResult.text());
  const remoteMap = parse(remoteResult.text());

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

export async function predictRebaseConflictCommits(
  repoDir: string,
  targetRef: string,
): Promise<{ shortHash: string; files: string[] }[]> {
  // List incoming commits (commits on targetRef not on HEAD), in chronological order
  const logResult = await git(repoDir, "log", "--format=%H %h", "--reverse", `HEAD..${targetRef}`);
  if (logResult.exitCode !== 0) return [];
  const commits = logResult.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const spaceIdx = line.indexOf(" ");
      return { hash: line.slice(0, spaceIdx), shortHash: line.slice(spaceIdx + 1) };
    });
  if (commits.length === 0) return [];

  const conflicting: { shortHash: string; files: string[] }[] = [];
  for (const commit of commits) {
    // Simulate cherry-picking this commit onto HEAD by using merge-tree
    // merge-base is commit's parent, ours is HEAD, theirs is the commit
    const result = await git(
      repoDir,
      "merge-tree",
      "--write-tree",
      "--name-only",
      `--merge-base=${commit.hash}~1`,
      "HEAD",
      commit.hash,
    );
    if (result.exitCode === 1 && result.stdout.trim()) {
      // Conflict detected — parse file list (skip tree hash + info lines)
      const files = result.stdout
        .split("\n")
        .slice(1)
        .filter((line) => line && !line.startsWith("Auto-merging") && !line.startsWith("CONFLICT"));
      conflicting.push({ shortHash: commit.shortHash, files });
    }
    // exit 0 = clean, exit >1 = error (e.g. first commit has no parent) — skip
  }
  return conflicting;
}

export async function analyzeRetargetReplay(
  repoDir: string,
  oldBaseRef: string,
  newBaseRef: string,
): Promise<{ totalLocal: number; alreadyOnTarget: number; toReplay: number } | null> {
  const [localResult, newBaseResult] = await Promise.all([
    Bun.$`git -C ${repoDir} log -p ${oldBaseRef}..HEAD | git patch-id --stable`.quiet().nothrow(),
    Bun.$`git -C ${repoDir} log -p ${oldBaseRef}..${newBaseRef} | git patch-id --stable`.quiet().nothrow(),
  ]);

  if (localResult.exitCode !== 0 || newBaseResult.exitCode !== 0) return null;

  const parse = (text: string) => {
    const map = new Map<string, string>();
    for (const line of text.split("\n")) {
      const [patchId, hash] = line.split(" ");
      if (patchId && hash) map.set(patchId, hash);
    }
    return map;
  };

  const localMap = parse(localResult.text());
  const newBaseIds = new Set(parse(newBaseResult.text()).keys());

  let alreadyOnTarget = 0;
  for (const patchId of localMap.keys()) {
    if (newBaseIds.has(patchId)) alreadyOnTarget++;
  }
  const totalLocal = localMap.size;
  return { totalLocal, alreadyOnTarget, toReplay: totalLocal - alreadyOnTarget };
}
