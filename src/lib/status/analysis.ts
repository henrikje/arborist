import type { RepoStatus } from "./types";

/** Compute plain-text BASE diff */
export function plainBaseDiff(base: NonNullable<RepoStatus["base"]>): string {
  if (base.merge != null) return "merged";
  if (base.baseMergedIntoDefault != null) return "base merged";
  const parts = [base.ahead > 0 && `${base.ahead} ahead`, base.behind > 0 && `${base.behind} behind`]
    .filter(Boolean)
    .join(", ");
  return parts || "equal";
}

type DiffResult = { push: string; pull: string; pullNewText: string; pushNewText: string };
const EMPTY_DIFF: DiffResult = { push: "", pull: "", pullNewText: "", pushNewText: "" };

function remoteDiffGone(repo: RepoStatus): DiffResult {
  const merged = repo.base?.merge != null;
  const prNumber = repo.base?.merge?.detectedPr?.number;
  const prSuffix = prNumber ? ` (#${prNumber})` : "";
  const newCommits = repo.base?.merge?.newCommitsAfter;
  const pushSuffix = merged && newCommits && newCommits > 0 ? `, ${newCommits} to push` : "";

  if (merged) return { ...EMPTY_DIFF, push: `merged${prSuffix}, gone${pushSuffix}` };
  if (repo.base !== null && repo.base.ahead > 0) return { ...EMPTY_DIFF, push: `gone, ${repo.base.ahead} to push` };
  return { ...EMPTY_DIFF, push: "gone" };
}

function remoteDiffNeverPushed(repo: RepoStatus): DiffResult {
  const merged = repo.base?.merge != null;
  if (merged) {
    const newCommits = repo.base?.merge?.newCommitsAfter;
    if (newCommits && newCommits > 0) {
      return { ...EMPTY_DIFF, push: `${newCommits} to push` };
    }
    return { ...EMPTY_DIFF, push: "no branch" };
  }
  if (repo.base !== null && repo.base.ahead > 0) return { ...EMPTY_DIFF, push: `${repo.base.ahead} to push` };
  return { ...EMPTY_DIFF, push: "no branch" };
}

function remoteDiffMerged(repo: RepoStatus): DiffResult {
  const prNumber = repo.base?.merge?.detectedPr?.number;
  const prSuffix = prNumber ? ` (#${prNumber})` : "";
  const newCommits = repo.base?.merge?.newCommitsAfter;
  const pushSuffix = newCommits && newCommits > 0 ? `, ${newCommits} to push` : "";
  return { ...EMPTY_DIFF, push: `merged${prSuffix}${pushSuffix}` };
}

function remoteDiffDiverged(repo: RepoStatus): DiffResult {
  const toPush = repo.share.toPush ?? 0;
  const toPull = repo.share.toPull ?? 0;
  const rebased = repo.share.outdated?.rebased ?? 0;

  const baseAhead = repo.base?.ahead ?? null;
  const pushParts: string[] = [];
  let pushNewText = "";

  if (baseAhead !== null) {
    // Three-way split: fromBase / rebased / new
    const fromBase = Math.max(0, toPush - baseAhead);
    // Keep push-side breakdown anchored to share.toPush:
    // fromBase + rebased + new must not exceed what can actually be pushed.
    const newCount = Math.max(0, toPush - fromBase - rebased);
    const baseLabel = repo.base?.ref ?? "base";
    if (fromBase > 0) pushParts.push(`${fromBase} from ${baseLabel}`);
    if (rebased > 0) pushParts.push(`${rebased} rebased`);
    if (newCount > 0) {
      pushNewText = `${newCount} new`;
      pushParts.push(pushNewText);
    }
  } else {
    // Fallback: no base info
    const newPush = Math.max(0, toPush - rebased);
    if (newPush > 0) {
      pushNewText = `${newPush} to push`;
      pushParts.push(pushNewText);
    }
    if (rebased > 0) pushParts.push(`${rebased} rebased`);
  }

  // Pull side: outdated first (rebased + replaced + squashed), then new (genuinely new remote content)
  const pullParts: string[] = [];
  let pullNewText = "";
  if (toPull > 0) {
    const totalOutdated = repo.share.outdated?.total ?? 0;
    const newPull = Math.max(0, toPull - totalOutdated);
    if (totalOutdated > 0) pullParts.push(`${totalOutdated} outdated`);
    if (newPull > 0) {
      pullNewText = `${newPull} new`;
      pullParts.push(pullNewText);
    }
  }

  return {
    push: pushParts.filter(Boolean).join(" + "),
    pull: pullParts.join(" + "),
    pullNewText,
    pushNewText,
  };
}

/** Compute push/pull text parts for the SHARE diff cell separately.
 * `pullNewText` is the "N new" suffix of `pull` when it deserves attention (rebased detected, genuinely new remote content). */
export function remoteDiffParts(repo: RepoStatus): DiffResult {
  if (repo.share.refMode === "gone") return remoteDiffGone(repo);
  if (repo.share.refMode === "noRef") return remoteDiffNeverPushed(repo);

  const merged = repo.base?.merge != null;
  if (merged && (repo.share.toPull ?? 0) === 0) return remoteDiffMerged(repo);

  const toPush = repo.share.toPush ?? 0;
  const toPull = repo.share.toPull ?? 0;
  if (toPush === 0 && toPull === 0) return { ...EMPTY_DIFF, push: "up to date" };

  if (repo.share.outdated) return remoteDiffDiverged(repo);

  // Simple: only one of push/pull is active
  return {
    push: toPush > 0 ? `${toPush} to push` : "",
    pull: toPull > 0 ? `${toPull} to pull` : "",
    pullNewText: "",
    pushNewText: toPush > 0 ? `${toPush} to push` : "",
  };
}

/** Compute plain-text SHARE diff */
export function plainRemoteDiff(repo: RepoStatus): string {
  const { push, pull } = remoteDiffParts(repo);
  if (push && pull) return `${push} → ${pull}`;
  return push || pull || "";
}

/** Compute plain-text LOCAL cell */
export function plainLocal(repo: RepoStatus): string {
  const parts = [
    repo.local.conflicts > 0 && `${repo.local.conflicts} conflicts`,
    repo.local.staged > 0 && `${repo.local.staged} staged`,
    repo.local.modified > 0 && `${repo.local.modified} modified`,
    repo.local.untracked > 0 && `${repo.local.untracked} untracked`,
  ]
    .filter(Boolean)
    .join(", ");

  const suffixParts: string[] = [];
  if (repo.operation) suffixParts.push(repo.operation);
  if (repo.identity.shallow) suffixParts.push("shallow");
  const suffixText = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : "";

  if (!parts) {
    return `clean${suffixText}`;
  }
  return `${parts}${suffixText}`;
}
