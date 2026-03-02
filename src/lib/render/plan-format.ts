import { BENIGN_SKIPS, type SkipFlag } from "../status/skip-flags";
import { type Cell, cell, suffix } from "./model";

export function skipCell(skipReason: string, skipFlag?: SkipFlag): Cell {
	const text = `skipped \u2014 ${skipReason}`;
	const benign = skipFlag != null && BENIGN_SKIPS.has(skipFlag);
	return cell(text, benign ? "muted" : "attention");
}

export function upToDateCell(): Cell {
	return cell("up to date");
}

export function stashHintCell(assessment: {
	needsStash?: boolean;
	stashPopConflictFiles?: string[] | null;
}): Cell | null {
	if (!assessment.needsStash) return null;
	if (assessment.stashPopConflictFiles && assessment.stashPopConflictFiles.length > 0) {
		return cell(" (autostash, stash pop conflict likely)", "attention");
	}
	if (assessment.stashPopConflictFiles) {
		return cell(" (autostash, stash pop conflict unlikely)");
	}
	return cell(" (autostash)");
}

export function headShaCell(sha: string): Cell {
	return cell(`  (HEAD ${sha})`, "muted");
}

/** Append stash hint and HEAD sha suffix to a base cell */
export function withSuffixes(
	base: Cell,
	assessment: { needsStash?: boolean; stashPopConflictFiles?: string[] | null; headSha?: string },
): Cell {
	let result = base;
	const stash = stashHintCell(assessment);
	if (stash) {
		result = suffix(result, stash.plain, stash.spans[0]?.attention ?? "default");
	}
	if (assessment.headSha) {
		result = suffix(result, `  (HEAD ${assessment.headSha})`, "muted");
	}
	return result;
}
