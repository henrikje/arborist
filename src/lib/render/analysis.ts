import { plainBaseDiff, remoteDiffParts } from "../status/analysis";
import { AT_RISK_FLAGS, FLAG_LABELS, MERGED_IMPLIED_FLAGS } from "../status/types";
import type { RepoFlags, RepoStatus, WorkspaceSummary } from "../status/types";
import { yellow } from "../terminal/output";
import { type Cell, EMPTY_CELL, type Span, cell, join, spans, suffix } from "./model";

// Re-export plain* functions from their new home for barrel consumers
export { plainBaseDiff, plainLocal, plainRemoteDiff } from "../status/analysis";

// ── Cell-Level Analysis Helpers ──

/** Analyze the BRANCH cell — attention when drifted or detached */
export function analyzeBranch(repo: RepoStatus, expectedBranch: string): Cell {
  if (repo.identity.headMode.kind === "detached") {
    return cell("(detached)", "attention");
  }
  const branch = repo.identity.headMode.branch;
  const drifted = branch !== expectedBranch;
  return cell(branch, drifted ? "attention" : "default");
}

/** Analyze the BASE name cell — attention when baseFellBack or baseMerged */
export function analyzeBaseName(repo: RepoStatus, flags: RepoFlags): Cell {
  if (!repo.base) return EMPTY_CELL;
  const branch = repo.base.configuredRef ?? repo.base.ref;
  const name = repo.base.remote ? `${repo.base.remote}/${branch}` : branch;
  const baseMerged = repo.base.baseMergedIntoDefault != null;
  return cell(name, flags.baseFellBack || baseMerged ? "attention" : "default");
}

/** Analyze the BASE diff cell — attention when conflict predicted, baseMerged, or baseFellBack */
export function analyzeBaseDiff(repo: RepoStatus, flags: RepoFlags, hasConflict: boolean): Cell {
  if (!repo.base) return EMPTY_CELL;
  const isDetached = repo.identity.headMode.kind === "detached";
  if (isDetached) return EMPTY_CELL;

  let text: string;
  if (repo.base.configuredRef && repo.base.baseMergedIntoDefault == null) {
    text = "not found";
  } else {
    text = plainBaseDiff(repo.base);
  }

  const needsAttention = hasConflict || repo.base.baseMergedIntoDefault != null || flags.baseFellBack;
  return cell(text, needsAttention ? "attention" : "default");
}

/** Analyze the SHARE remote name cell */
export function analyzeRemoteName(repo: RepoStatus, flags: RepoFlags): Cell {
  const isDetached = repo.identity.headMode.kind === "detached";
  if (isDetached) return cell("detached", "attention");

  let name: string;
  if (repo.share.refMode === "configured" && repo.share.ref) {
    name = repo.share.ref;
  } else {
    const branch = repo.identity.headMode.kind === "attached" ? repo.identity.headMode.branch : "";
    name = `${repo.share.remote}/${branch}`;
  }

  const isDrifted = flags.isDrifted;
  const isUnexpected =
    repo.share.refMode === "configured" &&
    repo.share.ref !== null &&
    repo.share.ref !==
      `${repo.share.remote}/${repo.identity.headMode.kind === "attached" ? repo.identity.headMode.branch : ""}`;

  return cell(name, isDrifted || isUnexpected ? "attention" : "default");
}

function pushSideSpans(pushText: string, pushNewText: string, pushNeedsAttention: boolean): Span[] {
  if (!pushNeedsAttention) return [{ text: pushText, attention: "default" }];
  if (!pushNewText || pushText === pushNewText) return [{ text: pushText, attention: "attention" }];
  if (pushText.endsWith(` + ${pushNewText}`)) {
    const prefix = pushText.slice(0, pushText.length - pushNewText.length - 3);
    return [
      { text: `${prefix} + `, attention: "default" },
      { text: pushNewText, attention: "attention" },
    ];
  }
  return [{ text: pushText, attention: "attention" }];
}

