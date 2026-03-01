import { dim, yellow } from "./output";
import { BENIGN_SKIPS, type SkipFlag } from "./skip-flags";

export interface ActionPair {
	value: string;
	render: string;
}

export function skipAction(skipReason: string, skipFlag?: SkipFlag): ActionPair {
	const text = `skipped \u2014 ${skipReason}`;
	const style = skipFlag && BENIGN_SKIPS.has(skipFlag) ? dim : yellow;
	return { value: text, render: style(text) };
}

export function upToDateAction(): ActionPair {
	return { value: "up to date", render: "up to date" };
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
