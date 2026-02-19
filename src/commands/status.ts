import { resolve } from "node:path";
import type { Command } from "commander";
import {
	type FileChange,
	detectRebasedCommits,
	getCommitsBetween,
	getCommitsBetweenFull,
	parseGitStatusFiles,
	predictMergeConflict,
} from "../lib/git";
import type { StatusJsonOutput } from "../lib/json-types";
import { dim, green, yellow } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { resolveRemotesMap } from "../lib/remotes";
import { classifyRepos } from "../lib/repos";
import {
	type RepoStatus,
	computeFlags,
	computeSummaryAggregates,
	gatherWorkspaceSummary,
	repoMatchesWhere,
	validateWhere,
} from "../lib/status";
import {
	type RelativeTimeParts,
	computeLastCommitWidths,
	formatLastCommitCell,
	formatRelativeTimeParts,
} from "../lib/time";
import { isTTY } from "../lib/tty";
import type { ArbContext } from "../lib/types";
import { requireWorkspace } from "../lib/workspace-context";

export function registerStatusCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("status")
		.option("-d, --dirty", "Only show repos with local changes (shorthand for --where dirty)")
		.option("-w, --where <filter>", "Filter repos by status flags (comma-separated, OR logic)")
		.option("-f, --fetch", "Fetch from all remotes before showing status")
		.option("-v, --verbose", "Show file-level detail for each repo")
		.option("--json", "Output structured JSON")
		.summary("Show workspace status")
		.description(
			"Show each worktree's position relative to the default branch, push status against the share remote, and local changes (staged, modified, untracked). The summary includes the workspace's last commit date (most recent author date across all repos).\n\nUse --dirty to only show worktrees with uncommitted changes. Use --where <filter> to filter by any status flag: dirty, unpushed, behind-share, behind-base, diverged, drifted, detached, operation, local, gone, shallow, merged, base-merged, base-missing, at-risk. Comma-separated values use OR logic (e.g. --where dirty,unpushed). Use --fetch to update remote tracking info first. Use --verbose for file-level detail. Use --json for machine-readable output.",
		)
		.action(
			async (options: {
				dirty?: boolean;
				where?: string;
				fetch?: boolean;
				verbose?: boolean;
				json?: boolean;
			}) => {
				const ctx = getCtx();
				requireWorkspace(ctx);
				const code = await runStatus(ctx, options);
				process.exit(code);
			},
		);
}

// 8-column cell data for width measurement (plain text, no ANSI)
interface CellData {
	repo: string;
	branch: string;
	baseName: string;
	baseDiff: string;
	remoteName: string;
	remoteDiff: string;
	local: string;
	lastCommit: RelativeTimeParts;
}

