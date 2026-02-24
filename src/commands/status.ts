import { basename, resolve } from "node:path";
import type { Command } from "commander";
import { predictMergeConflict } from "../lib/git";
import type { StatusJsonOutput } from "../lib/json-types";
import { bold, dim, error, yellow } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { resolveRemotesMap } from "../lib/remotes";
import { workspaceRepoDirs } from "../lib/repos";
import {
	type RepoStatus,
	baseRef,
	computeFlags,
	computeSummaryAggregates,
	gatherWorkspaceSummary,
	repoMatchesWhere,
	validateWhere,
} from "../lib/status";
import { gatherVerboseDetail, printVerboseDetail, toJsonVerbose } from "../lib/status-verbose";
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
		.option("-w, --where <filter>", "Filter repos by status flags (comma = OR, + = AND, ^ = negate)")
		.option("-F, --fetch", "Fetch from all remotes before showing status")
		.option("--no-fetch", "Skip fetching (default)", false)
		.option("-v, --verbose", "Show file-level detail for each repo")
		.option("-q, --quiet", "Output one repo name per line")
		.option("--json", "Output structured JSON (combine with --verbose for commit and file detail)")
		.summary("Show workspace status")
		.description(
			"Show each worktree's position relative to the default branch, push status against the share remote, and local changes (staged, modified, untracked). The summary includes the workspace's last commit date (most recent author date across all repos).\n\nUse --dirty to only show worktrees with uncommitted changes. Use --where <filter> to filter by any status flag: dirty, unpushed, behind-share, behind-base, diverged, drifted, detached, operation, gone, shallow, merged, base-merged, base-missing, at-risk, stale. Positive/healthy terms: clean, pushed, synced-base, synced-share, synced, safe. Prefix any term with ^ to negate (e.g. --where ^dirty is equivalent to --where clean). Comma-separated values use OR logic (e.g. --where dirty,unpushed). Use + for AND (e.g. --where dirty+unpushed matches repos that are both dirty and unpushed). + binds tighter than comma: dirty+unpushed,gone = (dirty AND unpushed) OR gone. Use -F/--fetch to update remote tracking info first (skip with --no-fetch). Use --verbose for file-level detail. Use --json for machine-readable output. Combine --json --verbose to include commit lists and file-level detail in JSON output.",
		)
		.action(
			async (options: {
				dirty?: boolean;
				where?: string;
				fetch?: boolean;
				verbose?: boolean;
				quiet?: boolean;
				json?: boolean;
			}) => {
				const ctx = getCtx();
				requireWorkspace(ctx);
				await runStatus(ctx, options);
			},
		);
}

