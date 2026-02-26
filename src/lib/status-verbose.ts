import { type FileChange, detectRebasedCommits, getCommitsBetweenFull, parseGitStatusFiles } from "./git";
import type { StatusJsonRepo } from "./json-types";
import { dim } from "./output";
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
	aheadOfBase?: VerboseCommit[];
	behindBase?: VerboseCommit[];
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
			verbose.behindBase = commits.map((c) => ({ hash: c.fullHash, shortHash: c.shortHash, subject: c.subject }));
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

export function toJsonVerbose(detail: VerboseDetail): StatusJsonRepo["verbose"] {
	const { aheadOfBase, behindBase, unpushed, ...rest } = detail;
	const stripShort = ({ hash, subject }: VerboseCommit) => ({ hash, subject });
	return {
		...rest,
		...(aheadOfBase && { aheadOfBase: aheadOfBase.map(stripShort) }),
		...(behindBase && { behindBase: behindBase.map(stripShort) }),
		...(unpushed && { unpushed: unpushed.map(({ hash, subject, rebased }) => ({ hash, subject, rebased })) }),
	};
}

export async function printVerboseDetail(repo: RepoStatus, wsDir: string): Promise<void> {
	const sections: string[] = [];

	// Merged into base
	if (repo.base?.mergedIntoBase) {
		const ref = baseRef(repo.base);
		const strategy = repo.base.mergedIntoBase === "squash" ? "squash" : "merge";
		sections.push(`\n${SECTION_INDENT}Branch merged into ${ref} (${strategy})\n`);
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

	// Gather structured verbose data
	const verbose = await gatherVerboseDetail(repo, wsDir);

	// Ahead of base
	if (verbose?.aheadOfBase && repo.base) {
		const ref = baseRef(repo.base);
		let section = `\n${SECTION_INDENT}Ahead of ${ref}:\n`;
		for (const c of verbose.aheadOfBase) {
			section += `${ITEM_INDENT}${dim(c.shortHash)} ${c.subject}\n`;
		}
		sections.push(section);
	}

	// Behind base
	if (verbose?.behindBase && repo.base) {
		const ref = baseRef(repo.base);
		let section = `\n${SECTION_INDENT}Behind ${ref}:\n`;
		for (const c of verbose.behindBase) {
			section += `${ITEM_INDENT}${dim(c.shortHash)} ${c.subject}\n`;
		}
		sections.push(section);
	}

	// Unpushed to remote
	if (verbose?.unpushed && repo.share) {
		const shareLabel = repo.share.remote;
		let section = `\n${SECTION_INDENT}Unpushed to ${shareLabel}:\n`;
		for (const c of verbose.unpushed) {
			const tag = c.rebased ? dim(" (rebased)") : "";
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

	for (const section of sections) {
		process.stdout.write(section);
	}
}

export function formatVerboseCommits(
	commits: { shortHash: string; subject: string }[],
	totalCommits: number,
	label: string,
): string {
	let out = `\n${SECTION_INDENT}${dim(label)}\n`;
	for (const c of commits) {
		out += `${ITEM_INDENT}${dim(c.shortHash)} ${c.subject}\n`;
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
