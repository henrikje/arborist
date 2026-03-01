import {
	type FileChange,
	detectRebasedCommits,
	getCommitsBetweenFull,
	matchDivergedCommits,
	parseGitStatusFiles,
	verifySquashRange,
} from "./git";
import type { StatusJsonRepo } from "./json-types";
import { dim, yellow } from "./output";
import { type RepoStatus, baseRef } from "./status";

export const SECTION_INDENT = "      ";
export const ITEM_INDENT = "          ";
export const VERBOSE_COMMIT_LIMIT = 25;

// Internal verbose type — carries shortHash for text display alongside fullHash for JSON
interface VerboseCommit {
	hash: string;
	shortHash: string;
	subject: string;
}
interface VerboseDetail {
	aheadOfBase?: (VerboseCommit & { matchedOnBase?: { hash: string; shortHash: string } })[];
	behindBase?: (VerboseCommit & {
		rebaseOf?: { hash: string; shortHash: string };
		squashOf?: { hashes: string[]; shortHashes: string[] };
	})[];
	unpushed?: (VerboseCommit & { rebased: boolean })[];
	staged?: NonNullable<StatusJsonRepo["verbose"]>["staged"];
	unstaged?: NonNullable<StatusJsonRepo["verbose"]>["unstaged"];
	untracked?: string[];
}

export async function gatherVerboseDetail(repo: RepoStatus, wsDir: string): Promise<VerboseDetail | undefined> {
	const repoDir = `${wsDir}/${repo.name}`;
	const verbose: VerboseDetail = {};

	// Ahead of base (suppress when base fell back — numbers are against the fallback, not the configured base)
	if (repo.base && repo.base.ahead > 0 && !repo.base.configuredRef) {
		const ref = baseRef(repo.base);
		const commits = await getCommitsBetweenFull(repoDir, ref, "HEAD");
		if (commits.length > 0) {
			verbose.aheadOfBase = commits.map((c) => ({ hash: c.fullHash, shortHash: c.shortHash, subject: c.subject }));
		}
	}

	// Behind base (suppress when base fell back)
	if (repo.base && repo.base.behind > 0 && !repo.base.configuredRef) {
		const ref = baseRef(repo.base);
		const commits = await getCommitsBetweenFull(repoDir, "HEAD", ref);
		if (commits.length > 0) {
			// When diverged, match incoming commits against local commits
			let rebaseMap: Map<string, string> | undefined;
			let squashMatch: { incomingHash: string; localHashes: string[] } | undefined;
			if (repo.base.ahead > 0) {
				const matchResult = await matchDivergedCommits(repoDir, ref);
				if (matchResult.rebaseMatches.size > 0) rebaseMap = matchResult.rebaseMatches;
				if (matchResult.squashMatch) squashMatch = matchResult.squashMatch;
			}

			// Build a local hash → shortHash lookup from aheadOfBase (already gathered)
			const localHashToShort = new Map<string, string>();
			if (verbose.aheadOfBase) {
				for (const c of verbose.aheadOfBase) localHashToShort.set(c.hash, c.shortHash);
			}

			verbose.behindBase = commits.map((c) => {
				const entry: NonNullable<VerboseDetail["behindBase"]>[number] = {
					hash: c.fullHash,
					shortHash: c.shortHash,
					subject: c.subject,
				};
				if (rebaseMap?.has(c.fullHash)) {
					const localHash = rebaseMap.get(c.fullHash) ?? c.fullHash;
					entry.rebaseOf = { hash: localHash, shortHash: localHashToShort.get(localHash) ?? localHash.slice(0, 7) };
				} else if (squashMatch && c.fullHash === squashMatch.incomingHash) {
					entry.squashOf = {
						hashes: squashMatch.localHashes,
						shortHashes: squashMatch.localHashes.map((h) => localHashToShort.get(h) ?? h.slice(0, 7)),
					};
				}
				return entry;
			});
		}
	}

	// Cross-reference: annotate ahead commits that have a rebase match on base
	if (verbose.aheadOfBase && verbose.behindBase) {
		const localToIncoming = new Map<string, { hash: string; shortHash: string }>();
		for (const c of verbose.behindBase) {
			if (c.rebaseOf) localToIncoming.set(c.rebaseOf.hash, { hash: c.hash, shortHash: c.shortHash });
		}
		if (localToIncoming.size > 0) {
			for (const c of verbose.aheadOfBase) {
				const match = localToIncoming.get(c.hash);
				if (match) c.matchedOnBase = match;
			}
		}
	}

	// Verify and populate squashOf on the squash commit in behindBase
	if (
		verbose.aheadOfBase &&
		verbose.behindBase &&
		repo.base?.mergedIntoBase === "squash" &&
		repo.base.mergeCommitHash &&
		repo.base.newCommitsAfterMerge
	) {
		const n = repo.base.newCommitsAfterMerge;
		const mergedCommits = verbose.aheadOfBase.slice(n);
		const squashEntry = verbose.behindBase.find((c) => c.hash === repo.base?.mergeCommitHash && !c.squashOf);
		if (squashEntry && mergedCommits.length > 1) {
			const ref = baseRef(repo.base);
			const verified = await verifySquashRange(repoDir, ref, repo.base.mergeCommitHash, n);
			if (verified) {
				const reversed = [...mergedCommits].reverse();
				squashEntry.squashOf = {
					hashes: reversed.map((m) => m.hash),
					shortHashes: reversed.map((m) => m.shortHash),
				};
			}
		}
	}

	// Unpushed to remote
	if (repo.share.toPush !== null && repo.share.toPush > 0 && repo.share.ref) {
		let rebasedHashes: Set<string> | null = null;
		if (repo.share.rebased != null && repo.share.rebased > 0) {
			const detection = await detectRebasedCommits(repoDir, repo.share.ref);
			rebasedHashes = detection?.rebasedLocalHashes ?? null;
		}
		const commits = await getCommitsBetweenFull(repoDir, repo.share.ref, "HEAD");
		if (commits.length > 0) {
			verbose.unpushed = commits.map((c) => ({
				hash: c.fullHash,
				shortHash: c.shortHash,
				subject: c.subject,
				rebased: rebasedHashes?.has(c.fullHash) ?? false,
			}));
		}
	}

	// File-level detail
	if (repo.local.staged > 0 || repo.local.modified > 0 || repo.local.untracked > 0 || repo.local.conflicts > 0) {
		const files = await parseGitStatusFiles(repoDir);
		if (files.staged.length > 0) verbose.staged = files.staged;
		if (files.unstaged.length > 0)
			verbose.unstaged = files.unstaged.map((f) => ({
				file: f.file,
				type: f.type as "modified" | "deleted",
			}));
		if (files.untracked.length > 0) verbose.untracked = files.untracked;
	}

	return Object.keys(verbose).length > 0 ? verbose : undefined;
}

