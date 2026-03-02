import type { RepoFlags, RepoStatus } from "./status";

// ── Core Primitives ──

/** Attention levels map to color semantics from GUIDELINES.md */
export type Attention = "default" | "muted" | "attention" | "danger" | "success";

/** A single text span with attention level */
export interface Span {
	text: string;
	attention: Attention;
}

/** Annotated cell: one or more spans + plain text for width measurement */
export interface Cell {
	plain: string;
	spans: Span[];
}

/** Create a cell from text with a single attention level (default: "default") */
export function cell(text: string, attention: Attention = "default"): Cell {
	return { plain: text, spans: [{ text, attention }] };
}

/** Create a cell from multiple spans */
export function spans(...parts: Span[]): Cell {
	let plain = "";
	for (const s of parts) plain += s.text;
	return { plain, spans: parts };
}

/** Join multiple cells with a separator (default: ", ") into a single cell */
export function join(cells: Cell[], separator = ", "): Cell {
	if (cells.length === 0) return cell("");
	if (cells.length === 1) return cells[0] as Cell;
	const allSpans: Span[] = [];
	let plain = "";
	for (let i = 0; i < cells.length; i++) {
		if (i > 0) {
			allSpans.push({ text: separator, attention: "default" });
			plain += separator;
		}
		const c = cells[i] as Cell;
		allSpans.push(...c.spans);
		plain += c.plain;
	}
	return { plain, spans: allSpans };
}

/** Append a span to an existing cell */
export function suffix(base: Cell, text: string, attention: Attention = "default"): Cell {
	return {
		plain: base.plain + text,
		spans: [...base.spans, { text, attention }],
	};
}

/** Empty cell (no text, no spans) */
export const EMPTY_CELL: Cell = { plain: "", spans: [] };

// ── Output Nodes ──

export type OutputNode =
	| TableNode
	| MessageNode
	| SectionNode
	| SummaryNode
	| HintNode
	| RepoHeaderNode
	| GapNode
	| RawTextNode;

export interface TableNode {
	kind: "table";
	columns: TableColumnDef[];
	rows: TableRow[];
}

export interface TableColumnDef {
	header: string;
	key: string;
	show?: boolean;
	group?: string;
	align?: "left" | "right";
	truncate?: { min: number };
}

export interface TableRow {
	cells: Record<string, Cell>;
	marked?: boolean;
	afterRow?: OutputNode[];
}

export interface MessageNode {
	kind: "message";
	level: Attention;
	text: string;
}

export interface SectionNode {
	kind: "section";
	header: Cell;
	items: Cell[];
}

export interface SummaryNode {
	kind: "summary";
	parts: Cell[];
	hasErrors: boolean;
}

export interface HintNode {
	kind: "hint";
	cell: Cell;
}

export interface RepoHeaderNode {
	kind: "repoHeader";
	name: string;
	note?: Cell;
}

export interface GapNode {
	kind: "gap";
}

/** Pre-rendered text passed through without modification (temporary bridge for graph output) */
export interface RawTextNode {
	kind: "rawText";
	text: string;
}

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

/** Compute plain-text SHARE diff */
export function plainRemoteDiff(repo: RepoStatus): string {
	const merged = repo.base?.mergedIntoBase != null;
	const prNumber = repo.base?.detectedPr?.number;
	const prSuffix = prNumber ? ` (#${prNumber})` : "";
	const newCount = repo.base?.newCommitsAfterMerge;
	const pushSuffix = merged && newCount && newCount > 0 ? `, ${newCount} to push` : "";

	if (repo.share.refMode === "gone") {
		if (merged) return `merged${prSuffix}, gone${pushSuffix}`;
		if (repo.base !== null && repo.base.ahead > 0) {
			return `gone, ${repo.base.ahead} to push`;
		}
		return "gone";
	}

	if (repo.share.refMode === "noRef") {
		if (repo.base !== null && repo.base.ahead > 0) return `${repo.base.ahead} to push`;
		return "not pushed";
	}

	if (merged && (repo.share.toPull ?? 0) === 0) return `merged${prSuffix}${pushSuffix}`;
	const toPush = repo.share.toPush ?? 0;
	const toPull = repo.share.toPull ?? 0;
	if (toPush === 0 && toPull === 0) return "up to date";

	const rebased = repo.share.rebased;
	if (rebased !== null && rebased > 0) {
		const newPush = Math.max(0, toPush - rebased);
		const newPull = Math.max(0, toPull - rebased);
		const parts: string[] = [];
		if (newPush > 0) parts.push(`${newPush} to push`);
		if (newPull > 0) parts.push(`${newPull} to pull`);
		parts.push(`${rebased} rebased`);
		return parts.join(", ");
	}

	const parts = [toPush > 0 && `${toPush} to push`, toPull > 0 && `${toPull} to pull`].filter(Boolean).join(", ");
	return parts;
}

/** Analyze the SHARE diff cell — multi-span for merged+new work */
export function analyzeRemoteDiff(repo: RepoStatus, flags: RepoFlags): Cell {
	const isDetached = repo.identity.headMode.kind === "detached";
	if (isDetached) return EMPTY_CELL;

	const text = plainRemoteDiff(repo);
	if (!text) return EMPTY_CELL;

	// Simple non-attention cases
	if (text === "up to date" || text === "gone") return cell(text);
	if (text === "not pushed") return cell(text);

	// Behind-only (pull from share, nothing to push)
	if (repo.share.toPush === 0 && repo.share.toPull !== null && repo.share.toPull > 0) {
		return cell(text);
	}

	// Merged with new work — color only the "N to push" portion
	if (repo.base?.newCommitsAfterMerge && repo.base.newCommitsAfterMerge > 0) {
		const pushIdx = text.lastIndexOf(", ");
		if (pushIdx >= 0 && text.includes("to push")) {
			const prefix = text.slice(0, pushIdx + 2);
			const pushPart = text.slice(pushIdx + 2);
			return spans({ text: prefix, attention: "default" }, { text: pushPart, attention: "attention" });
		}
		return cell(text);
	}

	// Unpushed — check for rebased-only (no attention needed)
	if (flags.isUnpushed) {
		const rebased = repo.share.rebased ?? 0;
		const netNew = (repo.share.toPush ?? 0) - rebased;
		if (rebased > 0 && netNew <= 0) {
			return cell(text); // rebased-only, default color
		}
		return cell(text, "attention");
	}

	return cell(text);
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
