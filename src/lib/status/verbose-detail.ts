import { detectRebasedCommits, detectReplacedCommits, matchDivergedCommits } from "../analysis/commit-matching";
import { verifySquashRange } from "../analysis/merge-detection";
import { getCommitsBetweenFull, parseGitStatusFiles } from "../git/git";
import type { StatusJsonRepo } from "../json/json-types";
import { baseRef } from "./status";
import type { RepoStatus } from "./types";

// Internal verbose type — carries shortHash for text display alongside fullHash for JSON
interface VerboseCommit {
  hash: string;
  shortHash: string;
  subject: string;
}
export interface VerboseDetail {
  aheadOfBase?: (VerboseCommit & { matchedOnBase?: { hash: string; shortHash: string } })[];
  behindBase?: (VerboseCommit & {
    rebaseOf?: { hash: string; shortHash: string };
    squashOf?: { hashes: string[]; shortHashes: string[] };
  })[];
  unpushed?: (VerboseCommit & { rebased: boolean })[];
  toPull?: (VerboseCommit & { superseded: boolean })[];
  staged?: NonNullable<StatusJsonRepo["verbose"]>["staged"];
  unstaged?: NonNullable<StatusJsonRepo["verbose"]>["unstaged"];
  untracked?: string[];
}

export async function gatherVerboseDetail(repo: RepoStatus, wsDir: string): Promise<VerboseDetail | undefined> {
  const repoDir = `${wsDir}/${repo.name}`;
  const verbose: VerboseDetail = {};

  // Ahead of base (suppress when base fell back — numbers are against the fallback, not the configured base)
  if (repo.base && repo.base.ahead > 0 && !repo.base.configuredRef) {
    const ref = baseRef(repo.base);
    const commits = await getCommitsBetweenFull(repoDir, ref, "HEAD");
    if (commits.length > 0) {
      verbose.aheadOfBase = commits.map((c) => ({ hash: c.fullHash, shortHash: c.shortHash, subject: c.subject }));
    }
  }

  // Behind base (suppress when base fell back)
  if (repo.base && repo.base.behind > 0 && !repo.base.configuredRef) {
    const ref = baseRef(repo.base);
    const commits = await getCommitsBetweenFull(repoDir, "HEAD", ref);
    if (commits.length > 0) {
      // When diverged, match incoming commits against local commits
      let rebaseMap: Map<string, string> | undefined;
      let squashMatch: { incomingHash: string; localHashes: string[] } | undefined;
      if (repo.base.ahead > 0) {
        const matchResult = await matchDivergedCommits(repoDir, ref);
        if (matchResult.rebaseMatches.size > 0) rebaseMap = matchResult.rebaseMatches;
        if (matchResult.squashMatch) squashMatch = matchResult.squashMatch;
      }

      // Build a local hash → shortHash lookup from aheadOfBase (already gathered)
      const localHashToShort = new Map<string, string>();
      if (verbose.aheadOfBase) {
        for (const c of verbose.aheadOfBase) localHashToShort.set(c.hash, c.shortHash);
      }

      verbose.behindBase = commits.map((c) => {
        const entry: NonNullable<VerboseDetail["behindBase"]>[number] = {
          hash: c.fullHash,
          shortHash: c.shortHash,
          subject: c.subject,
        };
        if (rebaseMap?.has(c.fullHash)) {
          const localHash = rebaseMap.get(c.fullHash) ?? c.fullHash;
          entry.rebaseOf = { hash: localHash, shortHash: localHashToShort.get(localHash) ?? localHash.slice(0, 7) };
        } else if (squashMatch && c.fullHash === squashMatch.incomingHash) {
          entry.squashOf = {
            hashes: squashMatch.localHashes,
            shortHashes: squashMatch.localHashes.map((h) => localHashToShort.get(h) ?? h.slice(0, 7)),
          };
        }
        return entry;
      });
    }
  }

  // Cross-reference: annotate ahead commits that have a rebase match on base
  if (verbose.aheadOfBase && verbose.behindBase) {
    const localToIncoming = new Map<string, { hash: string; shortHash: string }>();
    for (const c of verbose.behindBase) {
      if (c.rebaseOf) localToIncoming.set(c.rebaseOf.hash, { hash: c.hash, shortHash: c.shortHash });
    }
    if (localToIncoming.size > 0) {
      for (const c of verbose.aheadOfBase) {
        const match = localToIncoming.get(c.hash);
        if (match) c.matchedOnBase = match;
      }
    }
  }

  // Verify and populate squashOf on the squash commit in behindBase
  if (
    verbose.aheadOfBase &&
    verbose.behindBase &&
    repo.base?.mergedIntoBase === "squash" &&
    repo.base.mergeCommitHash &&
    repo.base.newCommitsAfterMerge
  ) {
    const n = repo.base.newCommitsAfterMerge;
    const mergedCommits = verbose.aheadOfBase.slice(n);
    const squashEntry = verbose.behindBase.find((c) => c.hash === repo.base?.mergeCommitHash && !c.squashOf);
    if (squashEntry && mergedCommits.length > 1) {
      const ref = baseRef(repo.base);
      const verified = await verifySquashRange(repoDir, ref, repo.base.mergeCommitHash, n);
      if (verified) {
        const reversed = [...mergedCommits].reverse();
        squashEntry.squashOf = {
          hashes: reversed.map((m) => m.hash),
          shortHashes: reversed.map((m) => m.shortHash),
        };
      }
    }
  }

  // Unpushed to remote
  if (repo.share.toPush !== null && repo.share.toPush > 0 && repo.share.ref) {
    let rebasedHashes: Set<string> | null = null;
    if (repo.share.rebased != null && repo.share.rebased > 0) {
      const detection = await detectRebasedCommits(repoDir, repo.share.ref);
      rebasedHashes = detection?.rebasedLocalHashes ?? null;
    }
    const commits = await getCommitsBetweenFull(repoDir, repo.share.ref, "HEAD");
    if (commits.length > 0) {
      verbose.unpushed = commits.map((c) => ({
        hash: c.fullHash,
        shortHash: c.shortHash,
        subject: c.subject,
        rebased: rebasedHashes?.has(c.fullHash) ?? false,
      }));
    }
  }

  // To pull from remote
  if (repo.share.toPull !== null && repo.share.toPull > 0 && repo.share.ref) {
    let rebasedRemoteHashes: Set<string> | null = null;
    if (repo.share.rebased != null && repo.share.rebased > 0) {
      const detection = await detectRebasedCommits(repoDir, repo.share.ref);
      rebasedRemoteHashes = detection?.rebasedRemoteHashes ?? null;
    }
    let replacedHashes: Set<string> | null = null;
    if (repo.share.replaced != null && repo.share.replaced > 0) {
      const branch = repo.identity.headMode.kind === "attached" ? repo.identity.headMode.branch : "";
      if (branch) {
        const result = await detectReplacedCommits(repoDir, repo.share.ref, branch, rebasedRemoteHashes ?? undefined);
        replacedHashes = result?.replacedHashes ?? null;
      }
    }
    const commits = await getCommitsBetweenFull(repoDir, "HEAD", repo.share.ref);
    if (commits.length > 0) {
      verbose.toPull = commits.map((c) => ({
        hash: c.fullHash,
        shortHash: c.shortHash,
        subject: c.subject,
        superseded:
          (rebasedRemoteHashes?.has(c.fullHash) ?? false) ||
          (replacedHashes?.has(c.fullHash) ?? false) ||
          (repo.share.squashed != null && repo.share.squashed > 0),
      }));
    }
  }

  // File-level detail
  if (repo.local.staged > 0 || repo.local.modified > 0 || repo.local.untracked > 0 || repo.local.conflicts > 0) {
    const files = await parseGitStatusFiles(repoDir);
    if (files.staged.length > 0) verbose.staged = files.staged;
    if (files.unstaged.length > 0)
      verbose.unstaged = files.unstaged.map((f) => ({
        file: f.file,
        type: f.type as "modified" | "deleted",
      }));
    if (files.untracked.length > 0) verbose.untracked = files.untracked;
  }

  return Object.keys(verbose).length > 0 ? verbose : undefined;
}