export function toJsonVerbose(
	detail: VerboseDetail,
	base?: { newCommitsAfterMerge?: number; mergeCommitHash?: string } | null,
): StatusJsonRepo["verbose"] {
	const { aheadOfBase, behindBase, unpushed, ...rest } = detail;
	const stripShort = ({ hash, subject }: VerboseCommit) => ({ hash, subject });
	const n = base?.newCommitsAfterMerge;
	const mergeHash = base?.mergeCommitHash;
	return {
		...rest,
		...(aheadOfBase && {
			aheadOfBase: aheadOfBase.map((c, i) => ({
				...stripShort(c),
				...(c.matchedOnBase ? { mergedAs: c.matchedOnBase.hash } : {}),
				...(n && n > 0 && i >= n && mergeHash && !c.matchedOnBase ? { mergedAs: mergeHash } : {}),
			})),
		}),
		...(behindBase && {
			behindBase: behindBase.map((c) => ({
				hash: c.hash,
				subject: c.subject,
				...(c.rebaseOf && { rebaseOf: c.rebaseOf.hash }),
				...(c.squashOf && { squashOf: c.squashOf.hashes }),
			})),
		}),
		...(unpushed && { unpushed: unpushed.map(({ hash, subject, rebased }) => ({ hash, subject, rebased })) }),
	};
}

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
