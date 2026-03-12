import type { FileChange } from "../git/parsing";
import { baseRef } from "../status/status";
import type { RepoStatus } from "../status/types";
import type { VerboseDetail } from "../status/verbose-detail";
import { dim, yellow } from "../terminal/output";
import type { Cell, OutputNode } from "./model";
import { cell, spans, suffix } from "./model";

export const SECTION_INDENT = "      ";
export const ITEM_INDENT = "          ";
export const VERBOSE_COMMIT_LIMIT = 25;

// Re-export gathering types/functions from their new home for barrel consumers
export { type VerboseDetail, gatherVerboseDetail, toJsonVerbose } from "../status/verbose-detail";

export function formatVerboseDetail(repo: RepoStatus, verbose: VerboseDetail | undefined): string {
  const sections: string[] = [];

  // Merged into base
  if (repo.base?.mergedIntoBase) {
    const ref = baseRef(repo.base);
    const strategy = repo.base.mergedIntoBase === "squash" ? "squash" : "merge";
    let prSuffix = "";
    if (repo.base.detectedPr) {
      const commitSuffix = repo.base.detectedPr.mergeCommit ? ` [${repo.base.detectedPr.mergeCommit.slice(0, 7)}]` : "";
      prSuffix = repo.base.detectedPr.url
        ? ` — detected PR #${repo.base.detectedPr.number} (${repo.base.detectedPr.url})${commitSuffix}`
        : ` — detected PR #${repo.base.detectedPr.number}${commitSuffix}`;
    }
    sections.push(`\n${SECTION_INDENT}Branch merged into ${ref} (${strategy})${prSuffix}\n`);
    if (repo.base.newCommitsAfterMerge && repo.base.newCommitsAfterMerge > 0) {
      const n = repo.base.newCommitsAfterMerge;
      sections.push(
        `${SECTION_INDENT}${yellow(`${n} new ${n === 1 ? "commit" : "commits"} after merge — run 'arb rebase' to replay onto updated base`)}\n`,
      );
    }
  }

  // Base branch merged into default
  if (repo.base?.baseMergedIntoDefault) {
    const strategy = repo.base.baseMergedIntoDefault === "squash" ? "squash" : "merge";
    const baseName = repo.base.configuredRef ?? repo.base.ref;
    sections.push(
      `\n${SECTION_INDENT}Base branch ${baseName} has been merged into default (${strategy})\n${SECTION_INDENT}Run 'arb rebase --retarget' to rebase onto the default branch\n`,
    );
  }

  // Configured base not found (fell back to default) — skip when base merged already covers it
  if (repo.base?.configuredRef && !repo.base.baseMergedIntoDefault) {
    const remoteSuffix = repo.base.remote ? ` on ${repo.base.remote}` : "";
    let section = `\n${SECTION_INDENT}Configured base branch ${repo.base.configuredRef} not found${remoteSuffix}\n`;
    section += `${SECTION_INDENT}Run 'arb rebase --retarget' to rebase onto the default branch\n`;
    sections.push(section);
  }

  // Ahead of base
  if (verbose?.aheadOfBase && repo.base) {
    const ref = baseRef(repo.base);
    const n = repo.base.newCommitsAfterMerge;
    const total = verbose.aheadOfBase.length;
    const matchedNewCount = n && n > 0 ? verbose.aheadOfBase.slice(0, n).filter((c) => c.matchedOnBase).length : 0;
    const effectiveNew = n && n > 0 ? n - matchedNewCount : 0;
    const mergedCount = n && n > 0 ? total - effectiveNew : 0;
    const headerSuffix =
      n && n > 0 && mergedCount > 0 ? ` ${dim(`(${effectiveNew} new, ${mergedCount} already merged)`)}` : "";
    let section = `\n${SECTION_INDENT}Ahead of ${ref}:${headerSuffix}\n`;
    const mergeHash = repo.base.mergeCommitHash;
    const mergeTag = mergeHash ? dim(` (merged as ${mergeHash.slice(0, 7)})`) : dim(" (already merged)");
    for (let i = 0; i < verbose.aheadOfBase.length; i++) {
      const c = verbose.aheadOfBase[i];
      if (!c) continue;
      let tag: string;
      if (c.matchedOnBase) {
        tag = dim(` (same as ${c.matchedOnBase.shortHash})`);
      } else if (n && n > 0 && i >= n) {
        tag = mergeTag;
      } else {
        tag = "";
      }
      section += `${ITEM_INDENT}${dim(c.shortHash)} ${c.subject}${tag}\n`;
    }
    sections.push(section);
  }

  // Behind base
  if (verbose?.behindBase && repo.base) {
    const ref = baseRef(repo.base);
    let section = `\n${SECTION_INDENT}Behind ${ref}:\n`;
    for (const c of verbose.behindBase) {
      let tag = "";
      if (c.rebaseOf) {
        tag = dim(` (same as ${c.rebaseOf.shortHash})`);
      } else if (c.squashOf && c.squashOf.shortHashes.length > 1) {
        const first = c.squashOf.shortHashes[0] ?? "";
        const last = c.squashOf.shortHashes[c.squashOf.shortHashes.length - 1] ?? "";
        tag = dim(` (squash of ${first}..${last})`);
      }
      section += `${ITEM_INDENT}${dim(c.shortHash)} ${c.subject}${tag}\n`;
    }
    sections.push(section);
  }

  // Unpushed to remote — suppress when merged and all unpushed are already shown in ahead-of-base
  if (verbose?.unpushed && repo.share) {
    const aheadHashes = verbose?.aheadOfBase ? new Set(verbose.aheadOfBase.map((c) => c.hash)) : new Set();
    const allCoveredByAhead = repo.base?.mergedIntoBase && verbose.unpushed.every((c) => aheadHashes.has(c.hash));
    if (!allCoveredByAhead) {
      const shareLabel = repo.share.ref ?? repo.share.remote;
      let section = `\n${SECTION_INDENT}Unpushed to ${shareLabel}:\n`;
      for (const c of verbose.unpushed) {
        const tag = c.rebased ? dim(" (rebased)") : "";
        section += `${ITEM_INDENT}${dim(c.shortHash)} ${c.subject}${tag}\n`;
      }
      sections.push(section);
    }
  }

  // To pull from remote
  if (verbose?.toPull && repo.share) {
    const shareLabel = repo.share.ref ?? repo.share.remote;
    const allSuperseded = verbose.toPull.every((c) => c.superseded);
    const safeSuffix = allSuperseded ? dim("  (safe to force push)") : "";
    let section = `\n${SECTION_INDENT}To pull from ${shareLabel}:${safeSuffix}\n`;
    for (const c of verbose.toPull) {
      const tag = c.superseded ? dim(" (rebased locally)") : "";
      section += `${ITEM_INDENT}${dim(c.shortHash)} ${c.subject}${tag}\n`;
    }
    sections.push(section);
  }

  // File-level detail
  if (verbose?.staged) {
    let section = `\n${SECTION_INDENT}Changes to be committed:\n`;
    for (const f of verbose.staged) {
      section += `${ITEM_INDENT}${formatFileChange(f)}\n`;
    }
    sections.push(section);
  }

  if (verbose?.unstaged) {
    let section = `\n${SECTION_INDENT}Changes not staged for commit:\n`;
    for (const f of verbose.unstaged) {
      section += `${ITEM_INDENT}${formatFileChange(f)}\n`;
    }
    sections.push(section);
  }

  if (verbose?.untracked) {
    let section = `\n${SECTION_INDENT}Untracked files:\n`;
    for (const f of verbose.untracked) {
      section += `${ITEM_INDENT}${f}\n`;
    }
    sections.push(section);
  }

  return sections.join("");
}