/** Analyze the SHARE diff cell — arrow separator between push and pull sides */
export function analyzeRemoteDiff(repo: RepoStatus, flags: RepoFlags, hasPullConflict = false): Cell {
  const isDetached = repo.identity.headMode.kind === "detached";
  if (isDetached) return EMPTY_CELL;

  const { push: pushText, pull: pullText, pullNewText, pushNewText } = remoteDiffParts(repo);
  if (!pushText && !pullText) return EMPTY_CELL;

  // Simple non-attention cases (no push activity)
  if (!pushText) return cell(pullText);
  if (pushText === "up to date" || pushText === "gone" || pushText === "not pushed") return cell(pushText);

  // Behind-only: already handled above (pushText empty)

  // Determine push-side attention
  const toPush = repo.share.toPush ?? 0;
  const baseAhead = repo.base?.ahead ?? toPush;
  const totalMatched = repo.share.outdated?.total ?? 0;
  const newCount = Math.max(0, Math.min(baseAhead, toPush) - totalMatched);
  const pushNeedsAttention = flags.isUnpushed && (totalMatched === 0 || newCount > 0);
  const pushSpans = pushSideSpans(pushText, pushNewText, pushNeedsAttention);

  // Merged with new work — color only the push suffix portion
  if (repo.base?.merge?.newCommitsAfter && repo.base.merge.newCommitsAfter > 0 && !pullText) {
    const text = pushText;
    const pushIdx = text.lastIndexOf(", ");
    if (pushIdx >= 0 && text.includes("to push")) {
      const prefix = text.slice(0, pushIdx + 2);
      const pushPart = text.slice(pushIdx + 2);
      return spans({ text: prefix, attention: "default" }, { text: pushPart, attention: "attention" });
    }
    return cell(text);
  }

  // Push-only: single span
  if (!pullText)
    return pushSpans.length === 1 ? cell(pushText, pushSpans[0]?.attention ?? "default") : spans(...pushSpans);

  // Both sides: push | arrow (muted) | pull (highlight "N new" only when pull conflict is predicted)
  if (pullNewText && pullText !== pullNewText) {
    // Has outdated + new: "M outdated + K new" — highlight "K new" with attention
    const outdatedPortion = pullText.slice(0, pullText.length - pullNewText.length - 3);
    return spans(
      ...pushSpans,
      { text: " → ", attention: "muted" },
      { text: `${outdatedPortion} + `, attention: "default" },
      { text: pullNewText, attention: hasPullConflict ? "attention" : "default" },
    );
  }
  if (pullNewText) {
    // Pull is only "K new"
    return spans(
      ...pushSpans,
      { text: " → ", attention: "muted" },
      { text: pullText, attention: hasPullConflict ? "attention" : "default" },
    );
  }
  return spans(...pushSpans, { text: " → ", attention: "muted" }, { text: pullText, attention: "default" });
}

/** Analyze the LOCAL cell — attention for changes; multi-span for suffix */
export function analyzeLocal(repo: RepoStatus): Cell {
  const changeParts: Cell[] = [];
  if (repo.local.conflicts > 0) changeParts.push(cell(`${repo.local.conflicts} conflicts`, "attention"));
  if (repo.local.staged > 0) changeParts.push(cell(`${repo.local.staged} staged`, "attention"));
  if (repo.local.modified > 0) changeParts.push(cell(`${repo.local.modified} modified`, "attention"));
  if (repo.local.untracked > 0) changeParts.push(cell(`${repo.local.untracked} untracked`, "attention"));

  const suffixParts: string[] = [];
  if (repo.operation) suffixParts.push(repo.operation);
  if (repo.identity.shallow) suffixParts.push("shallow");
  const suffixText = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : "";

  if (changeParts.length === 0) {
    if (suffixText) {
      return spans({ text: "clean", attention: "default" }, { text: suffixText, attention: "attention" });
    }
    return cell("clean");
  }

  const base = join(changeParts);
  if (suffixText) {
    return suffix(base, suffixText, "attention");
  }
  return base;
}

// ── Flag labels + status count formatting ──

export function flagLabels(flags: RepoFlags): string[] {
  return FLAG_LABELS.filter(({ key }) => {
    if (!flags[key]) return false;
    if (flags.isMerged && MERGED_IMPLIED_FLAGS.has(key)) return false;
    return true;
  }).map(({ label }) => label);
}

export function formatStatusCounts(
  statusCounts: WorkspaceSummary["statusCounts"],
  outdatedOnlyCount = 0,
  yellowKeys: Set<keyof RepoFlags> = AT_RISK_FLAGS,
): string {
  return statusCounts
    .flatMap(({ label, key, count }) => {
      if (key === "isUnpushed" && outdatedOnlyCount > 0) {
        const genuine = count - outdatedOnlyCount;
        const parts: string[] = [];
        if (genuine > 0) parts.push(yellow(label));
        parts.push("outdated");
        return parts;
      }
      return [yellowKeys.has(key) ? yellow(label) : label];
    })
    .join(", ");
}

export function buildStatusCountsCell(
  statusCounts: WorkspaceSummary["statusCounts"],
  outdatedOnlyCount = 0,
  atRiskKeys: Set<keyof RepoFlags> = AT_RISK_FLAGS,
): Cell {
  const parts: Cell[] = statusCounts.flatMap(({ label, key, count }) => {
    if (key === "isUnpushed" && outdatedOnlyCount > 0) {
      const genuine = count - outdatedOnlyCount;
      const cells: Cell[] = [];
      if (genuine > 0) cells.push(cell(label, "attention"));
      cells.push(cell("outdated"));
      return cells;
    }
    return [cell(label, atRiskKeys.has(key) ? "attention" : "default")];
  });
  return join(parts);
}
