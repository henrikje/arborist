import { AT_RISK_FLAGS, FLAG_LABELS, MERGED_IMPLIED_FLAGS } from "../status/status";
import type { RepoFlags, RepoStatus, WorkspaceSummary } from "../status/status";
import { yellow } from "../terminal/output";
import { type Cell, EMPTY_CELL, cell, join, spans, suffix } from "./model";

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

/** Compute plain-text BASE diff */
export function plainBaseDiff(base: NonNullable<RepoStatus["base"]>): string {
	if (base.mergedIntoBase != null) return "merged";
	if (base.baseMergedIntoDefault != null) return "base merged";
	const parts = [base.ahead > 0 && `${base.ahead} ahead`, base.behind > 0 && `${base.behind} behind`]
		.filter(Boolean)
		.join(", ");
	return parts || "equal";
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

/** Compute push/pull text parts for the SHARE diff cell separately.
 * `pullNewText` is the "N new" suffix of `pull` when it deserves attention (rebased detected, genuinely new remote content). */
function remoteDiffParts(repo: RepoStatus): { push: string; pull: string; pullNewText: string } {
	const merged = repo.base?.mergedIntoBase != null;
	const prNumber = repo.base?.detectedPr?.number;
	const prSuffix = prNumber ? ` (#${prNumber})` : "";
	const newCommits = repo.base?.newCommitsAfterMerge;
	const pushSuffix = merged && newCommits && newCommits > 0 ? `, ${newCommits} to push` : "";

	if (repo.share.refMode === "gone") {
		if (merged) return { push: `merged${prSuffix}, gone${pushSuffix}`, pull: "", pullNewText: "" };
		if (repo.base !== null && repo.base.ahead > 0) return { push: `gone, ${repo.base.ahead} to push`, pull: "", pullNewText: "" };
		return { push: "gone", pull: "", pullNewText: "" };
	}

	if (repo.share.refMode === "noRef") {
		if (repo.base !== null && repo.base.ahead > 0) return { push: `${repo.base.ahead} to push`, pull: "", pullNewText: "" };
		return { push: "not pushed", pull: "", pullNewText: "" };
	}

	if (merged && (repo.share.toPull ?? 0) === 0) return { push: `merged${prSuffix}${pushSuffix}`, pull: "", pullNewText: "" };

	const toPush = repo.share.toPush ?? 0;
	const toPull = repo.share.toPull ?? 0;
	if (toPush === 0 && toPull === 0) return { push: "up to date", pull: "", pullNewText: "" };

	const rebased = repo.share.rebased;

	// rebased detection ran (implies both toPush > 0 and toPull > 0 at time of detection)
	if (rebased !== null) {
		const baseAhead = repo.base?.ahead ?? null;
		const pushParts: string[] = [];

		if (baseAhead !== null) {
			// Three-way split: fromBase / rebased / new
			const fromBase = Math.max(0, toPush - baseAhead);
			const newCount = Math.max(0, baseAhead - rebased);
			const baseLabel = repo.base?.ref ?? "base";
			if (fromBase > 0) pushParts.push(`${fromBase} from ${baseLabel}`);
			if (rebased > 0) pushParts.push(`${rebased} rebased`);
			if (newCount > 0) pushParts.push(`${newCount} new`);
		} else {
			// Fallback: no base info
			const newPush = Math.max(0, toPush - rebased);
			if (newPush > 0) pushParts.push(`${newPush} to push`);
			if (rebased > 0) pushParts.push(`${rebased} rebased`);
		}

		// Pull side: outdated first (already incorporated), then new (genuinely new remote content)
		const pullParts: string[] = [];
		let pullNewText = "";
		if (toPull > 0) {
			const outdated = rebased > 0 ? Math.min(rebased, toPull) : 0;
			const newPull = Math.max(0, toPull - rebased);
			if (outdated > 0) pullParts.push(`${outdated} outdated`);
			if (newPull > 0) {
				pullNewText = `${newPull} new`;
				pullParts.push(pullNewText);
			}
		}

		return { push: pushParts.filter(Boolean).join(", "), pull: pullParts.join(", "), pullNewText };
	}

	// rebased not computed (only one of push/pull is active)
	return {
		push: toPush > 0 ? `${toPush} to push` : "",
		pull: toPull > 0 ? `${toPull} to pull` : "",
		pullNewText: "",
	};
}

/** Compute plain-text SHARE diff */
export function plainRemoteDiff(repo: RepoStatus): string {
	const { push, pull } = remoteDiffParts(repo);
	if (push && pull) return `${push} → ${pull}`;
	return push || pull || "";
}

/** Analyze the SHARE diff cell — arrow separator between push and pull sides */
export function analyzeRemoteDiff(repo: RepoStatus, flags: RepoFlags): Cell {
	const isDetached = repo.identity.headMode.kind === "detached";
	if (isDetached) return EMPTY_CELL;

	const { push: pushText, pull: pullText, pullNewText } = remoteDiffParts(repo);
	if (!pushText && !pullText) return EMPTY_CELL;

	// Simple non-attention cases (no push activity)
	if (!pushText) return cell(pullText);
	if (pushText === "up to date" || pushText === "gone" || pushText === "not pushed") return cell(pushText);

	// Behind-only: already handled above (pushText empty)

	// Determine push-side attention
	const rebased = repo.share.rebased ?? 0;
	const baseAhead = repo.base?.ahead ?? repo.share.toPush ?? 0;
	const newCount = baseAhead - rebased;
	const pushNeedsAttention = flags.isUnpushed && (rebased === 0 || newCount > 0);

	// Merged with new work — color only the push suffix portion
	if (repo.base?.newCommitsAfterMerge && repo.base.newCommitsAfterMerge > 0 && !pullText) {
		const text = pushText;
		const pushIdx = text.lastIndexOf(", ");
		if (pushIdx >= 0 && text.includes("to push")) {
			const prefix = text.slice(0, pushIdx + 2);
			const pushPart = text.slice(pushIdx + 2);
			return spans({ text: prefix, attention: "default" }, { text: pushPart, attention: "attention" });
		}
		return cell(text);
	}

	const pushAttention = pushNeedsAttention ? "attention" : "default";

	// Push-only: single span
	if (!pullText) return cell(pushText, pushAttention);

	// Both sides: push | arrow (muted) | pull (with "N new" highlighted when present)
	if (pullNewText && pullText !== pullNewText) {
		// Has outdated + new: "M outdated, K new" — highlight "K new" with attention
		const outdatedPortion = pullText.slice(0, pullText.length - pullNewText.length - 2);
		return spans(
			{ text: pushText, attention: pushAttention },
			{ text: " → ", attention: "muted" },
			{ text: outdatedPortion + ", ", attention: "default" },
			{ text: pullNewText, attention: "attention" },
		);
	}
	if (pullNewText) {
		// Pull is only "K new"
		return spans(
			{ text: pushText, attention: pushAttention },
			{ text: " → ", attention: "muted" },
			{ text: pullText, attention: "attention" },
		);
	}
	return spans(
		{ text: pushText, attention: pushAttention },
		{ text: " → ", attention: "muted" },
		{ text: pullText, attention: "default" },
	);
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
	rebasedOnlyCount = 0,
	yellowKeys: Set<keyof RepoFlags> = AT_RISK_FLAGS,
): string {
	return statusCounts
		.flatMap(({ label, key, count }) => {
			if (key === "isUnpushed" && rebasedOnlyCount > 0) {
				const genuine = count - rebasedOnlyCount;
				const parts: string[] = [];
				if (genuine > 0) parts.push(yellow(label));
				parts.push("rebased");
				return parts;
			}
			return [yellowKeys.has(key) ? yellow(label) : label];
		})
		.join(", ");
}

export function buildStatusCountsCell(
	statusCounts: WorkspaceSummary["statusCounts"],
	rebasedOnlyCount = 0,
	atRiskKeys: Set<keyof RepoFlags> = AT_RISK_FLAGS,
): Cell {
	const parts: Cell[] = statusCounts.flatMap(({ label, key, count }) => {
		if (key === "isUnpushed" && rebasedOnlyCount > 0) {
			const genuine = count - rebasedOnlyCount;
			const cells: Cell[] = [];
			if (genuine > 0) cells.push(cell(label, "attention"));
			cells.push(cell("rebased"));
			return cells;
		}
		return [cell(label, atRiskKeys.has(key) ? "attention" : "default")];
	});
	return join(parts);
}