async function runStatus(
	ctx: ArbContext,
	options: { dirty?: boolean; where?: string; fetch?: boolean; verbose?: boolean; json?: boolean },
): Promise<number> {
	const wsDir = `${ctx.baseDir}/${ctx.currentWorkspace}`;

	// Resolve --dirty as shorthand for --where dirty
	if (options.dirty && options.where) {
		process.stderr.write("Cannot combine --dirty with --where. Use --where dirty,... instead.\n");
		return 1;
	}
	const where = options.dirty ? "dirty" : options.where;

	// Validate --where terms
	if (where) {
		const err = validateWhere(where);
		if (err) {
			process.stderr.write(`${err}\n`);
			return 1;
		}
	}

	// Fetch if requested
	if (options.fetch) {
		const { repos, fetchDirs, localRepos } = await classifyRepos(wsDir, ctx.reposDir);
		const remoteRepos = repos.filter((r) => !localRepos.includes(r));
		const remotesMap = await resolveRemotesMap(remoteRepos, ctx.reposDir);
		const results = await parallelFetch(fetchDirs, undefined, remotesMap);
		const failed = reportFetchFailures(repos, localRepos, results);
		if (failed.length > 0) return 1;
	}

	const tty = isTTY();
	let showingProgress = false;
	const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, (scanned, total) => {
		if (!tty) return;
		showingProgress = true;
		process.stderr.write(`\r  Scanning ${scanned}/${total}`);
	});
	if (showingProgress) process.stderr.write(`\r${" ".repeat(40)}\r`);

	// Filter repos if --where is active
	let filteredSummary = summary;
	if (where) {
		const repos = summary.repos.filter((r) => {
			const flags = computeFlags(r, summary.branch);
			return repoMatchesWhere(flags, where);
		});
		const aggregates = computeSummaryAggregates(repos, summary.branch);
		filteredSummary = { ...summary, repos, total: repos.length, ...aggregates };
	}

	// JSON output
	if (options.json) {
		const output: StatusJsonOutput = filteredSummary;
		process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		return filteredSummary.withIssues > 0 ? 1 : 0;
	}

	const repos = filteredSummary.repos;

	if (repos.length === 0) {
		process.stdout.write("  (no repos)\n");
		return 0;
	}

	// Predict conflicts for diverged repos (both ahead and behind base)
	const conflictRepos = new Set<string>();
	await Promise.all(
		repos
			.filter((r) => r.base !== null && r.base.ahead > 0 && r.base.behind > 0)
			.map(async (r) => {
				const repoDir = `${wsDir}/${r.name}`;
				const base = r.base;
				if (!base) return;
				const ref = `${base.remote}/${base.ref}`;
				const prediction = await predictMergeConflict(repoDir, ref);
				if (prediction?.hasConflict) {
					conflictRepos.add(r.name);
				}
			}),
	);

	// Detect current repo from cwd
	const cwd = resolve(process.cwd());
	let currentRepo: string | null = null;
	for (const repo of repos) {
		const repoDir = resolve(`${wsDir}/${repo.name}`);
		if (cwd === repoDir || cwd.startsWith(`${repoDir}/`)) {
			currentRepo = repo.name;
			break;
		}
	}

	// Pass 1: compute plain-text cells and track max widths
	const cells: CellData[] = [];
	let maxRepo = 0;
	let maxBranch = 0;
	let maxBaseName = 0;
	let maxBaseDiff = 0;
	let maxRemoteName = 0;
	let maxRemoteDiff = 0;
	let maxLocal = 0;

	for (const repo of repos) {
		const cell = plainCells(repo);
		cells.push(cell);
		if (cell.repo.length > maxRepo) maxRepo = cell.repo.length;
		if (cell.branch.length > maxBranch) maxBranch = cell.branch.length;
		if (cell.baseName.length > maxBaseName) maxBaseName = cell.baseName.length;
		if (cell.baseDiff.length > maxBaseDiff) maxBaseDiff = cell.baseDiff.length;
		if (cell.remoteName.length > maxRemoteName) maxRemoteName = cell.remoteName.length;
		if (cell.remoteDiff.length > maxRemoteDiff) maxRemoteDiff = cell.remoteDiff.length;
		if (cell.local.length > maxLocal) maxLocal = cell.local.length;
	}
	const lcWidths = computeLastCommitWidths(cells.map((c) => c.lastCommit));

	// Ensure minimum widths for header labels
	if (maxRepo < 4) maxRepo = 4; // "REPO"
	if (maxBranch < 6) maxBranch = 6; // "BRANCH"
	// BASE group must fit "BASE" (4 chars), SHARE group must fit "SHARE" (5 chars)
	// Each group = name + 2sp + diff. Expand the diff column if needed.
	if (maxBaseName + 2 + maxBaseDiff < 4) maxBaseDiff = Math.max(maxBaseDiff, 4 - maxBaseName - 2);
	if (maxRemoteName + 2 + maxRemoteDiff < 5) maxRemoteDiff = Math.max(maxRemoteDiff, 5 - maxRemoteName - 2);
	if (maxLocal < 5) maxLocal = 5; // "LOCAL"

	// Header line
	const baseGroupWidth = maxBaseName + 2 + maxBaseDiff;
	const remoteGroupWidth = maxRemoteName + 2 + maxRemoteDiff;
	let header = `  ${dim("REPO")}${" ".repeat(maxRepo - 4)}`;
	header += `    ${dim("BRANCH")}${" ".repeat(maxBranch - 6)}`;
	header += `    ${dim("LAST COMMIT")}${" ".repeat(lcWidths.total - 11)}`;
	header += `    ${dim("BASE")}${" ".repeat(baseGroupWidth - 4)}`;
	header += `    ${dim("SHARE")}${" ".repeat(remoteGroupWidth - 5)}`;
	header += `    ${dim("LOCAL")}`;
	process.stdout.write(`${header}\n`);

	// Pass 2: render with colors and padding
	for (let i = 0; i < repos.length; i++) {
		const repo = repos[i];
		const cell = cells[i];
		if (!repo || !cell) continue;

		const isActive = repo.name === currentRepo;
		const flags = computeFlags(repo, summary.branch);

		// Col 1: Repo name
		const marker = isActive ? `${green("*")} ` : "  ";
		const repoName = repo.name;
		const repoPad = maxRepo - cell.repo.length;

		// Col 2: Current branch
		const isDetached = repo.identity.headMode.kind === "detached";
		const actualBranch = repo.identity.headMode.kind === "attached" ? repo.identity.headMode.branch : "";
		const branchText = isDetached ? "(detached)" : actualBranch;
		const isDrifted = repo.identity.headMode.kind === "attached" && actualBranch !== summary.branch;
		const branchColored = isDrifted || isDetached ? yellow(branchText) : branchText;
		const branchPad = maxBranch - cell.branch.length;

		// Col 3: Base name
		let baseNameColored: string;
		if (cell.baseName) {
			const baseMerged = repo.base?.baseMergedIntoDefault != null;
			baseNameColored = flags.baseFellBack || baseMerged ? yellow(cell.baseName) : cell.baseName;
		} else {
			baseNameColored = "";
		}
		const baseNamePad = maxBaseName - cell.baseName.length;

		// Col 4: Base diff — yellow when merge-tree predicts a conflict, base is merged into default, or base fell back
		const baseDiffColored =
			conflictRepos.has(repo.name) || repo.base?.baseMergedIntoDefault != null || flags.baseFellBack
				? yellow(cell.baseDiff)
				: cell.baseDiff;
		const baseDiffPad = maxBaseDiff - cell.baseDiff.length;

		// Col 5: Remote name
		let remoteNameColored: string;
		const isLocal = repo.share === null;
		if (isLocal) {
			remoteNameColored = cell.remoteName;
		} else if (isDetached) {
			remoteNameColored = yellow(cell.remoteName);
		} else if (cell.remoteName) {
			const expectedTracking = `${repo.share?.remote}/${repo.identity.headMode.kind === "attached" ? repo.identity.headMode.branch : ""}`;
			const isUnexpected =
				repo.share !== null &&
				repo.share.refMode === "configured" &&
				repo.share.ref !== null &&
				repo.share.ref !== expectedTracking;
			remoteNameColored = isUnexpected || isDrifted ? yellow(cell.remoteName) : cell.remoteName;
		} else {
			remoteNameColored = "";
		}
		const remoteNamePad = maxRemoteName - cell.remoteName.length;

		// Col 6: Remote diff
		let remoteDiffColored: string;
		if (cell.remoteDiff === "up to date" || cell.remoteDiff === "gone") {
			remoteDiffColored = cell.remoteDiff;
		} else if (
			cell.remoteDiff === "not pushed" ||
			(repo.share !== null && repo.share.toPush === 0 && repo.share.toPull !== null && repo.share.toPull > 0)
		) {
			remoteDiffColored = cell.remoteDiff;
		} else if (flags.isUnpushed) {
			const rebased = repo.share?.rebased ?? 0;
			const netNew = (repo.share?.toPush ?? 0) - rebased;
			if (rebased > 0 && netNew <= 0) {
				remoteDiffColored = cell.remoteDiff; // default color for rebased-only
			} else {
				remoteDiffColored = yellow(cell.remoteDiff);
			}
		} else {
			remoteDiffColored = cell.remoteDiff;
		}
		const remoteDiffPad = maxRemoteDiff - cell.remoteDiff.length;

		// Col 7: Local changes
		const localColored = colorLocal(repo);

		// Assemble line: [repo]  4sp  [branch]  4sp  [lastCommit]  4sp  [baseName  2sp  baseDiff]  4sp  [remoteName  2sp  remoteDiff]  4sp  [local]
		let line = `${marker}${repoName}${" ".repeat(repoPad)}`;
		line += `    ${branchColored}${" ".repeat(branchPad)}`;

		// Last commit (number right-aligned, unit left-aligned)
		line += `    ${formatLastCommitCell(cell.lastCommit, lcWidths, true)}`;

		// Base group (name + diff)
		if (cell.baseName) {
			line += `    ${baseNameColored}${" ".repeat(baseNamePad)}  ${baseDiffColored}${" ".repeat(baseDiffPad)}`;
		} else {
			line += " ".repeat(4 + maxBaseName + 2 + maxBaseDiff);
		}

		// Remote group (name + diff)
		if (isLocal) {
			// Local repos: columns 5-6 collapse to "local"
			line += `    ${remoteNameColored}${" ".repeat(remoteNamePad + 2 + maxRemoteDiff)}`;
		} else if (isDetached) {
			// Detached: show "detached" with no diff
			line += `    ${remoteNameColored}${" ".repeat(remoteNamePad + 2 + maxRemoteDiff)}`;
		} else {
			line += `    ${remoteNameColored}${" ".repeat(remoteNamePad)}`;
			if (cell.remoteDiff) {
				line += `  ${remoteDiffColored}${" ".repeat(remoteDiffPad)}`;
			} else {
				line += " ".repeat(2 + maxRemoteDiff);
			}
		}

		// Local changes
		line += `    ${localColored}`;

		process.stdout.write(`${line}\n`);

		// Verbose detail
		if (options.verbose) {
			await printVerboseDetail(repo, wsDir);
			if (i < repos.length - 1) {
				process.stdout.write("\n");
			}
		}
	}

	return filteredSummary.withIssues > 0 ? 1 : 0;
}