// ── Render-model verbose detail (OutputNode[]) ──

export function verboseDetailToNodes(repo: RepoStatus, verbose: VerboseDetail | undefined): OutputNode[] {
  const nodes: OutputNode[] = [];

  // Merged into base
  if (repo.base?.mergedIntoBase) {
    const ref = baseRef(repo.base);
    const strategy = repo.base.mergedIntoBase === "squash" ? "squash" : "merge";
    let headerText = `Branch merged into ${ref} (${strategy})`;
    if (repo.base.detectedPr) {
      const commitSuffix = repo.base.detectedPr.mergeCommit ? ` [${repo.base.detectedPr.mergeCommit.slice(0, 7)}]` : "";
      headerText += repo.base.detectedPr.url
        ? ` — detected PR #${repo.base.detectedPr.number} (${repo.base.detectedPr.url})${commitSuffix}`
        : ` — detected PR #${repo.base.detectedPr.number}${commitSuffix}`;
    }
    nodes.push({ kind: "gap" }, { kind: "section", header: cell(headerText), items: [] });

    if (repo.base.newCommitsAfterMerge && repo.base.newCommitsAfterMerge > 0) {
      const n = repo.base.newCommitsAfterMerge;
      nodes.push({
        kind: "section",
        header: cell(
          `${n} new ${n === 1 ? "commit" : "commits"} after merge — run 'arb rebase' to replay onto updated base`,
          "attention",
        ),
        items: [],
      });
    }
  }

  // Base branch merged into default
  if (repo.base?.baseMergedIntoDefault) {
    const strategy = repo.base.baseMergedIntoDefault === "squash" ? "squash" : "merge";
    const baseName = repo.base.configuredRef ?? repo.base.ref;
    nodes.push(
      { kind: "gap" },
      {
        kind: "section",
        header: cell(`Base branch ${baseName} has been merged into default (${strategy})`),
        items: [],
      },
      { kind: "section", header: cell("Run 'arb rebase --retarget' to rebase onto the default branch"), items: [] },
    );
  }

  // Configured base not found (fell back to default) — skip when base merged already covers it
  if (repo.base?.configuredRef && !repo.base.baseMergedIntoDefault) {
    const remoteSuffix = repo.base.remote ? ` on ${repo.base.remote}` : "";
    nodes.push(
      { kind: "gap" },
      {
        kind: "section",
        header: cell(`Configured base branch ${repo.base.configuredRef} not found${remoteSuffix}`),
        items: [],
      },
      { kind: "section", header: cell("Run 'arb rebase --retarget' to rebase onto the default branch"), items: [] },
    );
  }

  // Ahead of base
  if (verbose?.aheadOfBase && repo.base) {
    const ref = baseRef(repo.base);
    const n = repo.base.newCommitsAfterMerge;
    const total = verbose.aheadOfBase.length;
    const matchedNewCount = n && n > 0 ? verbose.aheadOfBase.slice(0, n).filter((c) => c.matchedOnBase).length : 0;
    const effectiveNew = n && n > 0 ? n - matchedNewCount : 0;
    const mergedCount = n && n > 0 ? total - effectiveNew : 0;

    let header: Cell;
    if (n && n > 0 && mergedCount > 0) {
      header = spans(
        { text: `Ahead of ${ref}:`, attention: "default" },
        { text: ` (${effectiveNew} new, ${mergedCount} already merged)`, attention: "muted" },
      );
    } else {
      header = cell(`Ahead of ${ref}:`);
    }

    const mergeHash = repo.base.mergeCommitHash;
    const mergeTag = mergeHash ? ` (merged as ${mergeHash.slice(0, 7)})` : " (already merged)";
    const items: Cell[] = [];
    for (let i = 0; i < verbose.aheadOfBase.length; i++) {
      const c = verbose.aheadOfBase[i];
      if (!c) continue;
      let commitCell = spans(
        { text: c.shortHash, attention: "muted" },
        { text: ` ${c.subject}`, attention: "default" },
      );
      if (c.matchedOnBase) {
        commitCell = suffix(commitCell, ` (same as ${c.matchedOnBase.shortHash})`, "muted");
      } else if (n && n > 0 && i >= n) {
        commitCell = suffix(commitCell, mergeTag, "muted");
      }
      items.push(commitCell);
    }

    nodes.push({ kind: "gap" }, { kind: "section", header, items });
  }

  // Behind base
  if (verbose?.behindBase && repo.base) {
    const ref = baseRef(repo.base);
    const items: Cell[] = [];
    for (const c of verbose.behindBase) {
      let commitCell = spans(
        { text: c.shortHash, attention: "muted" },
        { text: ` ${c.subject}`, attention: "default" },
      );
      if (c.rebaseOf) {
        commitCell = suffix(commitCell, ` (same as ${c.rebaseOf.shortHash})`, "muted");
      } else if (c.squashOf && c.squashOf.shortHashes.length > 1) {
        const first = c.squashOf.shortHashes[0] ?? "";
        const last = c.squashOf.shortHashes[c.squashOf.shortHashes.length - 1] ?? "";
        commitCell = suffix(commitCell, ` (squash of ${first}..${last})`, "muted");
      }
      items.push(commitCell);
    }

    nodes.push({ kind: "gap" }, { kind: "section", header: cell(`Behind ${ref}:`), items });
  }

  // Unpushed to remote — suppress when merged and all unpushed are already shown in ahead-of-base
  if (verbose?.unpushed && repo.share) {
    const aheadHashes = verbose?.aheadOfBase ? new Set(verbose.aheadOfBase.map((c) => c.hash)) : new Set();
    const allCoveredByAhead = repo.base?.mergedIntoBase && verbose.unpushed.every((c) => aheadHashes.has(c.hash));
    if (!allCoveredByAhead) {
      const shareLabel = repo.share.ref ?? repo.share.remote;
      const items: Cell[] = [];
      for (const c of verbose.unpushed) {
        let commitCell = spans(
          { text: c.shortHash, attention: "muted" },
          { text: ` ${c.subject}`, attention: "default" },
        );
        if (c.rebased) {
          commitCell = suffix(commitCell, " (rebased)", "muted");
        }
        items.push(commitCell);
      }

      nodes.push({ kind: "gap" }, { kind: "section", header: cell(`Unpushed to ${shareLabel}:`), items });
    }
  }

  // To pull from remote
  if (verbose?.toPull && repo.share) {
    const shareLabel = repo.share.ref ?? repo.share.remote;
    const allSuperseded = verbose.toPull.every((c) => c.superseded);
    const header: Cell = allSuperseded
      ? spans(
          { text: `To pull from ${shareLabel}:`, attention: "default" },
          { text: "  (safe to force push)", attention: "muted" },
        )
      : cell(`To pull from ${shareLabel}:`);
    const items: Cell[] = verbose.toPull.map((c) => {
      let commitCell = spans(
        { text: c.shortHash, attention: "muted" },
        { text: ` ${c.subject}`, attention: "default" },
      );
      if (c.superseded) {
        commitCell = suffix(commitCell, " (rebased locally)", "muted");
      }
      return commitCell;
    });
    nodes.push({ kind: "gap" }, { kind: "section", header, items });
  }

  // File-level detail
  if (verbose?.staged) {
    const items: Cell[] = verbose.staged.map((f) => cell(formatFileChange(f)));
    nodes.push({ kind: "gap" }, { kind: "section", header: cell("Changes to be committed:"), items });
  }

  if (verbose?.unstaged) {
    const items: Cell[] = verbose.unstaged.map((f) => cell(formatFileChange(f)));
    nodes.push({ kind: "gap" }, { kind: "section", header: cell("Changes not staged for commit:"), items });
  }

  if (verbose?.untracked) {
    const items: Cell[] = verbose.untracked.map((f) => cell(f));
    nodes.push({ kind: "gap" }, { kind: "section", header: cell("Untracked files:"), items });
  }

  // Trailing gap for row separation
  if (nodes.length > 0) {
    nodes.push({ kind: "gap" });
  }

  return nodes;
}

