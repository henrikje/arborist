import type { Cell } from "./model";
import { cell, suffix } from "./model";

export interface IntegrateActionDesc {
  kind: "retarget-merged" | "retarget-config" | "rebase" | "merge";
  baseRef: string;
  branch: string;
  retargetFrom?: string;
  replayCount?: number;
  skipCount?: number;
  diff?: { behind: number; ahead: number; matchedCount?: number };
  mergeType?: "fast-forward" | "three-way";
  conflictRisk: "will-conflict" | "likely" | "unlikely" | "no-conflict" | null;
  stash: "none" | "autostash" | "pop-conflict-likely" | "pop-conflict-unlikely";
  baseFallback?: string;
  warning?: string;
  headSha?: string;
}

export function integrateActionCell(desc: IntegrateActionDesc): Cell {
  let result: Cell;

  if (desc.kind === "retarget-merged") {
    const n = desc.replayCount ?? 0;
    const merged = desc.skipCount ?? 0;
    if (n === 0) {
      const text =
        merged > 0
          ? `reset to ${desc.baseRef} (all ${merged} commits merged)`
          : `reset to ${desc.baseRef} (merged)`;
      result = cell(text);
    } else {
      const commitWord = n === 1 ? "commit" : "commits";
      let text = `rebase onto ${desc.baseRef} (merged) \u2014 rebase ${n} new ${commitWord}`;
      if (merged > 0) text += `, skip ${merged} already merged`;
      result = cell(text);
    }
  } else if (desc.kind === "retarget-config") {
    let text = `rebase onto ${desc.baseRef} from ${desc.retargetFrom} (retarget)`;
    if (desc.skipCount != null && desc.skipCount > 0) {
      const total = (desc.replayCount ?? 0) + desc.skipCount;
      text += ` \u2014 ${total} local, ${desc.skipCount} already on target, ${desc.replayCount ?? 0} to rebase`;
    } else if (desc.replayCount != null && desc.replayCount > 0) {
      text += ` \u2014 ${desc.replayCount} to rebase`;
    }
    result = cell(text);
  } else {
    const diff = desc.diff;
    const behindStr =
      diff && diff.behind > 0
        ? diff.matchedCount && diff.matchedCount > 0
          ? `${diff.behind} behind (${diff.matchedCount} same, ${diff.behind - diff.matchedCount} new)`
          : `${diff.behind} behind`
        : "";
    const diffParts = [diff && diff.behind > 0 && behindStr, diff && diff.ahead > 0 && `${diff.ahead} ahead`]
      .filter(Boolean)
      .join(", ");
    const diffStr = diffParts ? ` \u2014 ${diffParts}` : "";

    const mergeType = desc.mergeType ? ` (${desc.mergeType})` : "";
    const action =
      desc.kind === "rebase"
        ? `rebase ${desc.branch} onto ${desc.baseRef}`
        : `merge ${desc.baseRef} into ${desc.branch}${mergeType}`;

    result = cell(`${action}${diffStr}`);
  }

  // Conflict risk
  if (desc.conflictRisk) {
    const labels = {
      "will-conflict": "will conflict",
      likely: "conflict likely",
      unlikely: "conflict unlikely",
      "no-conflict": "no conflict",
    } as const;
    const isAttention = desc.conflictRisk === "will-conflict" || desc.conflictRisk === "likely";
    result = suffix(result, ` (${labels[desc.conflictRisk]})`, isAttention ? "attention" : "default");
  }

  // Base fallback hint
  if (desc.baseFallback) {
    result = suffix(result, ` (base ${desc.baseFallback} not found)`, "attention");
  }

  // Retarget warning
  if (desc.warning) {
    result = suffix(result, ` (${desc.warning})`, "attention");
  }

  // Stash hint
  if (desc.stash === "autostash") {
    result = suffix(result, " (autostash)");
  } else if (desc.stash === "pop-conflict-likely") {
    result = suffix(result, " (autostash, stash pop conflict likely)", "attention");
  } else if (desc.stash === "pop-conflict-unlikely") {
    result = suffix(result, " (autostash, stash pop conflict unlikely)");
  }

  // HEAD sha
  if (desc.headSha) {
    result = suffix(result, `  (HEAD ${desc.headSha})`, "muted");
  }

  return result;
}