// Plain-text cell computation (no ANSI codes) for width measurement

function plainCells(repo: RepoStatus): CellData {
	const isDetached = repo.identity.headMode.kind === "detached";
	const actualBranch = repo.identity.headMode.kind === "attached" ? repo.identity.headMode.branch : "";

	// Col 1: repo name
	const repoName = repo.name;

	// Col 2: branch
	const branch = isDetached ? "(detached)" : actualBranch;

	// Col 3: base name — always show remote/ref for clarity
	let baseName: string;
	if (repo.base) {
		baseName = repo.base.configuredRef
			? `${repo.base.remote}/${repo.base.configuredRef}`
			: `${repo.base.remote}/${repo.base.ref}`;
	} else {
		baseName = "";
	}

	// Col 4: base diff
	let baseDiff = "";
	if (repo.base) {
		if (isDetached) {
			baseDiff = "";
		} else if (repo.base.configuredRef) {
			baseDiff = "not found";
		} else {
			baseDiff = plainBaseDiff(repo.base);
		}
	}

	// Col 5: remote name
	let remoteName: string;
	if (repo.share === null) {
		remoteName = "local";
	} else if (isDetached) {
		remoteName = "detached";
	} else if (repo.share.refMode === "configured" && repo.share.ref) {
		remoteName = repo.share.ref;
	} else {
		remoteName = `${repo.share?.remote ?? "origin"}/${actualBranch}`;
	}

	// Col 6: remote diff
	let remoteDiff = "";
	if (repo.share !== null && !isDetached) {
		remoteDiff = plainRemoteDiff(repo);
	}

	// Col 7: local
	const local = plainLocal(repo);

	// Col 8: last commit
	const lastCommit = repo.lastCommit ? formatRelativeTimeParts(repo.lastCommit) : { num: "", unit: "" };

	return { repo: repoName, branch, baseName, baseDiff, remoteName, remoteDiff, local, lastCommit };
}