// 8-column cell data for width measurement (plain text, no ANSI)
export interface CellData {
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
	options: { dirty?: boolean; where?: string; fetch?: boolean; verbose?: boolean; quiet?: boolean; json?: boolean },
): Promise<void> {
	const wsDir = `${ctx.arbRootDir}/${ctx.currentWorkspace}`;

	// Resolve --dirty as shorthand for --where dirty
	if (options.dirty && options.where) {
		error("Cannot combine --dirty with --where. Use --where dirty,... instead.");
		process.exit(1);
	}
	const where = options.dirty ? "dirty" : options.where;

	// Validate --where terms
	if (where) {
		const err = validateWhere(where);
		if (err) {
			error(err);
			process.exit(1);
		}
	}

	// Conflict checks
	if (options.quiet && options.json) {
		error("Cannot combine --quiet with --json.");
		process.exit(1);
	}
	if (options.quiet && options.verbose) {
		error("Cannot combine --quiet with --verbose.");
		process.exit(1);
	}

	// Fetch if requested
	if (options.fetch) {
		const fetchDirs = workspaceRepoDirs(wsDir);
		const repos = fetchDirs.map((d) => basename(d));
		const remotesMap = await resolveRemotesMap(repos, ctx.reposDir);
		const results = await parallelFetch(fetchDirs, undefined, remotesMap);
		const failed = reportFetchFailures(repos, results);
		if (failed.length > 0) process.exit(1);
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

	// Quiet output — one repo name per line
	if (options.quiet) {
		for (const repo of filteredSummary.repos) {
			process.stdout.write(`${repo.name}\n`);
		}
		return;
	}

	// JSON output
	if (options.json) {
		let output: StatusJsonOutput = filteredSummary;
		if (options.verbose) {
			const reposWithVerbose = await Promise.all(
				filteredSummary.repos.map(async (repo) => {
					const detail = await gatherVerboseDetail(repo, wsDir);
					return { ...repo, verbose: detail ? toJsonVerbose(detail) : undefined };
				}),
			);
			output = { ...filteredSummary, repos: reposWithVerbose };
		}
		process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		return;
	}

	const repos = filteredSummary.repos;

	// Branch header line (TTY only)
	const branchHeader = filteredSummary.base
		? `On branch ${summary.branch}  ${dim(`(base: ${filteredSummary.base})`)}`
		: `On branch ${summary.branch}`;
	process.stdout.write(`${branchHeader}\n`);

	if (repos.length === 0) {
		process.stdout.write("\n  (no repos)\n");
		return;
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
				const ref = baseRef(base);
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

	// Detect drift — only show BRANCH column when at least one repo is drifted or detached
	const showBranch = repos.some(
		(r) =>
			r.identity.headMode.kind === "detached" ||
			(r.identity.headMode.kind === "attached" && r.identity.headMode.branch !== summary.branch),
	);

	// Ensure minimum widths for header labels
	if (maxRepo < 4) maxRepo = 4; // "REPO"
	if (maxBranch < 6) maxBranch = 6; // "BRANCH"
	// BASE group must fit "BASE" (4 chars), SHARE group must fit "SHARE" (5 chars)
	// Each group = name + 2sp + diff. Expand the diff column if needed.
	if (maxBaseName + 2 + maxBaseDiff < 4) maxBaseDiff = Math.max(maxBaseDiff, 4 - maxBaseName - 2);
	if (maxRemoteName + 2 + maxRemoteDiff < 5) maxRemoteDiff = Math.max(maxRemoteDiff, 5 - maxRemoteName - 2);
	if (maxLocal < 5) maxLocal = 5; // "LOCAL"

	// Terminal-aware truncation of SHARE remote name
	const baseGroupWidth = maxBaseName + 2 + maxBaseDiff;
	const remoteGroupWidth = maxRemoteName + 2 + maxRemoteDiff;
	const totalWidth =
		2 +
		maxRepo +
		4 +
		(showBranch ? maxBranch + 4 : 0) +
		lcWidths.total +
		4 +
		baseGroupWidth +
		4 +
		remoteGroupWidth +
		4 +
		maxLocal;
	const envCols = Number(process.env.COLUMNS);
	const termCols = process.stdout.columns ?? (Number.isFinite(envCols) ? envCols : 0);
	if (termCols > 0 && totalWidth > termCols) {
		const overflow = totalWidth - termCols;
		// Minimum: preserve the remote prefix (e.g. "origin/") + 3 branch chars + ellipsis
		let minRemoteName = 10;
		for (const cell of cells) {
			const slashIdx = cell.remoteName.indexOf("/");
			if (slashIdx >= 0) {
				// prefix/ + 3 visible branch chars + 1 ellipsis
				minRemoteName = Math.max(minRemoteName, slashIdx + 1 + 3 + 1);
			}
		}
		maxRemoteName = Math.max(minRemoteName, maxRemoteName - overflow);
	}
	const finalRemoteGroupWidth = maxRemoteName + 2 + maxRemoteDiff;

	// Table header line
	process.stdout.write("\n");
	let header = `  ${dim("REPO")}${" ".repeat(maxRepo - 4)}`;
	if (showBranch) {
		header += `    ${dim("BRANCH")}${" ".repeat(maxBranch - 6)}`;
	}
	header += `    ${dim("LAST COMMIT")}${" ".repeat(lcWidths.total - 11)}`;
	header += `    ${dim("BASE")}${" ".repeat(baseGroupWidth - 4)}`;
	header += `    ${dim("SHARE")}${" ".repeat(finalRemoteGroupWidth - 5)}`;
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
		const marker = isActive ? `${bold("*")} ` : "  ";
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

		// Col 5: Remote name (truncated if needed)
		const truncatedRemoteName = truncateRemoteName(cell.remoteName, maxRemoteName);
		let remoteNameColored: string;
		if (isDetached) {
			remoteNameColored = yellow(truncatedRemoteName);
		} else if (truncatedRemoteName) {
			const expectedTracking = `${repo.share.remote}/${repo.identity.headMode.kind === "attached" ? repo.identity.headMode.branch : ""}`;
			const isUnexpected =
				repo.share.refMode === "configured" && repo.share.ref !== null && repo.share.ref !== expectedTracking;
			remoteNameColored = isUnexpected || isDrifted ? yellow(truncatedRemoteName) : truncatedRemoteName;
		} else {
			remoteNameColored = "";
		}
		const remoteNamePad = maxRemoteName - truncatedRemoteName.length;

		// Col 6: Remote diff
		let remoteDiffColored: string;
		if (cell.remoteDiff === "up to date" || cell.remoteDiff === "gone") {
			remoteDiffColored = cell.remoteDiff;
		} else if (
			cell.remoteDiff === "not pushed" ||
			(repo.share.toPush === 0 && repo.share.toPull !== null && repo.share.toPull > 0)
		) {
			remoteDiffColored = cell.remoteDiff;
		} else if (flags.isUnpushed) {
			const rebased = repo.share.rebased ?? 0;
			const netNew = (repo.share.toPush ?? 0) - rebased;
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

		// Assemble line
		let line = `${marker}${repoName}${" ".repeat(repoPad)}`;
		if (showBranch) {
			line += `    ${branchColored}${" ".repeat(branchPad)}`;
		}

		// Last commit (number right-aligned, unit left-aligned)
		line += `    ${formatLastCommitCell(cell.lastCommit, lcWidths, true)}`;

		// Base group (name + diff)
		if (cell.baseName) {
			line += `    ${baseNameColored}${" ".repeat(baseNamePad)}  ${baseDiffColored}${" ".repeat(baseDiffPad)}`;
		} else {
			line += " ".repeat(4 + maxBaseName + 2 + maxBaseDiff);
		}

		// Remote group (name + diff)
		if (isDetached) {
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
}

// Plain-text cell computation (no ANSI codes) for width measurement

export function plainCells(repo: RepoStatus): CellData {
	const isDetached = repo.identity.headMode.kind === "detached";
	const actualBranch = repo.identity.headMode.kind === "attached" ? repo.identity.headMode.branch : "";

	// Col 1: repo name
	const repoName = repo.name;

	// Col 2: branch
	const branch = isDetached ? "(detached)" : actualBranch;

	// Col 3: base name — always show remote/ref for clarity
	let baseName: string;
	if (repo.base) {
		const branch = repo.base.configuredRef ?? repo.base.ref;
		baseName = repo.base.remote ? `${repo.base.remote}/${branch}` : branch;
	} else {
		baseName = "";
	}

	// Col 4: base diff
	let baseDiff = "";
	if (repo.base) {
		if (isDetached) {
			baseDiff = "";
		} else if (repo.base.configuredRef && repo.base.baseMergedIntoDefault == null) {
			baseDiff = "not found";
		} else {
			baseDiff = plainBaseDiff(repo.base);
		}
	}

	// Col 5: remote name
	let remoteName: string;
	if (isDetached) {
		remoteName = "detached";
	} else if (repo.share.refMode === "configured" && repo.share.ref) {
		remoteName = repo.share.ref;
	} else {
		remoteName = `${repo.share.remote}/${actualBranch}`;
	}

	// Col 6: remote diff
	let remoteDiff = "";
	if (!isDetached) {
		remoteDiff = plainRemoteDiff(repo);
	}

	// Col 7: local
	const local = plainLocal(repo);

	// Col 8: last commit
	const lastCommit = repo.lastCommit ? formatRelativeTimeParts(repo.lastCommit) : { num: "", unit: "" };

	return { repo: repoName, branch, baseName, baseDiff, remoteName, remoteDiff, local, lastCommit };
}

export function plainBaseDiff(base: NonNullable<RepoStatus["base"]>): string {
	if (base.baseMergedIntoDefault != null) return "base merged";
	const parts = [base.ahead > 0 && `${base.ahead} ahead`, base.behind > 0 && `${base.behind} behind`]
		.filter(Boolean)
		.join(", ");
	return parts || "equal";
}

export function plainRemoteDiff(repo: RepoStatus): string {
	const merged = repo.base?.mergedIntoBase != null;

	if (repo.share.refMode === "gone") {
		if (merged) return "merged (gone)";
		if (repo.base !== null && repo.base.ahead > 0) {
			return `gone, ${repo.base.ahead} to push`;
		}
		return "gone";
	}

	if (repo.share.refMode === "noRef") {
		if (repo.base !== null && repo.base.ahead > 0) return `${repo.base.ahead} to push`;
		return "not pushed";
	}

	if (merged && (repo.share.toPull ?? 0) === 0) return "merged";
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
	const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : "";

	if (!parts) {
		return `clean${suffix}`;
	}
	return `${parts}${suffix}`;
}

// Colored helpers

/** Truncate a remote name (e.g. "origin/long-branch"), preserving the remote prefix and at least 3 chars of the branch. */
function truncateRemoteName(text: string, max: number): string {
	if (text.length <= max) return text;
	const slashIdx = text.indexOf("/");
	if (slashIdx < 0) return text;
	// prefix = "origin/", minimum = prefix + 3 visible branch chars + ellipsis
	if (max < slashIdx + 1 + 3 + 1) return text;
	return `${text.slice(0, max - 1)}…`;
}

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
