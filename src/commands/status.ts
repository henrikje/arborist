import { resolve } from "node:path";
import type { Command } from "commander";
import { type FileChange, getCommitsBetween, parseGitStatusFiles } from "../lib/git";
import { dim, green, success, warn, yellow } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { classifyRepos } from "../lib/repos";
import {
	type RepoStatus,
	type WorkspaceSummary,
	gatherWorkspaceSummary,
	getVerdict,
	isDirty,
	isUnpushed,
} from "../lib/status";
import type { ArbContext } from "../lib/types";
import { requireWorkspace } from "../lib/workspace-context";

export function registerStatusCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("status")
		.option("-d, --dirty", "Only show repos with local changes")
		.option("-r, --at-risk", "Only show repos that need attention")
		.option("-f, --fetch", "Fetch from all remotes before showing status")
		.option("--verbose", "Show file-level detail for each repo")
		.option("--json", "Output structured JSON")
		.summary("Show workspace status")
		.description(
			"Show each worktree's position relative to the default branch, push status against the publish remote, and local changes (staged, modified, untracked). Use --dirty to only show worktrees with uncommitted changes. Use --at-risk to only show repos that need attention (unpushed, drifted, dirty, etc). Use --fetch to update remote tracking info first. Use --verbose for file-level detail. Use --json for machine-readable output.",
		)
		.action(
			async (options: {
				dirty?: boolean;
				atRisk?: boolean;
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

// 7-column cell data for width measurement (plain text, no ANSI)
interface CellData {
	repo: string;
	branch: string;
	baseName: string;
	baseDiff: string;
	remoteName: string;
	remoteDiff: string;
	local: string;
}

async function runStatus(
	ctx: ArbContext,
	options: { dirty?: boolean; atRisk?: boolean; fetch?: boolean; verbose?: boolean; json?: boolean },
): Promise<number> {
	const wsDir = `${ctx.baseDir}/${ctx.currentWorkspace}`;

	// Fetch if requested
	if (options.fetch) {
		const { repos, fetchDirs, localRepos } = await classifyRepos(wsDir, ctx.reposDir);
		const results = await parallelFetch(fetchDirs);
		const failed = reportFetchFailures(repos, localRepos, results);
		if (failed.length > 0) return 1;
	}

	const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir);

	// JSON output
	if (options.json) {
		process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
		return hasIssues(summary) ? 1 : 0;
	}

	// Filter dirty if requested
	let repos = summary.repos;
	if (options.dirty) {
		repos = repos.filter((r) => isDirty(r));
	}
	if (options.atRisk) {
		repos = repos.filter((r) => isAtRisk(r, summary));
	}

	if (repos.length === 0) {
		process.stdout.write("  (no repos)\n");
		return 0;
	}

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

	for (const repo of repos) {
		const cell = plainCells(repo);
		cells.push(cell);
		if (cell.repo.length > maxRepo) maxRepo = cell.repo.length;
		if (cell.branch.length > maxBranch) maxBranch = cell.branch.length;
		if (cell.baseName.length > maxBaseName) maxBaseName = cell.baseName.length;
		if (cell.baseDiff.length > maxBaseDiff) maxBaseDiff = cell.baseDiff.length;
		if (cell.remoteName.length > maxRemoteName) maxRemoteName = cell.remoteName.length;
		if (cell.remoteDiff.length > maxRemoteDiff) maxRemoteDiff = cell.remoteDiff.length;
	}

	// Ensure minimum widths for header labels
	if (maxRepo < 4) maxRepo = 4; // "REPO"
	if (maxBranch < 6) maxBranch = 6; // "BRANCH"
	// BASE group must fit "BASE" (4 chars), REMOTE group must fit "REMOTE" (6 chars)
	// Each group = name + 2sp + diff. Expand the diff column if needed.
	if (maxBaseName + 2 + maxBaseDiff < 4) maxBaseDiff = Math.max(maxBaseDiff, 4 - maxBaseName - 2);
	if (maxRemoteName + 2 + maxRemoteDiff < 6) maxRemoteDiff = Math.max(maxRemoteDiff, 6 - maxRemoteName - 2);

	// Header line
	const baseGroupWidth = maxBaseName + 2 + maxBaseDiff;
	const remoteGroupWidth = maxRemoteName + 2 + maxRemoteDiff;
	let header = `  ${dim("REPO")}${" ".repeat(maxRepo - 4)}`;
	header += `    ${dim("BRANCH")}${" ".repeat(maxBranch - 6)}`;
	header += `    ${dim("BASE")}${" ".repeat(baseGroupWidth - 4)}`;
	header += `    ${dim("REMOTE")}${" ".repeat(remoteGroupWidth - 6)}`;
	header += `    ${dim("LOCAL")}`;
	process.stdout.write(`${header}\n`);

	// Pass 2: render with colors and padding
	for (let i = 0; i < repos.length; i++) {
		const repo = repos[i];
		const cell = cells[i];
		if (!repo || !cell) continue;

		const isActive = repo.name === currentRepo;
		const risk = isAtRisk(repo, summary);

		// Col 1: Repo name
		const marker = isActive ? `${green("*")} ` : "  ";
		const repoName = risk ? yellow(repo.name) : repo.name;
		const repoPad = maxRepo - cell.repo.length;

		// Col 2: Current branch
		const branchText = repo.branch.detached ? "(detached)" : repo.branch.actual;
		const branchColored = repo.branch.drifted ? yellow(branchText) : branchText;
		const branchPad = maxBranch - cell.branch.length;

		// Col 3: Base name
		let baseNameColored: string;
		if (cell.baseName) {
			const baseFellBack = summary.base !== null && repo.base !== null && repo.base.name !== summary.base;
			baseNameColored = baseFellBack ? yellow(cell.baseName) : cell.baseName;
		} else {
			baseNameColored = "";
		}
		const baseNamePad = maxBaseName - cell.baseName.length;

		// Col 4: Base diff
		const baseDiffColored = cell.baseDiff;
		const baseDiffPad = maxBaseDiff - cell.baseDiff.length;

		// Col 5: Remote name
		let remoteNameColored: string;
		if (repo.remote.local) {
			remoteNameColored = cell.remoteName;
		} else if (repo.branch.detached) {
			remoteNameColored = yellow(cell.remoteName);
		} else if (cell.remoteName) {
			const expectedTracking = `${repo.remotes.publish}/${repo.branch.actual}`;
			const isUnexpected = repo.remote.trackingBranch !== null && repo.remote.trackingBranch !== expectedTracking;
			remoteNameColored = isUnexpected || repo.branch.drifted ? yellow(cell.remoteName) : cell.remoteName;
		} else {
			remoteNameColored = "";
		}
		const remoteNamePad = maxRemoteName - cell.remoteName.length;

		// Col 6: Remote diff
		let remoteDiffColored: string;
		if (cell.remoteDiff === "aligned") {
			remoteDiffColored = cell.remoteDiff;
		} else if (cell.remoteDiff === "not pushed" || (repo.remote.ahead === 0 && repo.remote.behind > 0)) {
			remoteDiffColored = cell.remoteDiff;
		} else if (isUnpushed(repo)) {
			remoteDiffColored = yellow(cell.remoteDiff);
		} else {
			remoteDiffColored = cell.remoteDiff;
		}
		const remoteDiffPad = maxRemoteDiff - cell.remoteDiff.length;

		// Col 7: Local changes
		const localColored = colorLocal(repo);

		// Assemble line with grouping: [repo]  4sp  [branch]  4sp  [baseName  2sp  baseDiff]  4sp  [remoteName  2sp  remoteDiff]  4sp  [local]
		let line = `${marker}${repoName}${" ".repeat(repoPad)}`;
		line += `    ${branchColored}${" ".repeat(branchPad)}`;

		// Base group (name + diff)
		if (cell.baseName) {
			line += `    ${baseNameColored}${" ".repeat(baseNamePad)}  ${baseDiffColored}${" ".repeat(baseDiffPad)}`;
		} else {
			line += " ".repeat(4 + maxBaseName + 2 + maxBaseDiff);
		}

		// Remote group (name + diff)
		if (repo.remote.local) {
			// Local repos: columns 5-6 collapse to "local"
			line += `    ${remoteNameColored}${" ".repeat(remoteNamePad + 2 + maxRemoteDiff)}`;
		} else if (repo.branch.detached) {
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

	// Summary line
	const behindBase = repos.filter((r) => r.base !== null && r.base.behind > 0).length;
	const verdicts = repos.map((r) => getVerdict(r));
	const clean = verdicts.filter((v, i) => {
		if (v !== "ok" && v !== "local") return false;
		const r = repos[i];
		return !(r && r.base !== null && r.base.behind > 0);
	}).length;
	const dirty = verdicts.filter((v) => v === "dirty").length;
	const unpushed = verdicts.filter((v) => v === "unpushed").length;
	const atRisk = verdicts.filter((v) => v === "at-risk").length;

	const parts: string[] = [];
	if (clean > 0) parts.push(`${clean} clean`);
	if (unpushed > 0) parts.push(`${unpushed} unpushed`);
	if (dirty > 0) parts.push(`${dirty} dirty`);
	if (atRisk > 0) parts.push(`${atRisk} at-risk`);
	if (behindBase > 0) parts.push(`${behindBase} behind base`);

	const line = parts.join(", ");
	const allGood = unpushed === 0 && dirty === 0 && atRisk === 0 && behindBase === 0;

	process.stdout.write("\n");
	if (allGood) {
		success(`  ${line}`);
	} else {
		warn(`  ${line}`);
	}

	return hasIssues(summary) ? 1 : 0;
}

function hasIssues(summary: WorkspaceSummary): boolean {
	return summary.repos.some((r) => {
		const v = getVerdict(r);
		return v !== "ok" && v !== "local";
	});
}

// At-risk check: repo has unique content that could be lost
function isAtRisk(repo: RepoStatus, summary: WorkspaceSummary): boolean {
	const v = getVerdict(repo);
	if (v !== "ok" && v !== "local") return true;
	if (summary.base !== null && repo.base !== null && repo.base.name !== summary.base) return true;
	if (
		!repo.remote.local &&
		repo.remote.trackingBranch !== null &&
		repo.remote.trackingBranch !== `${repo.remotes.publish}/${repo.branch.actual}`
	)
		return true;
	return false;
}

// Plain-text cell computation (no ANSI codes) for width measurement

function plainCells(repo: RepoStatus): CellData {
	// Col 1: repo name
	const repoName = repo.name;

	// Col 2: branch
	const branch = repo.branch.detached ? "(detached)" : repo.branch.actual;

	// Col 3: base name — show upstream remote prefix when upstream ≠ publish (fork setup)
	let baseName: string;
	if (repo.base) {
		const isFork = repo.remotes.upstream !== repo.remotes.publish;
		baseName = isFork ? `${repo.remotes.upstream}/${repo.base.name}` : repo.base.name;
	} else {
		baseName = "";
	}

	// Col 4: base diff
	let baseDiff = "";
	if (repo.base) {
		if (repo.branch.detached) {
			baseDiff = "";
		} else {
			baseDiff = plainBaseDiff(repo.base);
		}
	}

	// Col 5: remote name
	let remoteName: string;
	if (repo.remote.local) {
		remoteName = "local";
	} else if (repo.branch.detached) {
		remoteName = "detached";
	} else if (repo.remote.trackingBranch) {
		remoteName = repo.remote.trackingBranch;
	} else {
		remoteName = `${repo.remotes.publish}/${repo.branch.actual}`;
	}

	// Col 6: remote diff
	let remoteDiff = "";
	if (!repo.remote.local && !repo.branch.detached) {
		remoteDiff = plainRemoteDiff(repo);
	}

	// Col 7: local
	const local = plainLocal(repo);

	return { repo: repoName, branch, baseName, baseDiff, remoteName, remoteDiff, local };
}

function plainBaseDiff(base: NonNullable<RepoStatus["base"]>): string {
	const parts = [base.ahead > 0 && `${base.ahead} ahead`, base.behind > 0 && `${base.behind} behind`]
		.filter(Boolean)
		.join(", ");
	return parts || "aligned";
}

function plainRemoteDiff(repo: RepoStatus): string {
	if (!repo.remote.pushed) {
		if (repo.base !== null && repo.base.ahead > 0) {
			return `${repo.base.ahead} to push`;
		}
		return "not pushed";
	}
	if (repo.remote.ahead === 0 && repo.remote.behind === 0) return "aligned";
	const parts = [
		repo.remote.ahead > 0 && `${repo.remote.ahead} to push`,
		repo.remote.behind > 0 && `${repo.remote.behind} to pull`,
	]
		.filter(Boolean)
		.join(", ");
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
	if (!parts) {
		const suffix = repo.operation ? ` (${repo.operation})` : "";
		return `clean${suffix}`;
	}
	if (repo.operation) return `${parts} (${repo.operation})`;
	return parts;
}

// Colored helpers

function colorLocal(repo: RepoStatus): string {
	const parts: string[] = [];
	if (repo.local.conflicts > 0) parts.push(`${repo.local.conflicts} conflicts`);
	if (repo.local.staged > 0) parts.push(`${repo.local.staged} staged`);
	if (repo.local.modified > 0) parts.push(`${repo.local.modified} modified`);
	if (repo.local.untracked > 0) parts.push(`${repo.local.untracked} untracked`);

	if (parts.length === 0) {
		const suffix = repo.operation ? yellow(` (${repo.operation})`) : "";
		return `clean${suffix}`;
	}

	const text = parts.join(", ");
	if (repo.operation) return `${yellow(text)} ${yellow(`(${repo.operation})`)}`;
	return yellow(text);
}

// Verbose output with git-status-style sections

const SECTION_INDENT = "      ";
const ITEM_INDENT = "          ";

async function printVerboseDetail(repo: RepoStatus, wsDir: string): Promise<void> {
	const repoDir = `${wsDir}/${repo.name}`;
	const sections: string[] = [];

	// Ahead of base
	if (repo.base && repo.base.ahead > 0) {
		const baseRef = `${repo.remotes.upstream}/${repo.base.name}`;
		const commits = await getCommitsBetween(repoDir, baseRef, "HEAD");
		if (commits.length > 0) {
			const baseLabel =
				repo.remotes.upstream !== repo.remotes.publish ? `${repo.remotes.upstream}/${repo.base.name}` : repo.base.name;
			let section = `\n${SECTION_INDENT}Ahead of ${baseLabel}:\n`;
			for (const c of commits) {
				section += `${ITEM_INDENT}${dim(c.hash)} ${c.subject}\n`;
			}
			sections.push(section);
		}
	}

	// Behind base
	if (repo.base && repo.base.behind > 0) {
		const baseRef = `${repo.remotes.upstream}/${repo.base.name}`;
		const commits = await getCommitsBetween(repoDir, "HEAD", baseRef);
		if (commits.length > 0) {
			const baseLabel =
				repo.remotes.upstream !== repo.remotes.publish ? `${repo.remotes.upstream}/${repo.base.name}` : repo.base.name;
			let section = `\n${SECTION_INDENT}Behind ${baseLabel}:\n`;
			for (const c of commits) {
				section += `${ITEM_INDENT}${dim(c.hash)} ${c.subject}\n`;
			}
			sections.push(section);
		}
	}

	// Unpushed to remote
	if (repo.remote.pushed && repo.remote.ahead > 0) {
		const trackRef = repo.remote.trackingBranch ?? `${repo.remotes.publish}/${repo.branch.actual}`;
		const commits = await getCommitsBetween(repoDir, trackRef, "HEAD");
		if (commits.length > 0) {
			const publishLabel = repo.remotes.publish;
			let section = `\n${SECTION_INDENT}Unpushed to ${publishLabel}:\n`;
			for (const c of commits) {
				section += `${ITEM_INDENT}${dim(c.hash)} ${c.subject}\n`;
			}
			sections.push(section);
		}
	}

	// File-level detail
	if (isDirty(repo)) {
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