export function formatVerboseCommits(
  commits: { shortHash: string; subject: string; rebaseOf?: string; squashOf?: string[] }[],
  totalCommits: number,
  label: string,
  options?: {
    diffStats?: { files: number; insertions: number; deletions: number };
    conflictCommits?: { shortHash: string; files: string[] }[];
  },
): string {
  let displayLabel = label;
  if (options?.diffStats) {
    const { files, insertions, deletions } = options.diffStats;
    displayLabel = `${label.replace(/:$/, "")} (${files} ${files === 1 ? "file" : "files"} changed, +${insertions}, -${deletions}):`;
  }
  let out = `\n${SECTION_INDENT}${dim(displayLabel)}\n`;
  // Build a lookup for conflict commits
  const conflictMap = new Map<string, string[]>();
  if (options?.conflictCommits) {
    for (const cc of options.conflictCommits) {
      conflictMap.set(cc.shortHash, cc.files);
    }
  }

  for (const c of commits) {
    let tag = "";
    if (c.rebaseOf) {
      tag = dim(` (same as ${c.rebaseOf})`);
    } else if (c.squashOf && c.squashOf.length > 1) {
      const first = c.squashOf[0] ?? "";
      const last = c.squashOf[c.squashOf.length - 1] ?? "";
      tag = dim(` (squash of ${first}..${last})`);
    }
    const conflictFiles = conflictMap.get(c.shortHash);
    if (conflictFiles) {
      tag += yellow("  (conflict)");
    }
    out += `${ITEM_INDENT}${dim(c.shortHash)} ${c.subject}${tag}\n`;
    if (conflictFiles && conflictFiles.length > 0) {
      out += `${ITEM_INDENT}    ${dim(conflictFiles.join(", "))}\n`;
    }
  }
  if (totalCommits > commits.length) {
    out += `${ITEM_INDENT}${dim(`... and ${totalCommits - commits.length} more`)}\n`;
  }
  out += "\n";
  return out;
}

