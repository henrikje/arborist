import type { RepoStatus } from "./types";

/** Compute plain-text BASE diff */
export function plainBaseDiff(base: NonNullable<RepoStatus["base"]>): string {
  if (base.mergedIntoBase != null) return "merged";
  if (base.baseMergedIntoDefault != null) return "base merged";
  const parts = [base.ahead > 0 && `${base.ahead} ahead`, base.behind > 0 && `${base.behind} behind`]
    .filter(Boolean)
    .join(", ");
  return parts || "equal";
}

/** Compute push/pull text parts for the SHARE diff cell separately.
 * `pullNewText` is the "N new" suffix of `pull` when it deserves attention (rebased detected, genuinely new remote content). */
export function remoteDiffParts(repo: RepoStatus): {
  push: string;
  pull: string;
  pullNewText: string;
  pushNewText: string;
} {
  const merged = repo.base?.mergedIntoBase != null;
  const prNumber = repo.base?.detectedPr?.number;
  const prSuffix = prNumber ? ` (#${prNumber})` : "";
  const newCommits = repo.base?.newCommitsAfterMerge;
  const pushSuffix = merged && newCommits && newCommits > 0 ? `, ${newCommits} to push` : "";

  if (repo.share.refMode === "gone") {
    if (merged) return { push: `merged${prSuffix}, gone${pushSuffix}`, pull: "", pullNewText: "", pushNewText: "" };
    if (repo.base !== null && repo.base.ahead > 0)
      return { push: `gone, ${repo.base.ahead} to push`, pull: "", pullNewText: "", pushNewText: "" };
    return { push: "gone", pull: "", pullNewText: "", pushNewText: "" };
  }

  if (repo.share.refMode === "noRef") {
    if (repo.base !== null && repo.base.ahead > 0)
      return { push: `${repo.base.ahead} to push`, pull: "", pullNewText: "", pushNewText: "" };
    return { push: "not pushed", pull: "", pullNewText: "", pushNewText: "" };
  }

  if (merged && (repo.share.toPull ?? 0) === 0)
    return { push: `merged${prSuffix}${pushSuffix}`, pull: "", pullNewText: "", pushNewText: "" };

  const toPush = repo.share.toPush ?? 0;
  const toPull = repo.share.toPull ?? 0;
  if (toPush === 0 && toPull === 0) return { push: "up to date", pull: "", pullNewText: "", pushNewText: "" };

  const rebased = repo.share.rebased;

  // rebased detection ran (implies both toPush > 0 and toPull > 0 at time of detection)
  if (rebased !== null) {
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

    // Pull side: outdated first (rebased + replaced), then new (genuinely new remote content)
    const pullParts: string[] = [];
    let pullNewText = "";
    if (toPull > 0) {
      const outdatedFromRebased = rebased > 0 ? Math.min(rebased, toPull) : 0;
      const replaced = repo.share.replaced ?? 0;
      const outdatedFromReplaced = Math.min(replaced, toPull - outdatedFromRebased);
      const totalOutdated = outdatedFromRebased + outdatedFromReplaced;
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

  // rebased not computed (only one of push/pull is active)
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
