import type { RepoAssessment } from "./integrate";
import { dim } from "./output";
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
 *     * feat/xyz  HEAD  (2 commits to replay)
 *     |
 *   --x-- feat/auth  (old base, merged)
 *     :
 *     * origin/main  (new base)
 */
export function formatBranchGraph(assessment: RepoAssessment, branch: string, verbose: boolean): string {
	const baseRef = `${assessment.baseRemote}/${assessment.baseBranch}`;

	if (assessment.retargetFrom) {
		return formatRetargetGraph(assessment, branch, baseRef, verbose);
	}
	return formatNormalGraph(assessment, branch, baseRef, verbose);
}

function formatNormalGraph(a: RepoAssessment, branch: string, baseRef: string, verbose: boolean): string {
	let out = "\n";
	const P = SECTION_INDENT; // prefix for graph lines (6 spaces)

	// Fast-forward case: ahead === 0, HEAD is at the merge-base
	if (a.ahead === 0) {
		const mbLabel = a.mergeBaseSha ? `  (${a.mergeBaseSha})` : "";
		out += `${P}${dim(`* ${branch}  HEAD  (at merge-base${mbLabel})`)}\n`;
		out += `${P}${dim("|")}\n`;
		out += `${P}${dim(`* ${baseRef}  (${a.behind} behind)`)}\n`;
		if (verbose && a.commits && a.commits.length > 0) {
			out += formatInlineCommits(a.commits, a.totalCommits ?? a.commits.length);
		}
		out += "\n";
		return out;
	}

	// Feature branch on top
	const aheadLabel = `${a.ahead} ahead`;
	out += `${P}${dim("*")} ${branch}  HEAD  ${dim(`(${aheadLabel})`)}\n`;

	// Outgoing commits (verbose + graph)
	if (verbose && a.outgoingCommits && a.outgoingCommits.length > 0) {
		out += formatInlineCommits(a.outgoingCommits, a.totalOutgoingCommits ?? a.outgoingCommits.length);
	} else {
		out += `${P}${dim("|")}\n`;
	}

	// Merge-base
	const mbSha = a.mergeBaseSha ? `  (${a.mergeBaseSha})` : "";
	out += `${P}${dim(`--o-- merge-base${mbSha}`)}\n`;

	// Connector
	out += `${P}${dim("|")}\n`;

	// Base branch on bottom
	const behindLabel = `${a.behind} behind`;
	out += `${P}${dim("*")} ${baseRef}  ${dim(`(${behindLabel})`)}\n`;

	// Incoming commits (verbose + graph)
	if (verbose && a.commits && a.commits.length > 0) {
		out += formatInlineCommits(a.commits, a.totalCommits ?? a.commits.length);
	}

	out += "\n";
	return out;
}

function formatRetargetGraph(a: RepoAssessment, branch: string, baseRef: string, verbose: boolean): string {
	let out = "\n";
	const P = SECTION_INDENT;

	// Feature branch on top
	const replayLabel = a.ahead > 0 ? `${a.ahead} commits to replay` : "at cut point";
	out += `${P}${dim("*")} ${branch}  HEAD  ${dim(`(${replayLabel})`)}\n`;

	// Outgoing commits (verbose + graph)
	if (verbose && a.outgoingCommits && a.outgoingCommits.length > 0) {
		out += formatInlineCommits(a.outgoingCommits, a.totalOutgoingCommits ?? a.outgoingCommits.length);
	} else {
		out += `${P}${dim("|")}\n`;
	}

	// Cut point (old base)
	const mbSha = a.mergeBaseSha ? ` (${a.mergeBaseSha})` : "";
	out += `${P}${dim(`--x-- ${a.retargetFrom}  (old base, merged)${mbSha}`)}\n`;

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
