import type { RepoAssessment } from "../sync/types";
import { dim } from "../terminal/output";
import { SECTION_INDENT } from "./status-verbose";

/**
 * Renders a compact vertical branch divergence graph for a single repo assessment.
 *
 * Normal case (diverged):
 *     * feat/xyz  HEAD  (2 ahead)
 *     |
 *   --o-- merge-base  (ghi9012)
 *     |
 *     * origin/main  (3 behind)
 *
 * Retarget case:
 *     * feat/xyz  HEAD  (2 commits to rebase)
 *     |
 *   --x-- feat/auth  (old base, merged)
 *     :
 *     * origin/main  (new base)
 */
export function formatBranchGraph(assessment: RepoAssessment, branch: string, verbose: boolean): string {
  const baseRef = `${assessment.baseRemote}/${assessment.baseBranch}`;

  if (assessment.retarget?.from) {
    return formatRetargetGraph(assessment, branch, baseRef, verbose);
  }
  return formatNormalGraph(assessment, branch, baseRef, verbose);
}

function formatNormalGraph(a: RepoAssessment, branch: string, baseRef: string, verbose: boolean): string {
  let out = "\n";
  const P = SECTION_INDENT; // prefix for graph lines (6 spaces)

  // Fast-forward case: ahead === 0, HEAD is at the merge-base
  if (a.ahead === 0) {
    const mbLabel = a.verbose?.mergeBaseSha ? `  (${a.verbose.mergeBaseSha})` : "";
    out += `${P}${dim(`* ${branch}  HEAD  (at merge-base${mbLabel})`)}\n`;
    out += `${P}${dim("|")}\n`;
    out += `${P}${dim(`* ${baseRef}  (${a.behind} behind)`)}\n`;
    if (verbose && a.verbose?.commits && a.verbose.commits.length > 0) {
      out += formatInlineCommits(a.verbose.commits, a.verbose.totalCommits ?? a.verbose.commits.length);
    }
    out += "\n";
    return out;
  }

  // Feature branch on top
  const aheadLabel = `${a.ahead} ahead`;
  out += `${P}${dim("*")} ${branch}  HEAD  ${dim(`(${aheadLabel})`)}\n`;

  // Outgoing commits (verbose + graph)
  if (verbose && a.verbose?.outgoingCommits && a.verbose.outgoingCommits.length > 0) {
    out += formatInlineCommits(
      a.verbose.outgoingCommits,
      a.verbose.totalOutgoingCommits ?? a.verbose.outgoingCommits.length,
    );
  } else {
    out += `${P}${dim("|")}\n`;
  }

  // Merge-base
  const mbSha = a.verbose?.mergeBaseSha ? `  (${a.verbose.mergeBaseSha})` : "";
  out += `${P}${dim(`--o-- merge-base${mbSha}`)}\n`;

  // Connector
  out += `${P}${dim("|")}\n`;

  // Base branch on bottom
  const behindLabel = `${a.behind} behind`;
  out += `${P}${dim("*")} ${baseRef}  ${dim(`(${behindLabel})`)}\n`;

  // Incoming commits (verbose + graph)
  if (verbose && a.verbose?.commits && a.verbose.commits.length > 0) {
    out += formatInlineCommits(a.verbose.commits, a.verbose.totalCommits ?? a.verbose.commits.length);
  }

  out += "\n";
  return out;
}

function formatRetargetGraph(a: RepoAssessment, branch: string, baseRef: string, verbose: boolean): string {
  let out = "\n";
  const P = SECTION_INDENT;

  // Feature branch on top
  let replayLabel: string;
  if (a.retarget?.alreadyOnTarget != null && a.retarget.alreadyOnTarget > 0) {
    const total = (a.retarget.replayCount ?? 0) + a.retarget.alreadyOnTarget;
    replayLabel = `${total} local, ${a.retarget.alreadyOnTarget} already on target, ${a.retarget.replayCount ?? 0} to rebase`;
  } else if (a.retarget?.replayCount != null && a.retarget.replayCount > 0) {
    replayLabel = `${a.retarget.replayCount} to rebase`;
  } else if (a.ahead > 0) {
    replayLabel = `${a.ahead} commits to rebase`;
  } else {
    replayLabel = "at cut point";
  }
  out += `${P}${dim("*")} ${branch}  HEAD  ${dim(`(${replayLabel})`)}\n`;

  // Outgoing commits (verbose + graph)
  if (verbose && a.verbose?.outgoingCommits && a.verbose.outgoingCommits.length > 0) {
    out += formatInlineCommits(
      a.verbose.outgoingCommits,
      a.verbose.totalOutgoingCommits ?? a.verbose.outgoingCommits.length,
    );
  } else {
    out += `${P}${dim("|")}\n`;
  }

  // Cut point (old base)
  const mbSha = a.verbose?.mergeBaseSha ? ` (${a.verbose.mergeBaseSha})` : "";
  out += `${P}${dim(`--x-- ${a.retarget?.from}  (old base, merged)${mbSha}`)}\n`;

  // Dotted connector to new base
  out += `${P}${dim(":")}\n`;

  // New base
  out += `${P}${dim("*")} ${baseRef}  ${dim("(new base)")}\n`;

  out += "\n";
  return out;
}

function formatInlineCommits(commits: { shortHash: string; subject: string }[], totalCommits: number): string {
  const P = SECTION_INDENT;
  let out = "";
  for (const c of commits) {
    out += `${P}${dim(`| ${c.shortHash}`)} ${c.subject}\n`;
  }
  if (totalCommits > commits.length) {
    out += `${P}${dim(`| ... and ${totalCommits - commits.length} more`)}\n`;
  }
  out += `${P}${dim("|")}\n`;
  return out;
}