function plainBaseDiff(base: NonNullable<RepoStatus["base"]>): string {
	if (base.baseMergedIntoDefault != null) return "base merged";
	const parts = [base.ahead > 0 && `${base.ahead} ahead`, base.behind > 0 && `${base.behind} behind`]
		.filter(Boolean)
		.join(", ");
	return parts || "equal";
}

function plainRemoteDiff(repo: RepoStatus): string {
	if (repo.share === null) return "";

	const merged = repo.base?.mergedIntoBase != null;

	if (repo.share.refMode === "gone") {
		if (merged) return "merged (gone)";
		if (repo.base !== null && repo.base.ahead > 0) {
			return `gone, ${repo.base.ahead} to push`;
		}
		return "gone";
	}

	if (merged) return "merged";

	if (repo.share.refMode === "noRef") {
		if (repo.base !== null && repo.base.ahead > 0) {
			return `${repo.base.ahead} to push`;
		}
		return "not pushed";
	}
	// configured or implicit — use toPush/toPull
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

function plainLocal(repo: RepoStatus): string {
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
	const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : "";

	if (!parts) {
		return `clean${suffix}`;
	}
	return `${parts}${suffix}`;
}

// Colored helpers

function colorLocal(repo: RepoStatus): string {
	const parts: string[] = [];
	if (repo.local.conflicts > 0) parts.push(`${repo.local.conflicts} conflicts`);
	if (repo.local.staged > 0) parts.push(`${repo.local.staged} staged`);
	if (repo.local.modified > 0) parts.push(`${repo.local.modified} modified`);
	if (repo.local.untracked > 0) parts.push(`${repo.local.untracked} untracked`);

	const suffixParts: string[] = [];
	if (repo.operation) suffixParts.push(repo.operation);
	if (repo.identity.shallow) suffixParts.push("shallow");
	const suffix = suffixParts.length > 0 ? yellow(` (${suffixParts.join(", ")})`) : "";

	if (parts.length === 0) {
		return `clean${suffix}`;
	}

	const text = parts.join(", ");
	return `${yellow(text)}${suffix}`;
}

// Verbose output with git-status-style sections

const SECTION_INDENT = "      ";
const ITEM_INDENT = "          ";

async function printVerboseDetail(repo: RepoStatus, wsDir: string): Promise<void> {
	const repoDir = `${wsDir}/${repo.name}`;
	const sections: string[] = [];

	// Merged into base
	if (repo.base?.mergedIntoBase) {
		const baseRef = `${repo.base.remote}/${repo.base.ref}`;
		const strategy = repo.base.mergedIntoBase === "squash" ? "squash" : "merge";
		sections.push(`\n${SECTION_INDENT}Branch merged into ${baseRef} (${strategy})\n`);
	}

	// Base branch merged into default
	if (repo.base?.baseMergedIntoDefault) {
		const strategy = repo.base.baseMergedIntoDefault === "squash" ? "squash" : "merge";
		sections.push(
			`\n${SECTION_INDENT}Base branch ${repo.base.ref} has been merged into default (${strategy})\n${SECTION_INDENT}Run 'arb rebase --retarget' to rebase onto the default branch\n`,
		);
	}

	// Configured base not found (fell back to default)
	if (repo.base?.configuredRef) {
		let section = `\n${SECTION_INDENT}Configured base branch ${repo.base.configuredRef} not found on ${repo.base.remote}\n`;
		section += `${SECTION_INDENT}Run 'arb rebase --retarget' to rebase onto the default branch\n`;
		sections.push(section);
	}

	// Ahead of base (suppress when base fell back — numbers are against the fallback, not the configured base)
	if (repo.base && repo.base.ahead > 0 && !repo.base.configuredRef) {
		const baseRef = `${repo.base.remote}/${repo.base.ref}`;
		const commits = await getCommitsBetween(repoDir, baseRef, "HEAD");
		if (commits.length > 0) {
			let section = `\n${SECTION_INDENT}Ahead of ${baseRef}:\n`;
			for (const c of commits) {
				section += `${ITEM_INDENT}${dim(c.hash)} ${c.subject}\n`;
			}
			sections.push(section);
		}
	}

	// Behind base (suppress when base fell back)
	if (repo.base && repo.base.behind > 0 && !repo.base.configuredRef) {
		const baseRef = `${repo.base.remote}/${repo.base.ref}`;
		const commits = await getCommitsBetween(repoDir, "HEAD", baseRef);
		if (commits.length > 0) {
			let section = `\n${SECTION_INDENT}Behind ${baseRef}:\n`;
			for (const c of commits) {
				section += `${ITEM_INDENT}${dim(c.hash)} ${c.subject}\n`;
			}
			sections.push(section);
		}
	}

	// Unpushed to remote
	if (repo.share !== null && repo.share.toPush !== null && repo.share.toPush > 0 && repo.share.ref) {
		let rebasedHashes: Set<string> | null = null;
		if (repo.share.rebased != null && repo.share.rebased > 0) {
			const detection = await detectRebasedCommits(repoDir, repo.share.ref);
			rebasedHashes = detection?.rebasedLocalHashes ?? null;
		}
		const commits = await getCommitsBetweenFull(repoDir, repo.share.ref, "HEAD");
		if (commits.length > 0) {
			const shareLabel = repo.share.remote;
			let section = `\n${SECTION_INDENT}Unpushed to ${shareLabel}:\n`;
			for (const c of commits) {
				const tag = rebasedHashes?.has(c.fullHash) ? dim(" (rebased)") : "";
				section += `${ITEM_INDENT}${dim(c.shortHash)} ${c.subject}${tag}\n`;
			}
			sections.push(section);
		}
	}

	// File-level detail
	if (repo.local.staged > 0 || repo.local.modified > 0 || repo.local.untracked > 0 || repo.local.conflicts > 0) {
		const files = await parseGitStatusFiles(repoDir);

		if (files.staged.length > 0) {
			let section = `\n${SECTION_INDENT}Changes to be committed:\n`;
			for (const f of files.staged) {
				section += `${ITEM_INDENT}${formatFileChange(f)}\n`;
			}
			sections.push(section);
		}

		if (files.unstaged.length > 0) {
			let section = `\n${SECTION_INDENT}Changes not staged for commit:\n`;
			for (const f of files.unstaged) {
				section += `${ITEM_INDENT}${formatFileChange(f)}\n`;
			}
			sections.push(section);
		}

		if (files.untracked.length > 0) {
			let section = `\n${SECTION_INDENT}Untracked files:\n`;
			for (const f of files.untracked) {
				section += `${ITEM_INDENT}${f}\n`;
			}
			sections.push(section);
		}
	}

	for (const section of sections) {
		process.stdout.write(section);
	}
}

function formatFileChange(fc: FileChange): string {
	const typeWidth = 12;
	return `${`${fc.type}:`.padEnd(typeWidth)}${fc.file}`;
}