export function toJsonVerbose(
  detail: VerboseDetail,
  base?: { newCommitsAfterMerge?: number; mergeCommitHash?: string } | null,
): StatusJsonRepo["verbose"] {
  const { aheadOfBase, behindBase, unpushed, toPull, ...rest } = detail;
  const stripShort = ({ hash, subject }: VerboseCommit) => ({ hash, subject });
  const n = base?.newCommitsAfterMerge;
  const mergeHash = base?.mergeCommitHash;
  return {
    ...rest,
    ...(aheadOfBase && {
      aheadOfBase: aheadOfBase.map((c, i) => ({
        ...stripShort(c),
        ...(c.matchedOnBase ? { mergedAs: c.matchedOnBase.hash } : {}),
        ...(n && n > 0 && i >= n && mergeHash && !c.matchedOnBase ? { mergedAs: mergeHash } : {}),
      })),
    }),
    ...(behindBase && {
      behindBase: behindBase.map((c) => ({
        hash: c.hash,
        subject: c.subject,
        ...(c.rebaseOf && { rebaseOf: c.rebaseOf.hash }),
        ...(c.squashOf && { squashOf: c.squashOf.hashes }),
      })),
    }),
    ...(unpushed && { unpushed: unpushed.map(({ hash, subject, rebased }) => ({ hash, subject, rebased })) }),
    ...(toPull && { toPull: toPull.map(({ hash, subject, superseded }) => ({ hash, subject, superseded })) }),
  };
}
