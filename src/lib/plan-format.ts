import { dim, yellow } from "./output";
import { BENIGN_SKIPS, type SkipFlag } from "./skip-flags";

export function formatSkipLine(repo: string, skipReason: string, skipFlag?: SkipFlag): string {
	const style = skipFlag && BENIGN_SKIPS.has(skipFlag) ? dim : yellow;
	return `  ${style(`${repo}   skipped \u2014 ${skipReason}`)}\n`;
}

export function formatUpToDateLine(repo: string): string {
	return `  ${repo}   up to date\n`;
}

export function formatStashHint(assessment: {
	needsStash?: boolean;
	stashPopConflictFiles?: string[] | null;
}): string {
	if (!assessment.needsStash) return "";
	if (assessment.stashPopConflictFiles && assessment.stashPopConflictFiles.length > 0) {
		return ` ${yellow("(autostash, stash pop conflict likely)")}`;
	}
	if (assessment.stashPopConflictFiles) {
		return " (autostash, stash pop conflict unlikely)";
	}
	return " (autostash)";
}