function formatFileChange(fc: FileChange): string {
  const typeWidth = 12;
  return `${`${fc.type}:`.padEnd(typeWidth)}${fc.file}`;
}

// ── Render-model verbose commits (OutputNode[]) ──

export function verboseCommitsToNodes(
  commits: { shortHash: string; subject: string; rebaseOf?: string; squashOf?: string[] }[],
  totalCommits: number,
  label: string,
  options?: {
    diffStats?: { files: number; insertions: number; deletions: number };
    conflictCommits?: { shortHash: string; files: string[] }[];
  },
): OutputNode[] {
  // Build header cell
  let displayLabel = label;
  if (options?.diffStats) {
    const { files, insertions, deletions } = options.diffStats;
    displayLabel = `${label.replace(/:$/, "")} (${files} ${files === 1 ? "file" : "files"} changed, +${insertions}, -${deletions}):`;
  }
  const header = cell(displayLabel, "muted");

  // Build a lookup for conflict commits
  const conflictMap = new Map<string, string[]>();
  if (options?.conflictCommits) {
    for (const cc of options.conflictCommits) {
      conflictMap.set(cc.shortHash, cc.files);
    }
  }

  // Build item cells
  const items: Cell[] = [];
  for (const c of commits) {
    let commitCell = spans({ text: c.shortHash, attention: "muted" }, { text: ` ${c.subject}`, attention: "default" });

    if (c.rebaseOf) {
      commitCell = suffix(commitCell, ` (same as ${c.rebaseOf})`, "muted");
    } else if (c.squashOf && c.squashOf.length > 1) {
      const first = c.squashOf[0] ?? "";
      const last = c.squashOf[c.squashOf.length - 1] ?? "";
      commitCell = suffix(commitCell, ` (squash of ${first}..${last})`, "muted");
    }

    const conflictFiles = conflictMap.get(c.shortHash);
    if (conflictFiles) {
      commitCell = suffix(commitCell, "  (conflict)", "attention");
    }
    items.push(commitCell);

    // Conflict file sub-item
    if (conflictFiles && conflictFiles.length > 0) {
      items.push(cell(`    ${conflictFiles.join(", ")}`, "muted"));
    }
  }

  if (totalCommits > commits.length) {
    items.push(cell(`... and ${totalCommits - commits.length} more`, "muted"));
  }

  return [{ kind: "gap" }, { kind: "section", header, items }, { kind: "gap" }];
}
