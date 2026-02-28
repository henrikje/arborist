import { basename } from "node:path";
import type { Command } from "commander";
import { ArbError } from "../lib/errors";
import { git, parseGitNumstat } from "../lib/git";
import { GitCache } from "../lib/git-cache";
import { printSchema } from "../lib/json-schema";
import { type DiffJsonFileStat, type DiffJsonOutput, DiffJsonOutputSchema, type DiffJsonRepo } from "../lib/json-types";
import { error, plural, stdout, success } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { writeRepoHeader, writeRepoSkipHeader } from "../lib/repo-header";
import { resolveRepoSelection, workspaceRepoDirs } from "../lib/repos";
import {
	type RepoStatus,
	baseRef,
	computeFlags,
	gatherWorkspaceSummary,
	repoMatchesWhere,
	validateWhere,
} from "../lib/status";
import { readNamesFromStdin } from "../lib/stdin";
import { isTTY } from "../lib/tty";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";

interface RepoDiffStat {
	files: number;
	insertions: number;
	deletions: number;
}

type RepoDiffStatus = "ok" | "detached" | "drifted" | "no-base" | "fallback-base" | "clean";

interface RepoDiffResult {
	name: string;
	status: RepoDiffStatus;
	reason?: string;
	annotation: string;
	stat: RepoDiffStat;
	fileStat: DiffJsonFileStat[];
	diffRef?: string;
	untrackedCount: number;
}

const NO_BASE_FALLBACK_LIMIT = 10;

interface DiffTarget {
	ref: string;
	status: RepoDiffStatus;
	reason?: string;
	note: string;
}

async function resolveDiffTarget(repoDir: string, repo: RepoStatus): Promise<DiffTarget | null> {
	if (!repo.base) {
		const rangeResult = await git(repoDir, "log", "--format=%H", "-n", `${NO_BASE_FALLBACK_LIMIT}`, "HEAD");
		if (rangeResult.exitCode !== 0 || !rangeResult.stdout.trim()) {
			return null;
		}
		const hashes = rangeResult.stdout.trim().split("\n");
		const oldest = hashes[hashes.length - 1];
		if (!oldest) return null;

		const parentCheck = await git(repoDir, "rev-parse", "--verify", `${oldest}^`);
		let ref: string;
		if (parentCheck.exitCode === 0) {
			const parent = parentCheck.stdout.trim();
			const mb = await git(repoDir, "merge-base", parent, "HEAD");
			ref = mb.exitCode === 0 && mb.stdout.trim() ? mb.stdout.trim() : parent;
		} else {
			const emptyTree = await git(repoDir, "hash-object", "-t", "tree", "/dev/null");
			ref = emptyTree.stdout.trim();
		}

		return {
			ref,
			status: "no-base",
			reason: "no base branch resolved",
			note: "no base branch, showing recent",
		};
	}

	const baseFellBack = repo.base.configuredRef != null && repo.base.baseMergedIntoDefault == null;
	const baseRefStr = baseRef(repo.base);
	const mb = await git(repoDir, "merge-base", baseRefStr, "HEAD");
	const ref = mb.exitCode === 0 && mb.stdout.trim() ? mb.stdout.trim() : baseRefStr;

	if (baseFellBack) {
		return {
			ref,
			status: "fallback-base",
			reason: `base ${repo.base.configuredRef} not found, using ${repo.base.ref}`,
			note: `base ${repo.base.configuredRef} not found, showing against ${repo.base.ref}`,
		};
	}

	return { ref, status: "ok", note: "" };
}

export function registerDiffCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("diff [repos...]")
		.option("--fetch", "Fetch from all remotes before showing diff")
		.option("-N, --no-fetch", "Skip fetching (default)")
		.option("--stat", "Show diffstat summary instead of full diff")
		.option("--json", "Output structured JSON to stdout")
		.option("--schema", "Print JSON Schema for this command's --json output and exit")
		.option("-d, --dirty", "Only diff dirty repos (shorthand for --where dirty)")
		.option("-w, --where <filter>", "Only diff repos matching status filter (comma = OR, + = AND, ^ = negate)")
		.summary("Show feature branch diff across repos")
		.description(
			"Show the cumulative diff of the feature branch since diverging from the base branch across all repos in the workspace. Answers 'what has this feature branch changed?' by showing the total change set.\n\nDiffs from the merge-base to the working tree, so the output includes committed, staged, and unstaged changes to tracked files — the complete change set of the feature branch. Untracked files (never git-added) are not included in the diff — this is inherent to git diff semantics. Use 'arb status -v' to see untracked files.\n\nUse --fetch to fetch before showing diff (default is no fetch). Use --stat for a summary of changed files. Use --json for machine-readable output.\n\nRepos are positional arguments — name specific repos to filter, or omit to show all. Reads repo names from stdin when piped (one per line). Use --where to filter by status flags. See 'arb help where' for filter syntax. Skipped repos (detached HEAD, wrong branch) are explained in the output, never silently omitted.",
		)
		.action(
			async (
				repoArgs: string[],
				options: { stat?: boolean; json?: boolean; schema?: boolean; dirty?: boolean; where?: string; fetch?: boolean },
			) => {
				if (options.schema) {
					if (options.json) {
						error("Cannot combine --schema with --json.");
						throw new ArbError("Cannot combine --schema with --json.");
					}
					printSchema(DiffJsonOutputSchema);
					return;
				}
				const ctx = getCtx();
				const { wsDir, workspace } = requireWorkspace(ctx);
				const branch = await requireBranch(wsDir, workspace);

				let repoNames = repoArgs;
				if (repoNames.length === 0) {
					const stdinNames = await readNamesFromStdin();
					if (stdinNames.length > 0) repoNames = stdinNames;
				}
				const selectedRepos = resolveRepoSelection(wsDir, repoNames);
				const cache = new GitCache();

				if (options.fetch) {
					const allFetchDirs = workspaceRepoDirs(wsDir);
					const selectedSet = new Set(selectedRepos);
					const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
					const repos = fetchDirs.map((d) => basename(d));
					const remotesMap = await cache.resolveRemotesMap(repos, ctx.reposDir);
					const results = await parallelFetch(fetchDirs, undefined, remotesMap);
					cache.invalidateAfterFetch();
					const failed = reportFetchFailures(repos, results);
					if (failed.length > 0) {
						error("Aborting due to fetch failures.");
						throw new ArbError("Aborting due to fetch failures.");
					}
				}

				// Resolve --dirty as shorthand for --where dirty
				if (options.dirty && options.where) {
					error("Cannot combine --dirty with --where. Use --where dirty,... instead.");
					throw new ArbError("Cannot combine --dirty with --where. Use --where dirty,... instead.");
				}
				const where = options.dirty ? "dirty" : options.where;

				if (where) {
					const err = validateWhere(where);
					if (err) {
						error(err);
						throw new ArbError(err);
					}
				}

				const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache);
				const selectedSet = new Set(selectedRepos);
				let repos = summary.repos.filter((r) => selectedSet.has(r.name));

				// Apply --where filter
				if (where) {
					repos = repos.filter((repo) => {
						const flags = computeFlags(repo, branch);
						return repoMatchesWhere(flags, where);
					});
				}

				if (!options.json && isTTY()) {
					await outputTTY(repos, wsDir, branch, options.stat);
				} else {
					const results = await Promise.all(repos.map((repo) => gatherRepoDiff(repo, wsDir, branch)));
					if (options.json) {
						outputJson(summary.workspace, summary.branch, summary.base, results, options.stat);
					} else {
						await outputPipe(repos, wsDir, results, options.stat);
					}
				}
			},
		);
}

// ── TTY output: delegate to git for diff rendering ────────────────

async function outputTTY(repos: RepoStatus[], wsDir: string, branch: string, stat?: boolean): Promise<void> {
	let totalFiles = 0;
	let totalInsertions = 0;
	let totalDeletions = 0;
	let totalUntracked = 0;

	for (let i = 0; i < repos.length; i++) {
		const repo = repos[i];
		if (!repo) continue;

		const repoDir = `${wsDir}/${repo.name}`;
		const flags = computeFlags(repo, branch);

		if (writeRepoSkipHeader(repo, branch, flags, i >= repos.length - 1)) continue;

		// Resolve the merge-base ref (single ref: compares merge-base to working tree)
		const target = await resolveDiffTarget(repoDir, repo);
		const gitArgs = target ? [target.ref] : [];
		let note = target?.note ?? "";

		if (repo.operation) {
			note = note ? `${note}, ${repo.operation} in progress` : `${repo.operation} in progress`;
		}

		// Track untracked files for hint
		if (repo.local.untracked > 0) {
			totalUntracked += repo.local.untracked;
			const untrackedNote = `${repo.local.untracked} untracked not in diff`;
			note = note ? `${note}, ${untrackedNote}` : untrackedNote;
		}

		// Gather stats for summary
		const numstatResult = await git(repoDir, "diff", "-M", "--numstat", ...gitArgs);
		if (numstatResult.exitCode === 0 && numstatResult.stdout.trim()) {
			const parsed = parseGitNumstat(numstatResult.stdout);
			for (const f of parsed) {
				totalFiles++;
				totalInsertions += f.insertions;
				totalDeletions += f.deletions;
			}
		}

		// Header
		writeRepoHeader(repo.name, note || undefined);

		// Let git render the diff
		const diffArgs = stat
			? ["diff", "-M", "--stat", "--color=always", ...gitArgs]
			: ["diff", "-M", "--color=always", ...gitArgs];
		const result = await git(repoDir, ...diffArgs);
		if (result.exitCode === 0 && result.stdout.trim()) {
			stdout(result.stdout);
		}

		if (i < repos.length - 1) {
			process.stderr.write("\n");
		}
	}

	process.stderr.write("\n");
	let summaryText = `Diffed ${plural(repos.length, "repo")} (${plural(totalFiles, "file")} changed, +${totalInsertions} -${totalDeletions}`;
	if (totalUntracked > 0) {
		summaryText += `; ${plural(totalUntracked, "untracked file")} not in diff`;
	}
	summaryText += ")";
	success(summaryText);
}

// ── Structured gathering for pipe / JSON modes ───────────────────

async function gatherRepoDiff(repo: RepoStatus, wsDir: string, branch: string): Promise<RepoDiffResult> {
	const repoDir = `${wsDir}/${repo.name}`;
	const flags = computeFlags(repo, branch);
	const emptyStat: RepoDiffStat = { files: 0, insertions: 0, deletions: 0 };

	if (flags.isDetached) {
		return {
			name: repo.name,
			status: "detached",
			reason: "HEAD is detached",
			annotation: "detached \u2014 skipping",
			stat: emptyStat,
			fileStat: [],
			untrackedCount: 0,
		};
	}

	if (flags.isDrifted && repo.identity.headMode.kind === "attached") {
		const actual = repo.identity.headMode.branch;
		return {
			name: repo.name,
			status: "drifted",
			reason: `on ${actual}, expected ${branch}`,
			annotation: `on ${actual}, expected ${branch} \u2014 skipping`,
			stat: emptyStat,
			fileStat: [],
			untrackedCount: 0,
		};
	}

	// Resolve the merge-base ref (single ref: compares merge-base to working tree)
	const target = await resolveDiffTarget(repoDir, repo);
	if (!target) {
		return {
			name: repo.name,
			status: "no-base",
			reason: "no base branch resolved",
			annotation: "no base branch, no commits",
			stat: emptyStat,
			fileStat: [],
			untrackedCount: repo.local.untracked,
		};
	}

	// Run numstat
	const result = await git(repoDir, "diff", "-M", "--numstat", target.ref);
	if (result.exitCode !== 0) {
		return {
			name: repo.name,
			status: target.status,
			reason: target.reason,
			annotation: target.note || "diff failed",
			stat: emptyStat,
			fileStat: [],
			untrackedCount: repo.local.untracked,
		};
	}

	const fileStat = parseGitNumstat(result.stdout);
	const stat: RepoDiffStat = fileStat.reduce(
		(acc, f) => {
			acc.files++;
			acc.insertions += f.insertions;
			acc.deletions += f.deletions;
			return acc;
		},
		{ files: 0, insertions: 0, deletions: 0 },
	);

	if (stat.files === 0 && target.status === "ok") {
		return {
			name: repo.name,
			status: "clean",
			annotation: "no changes",
			stat: emptyStat,
			fileStat: [],
			diffRef: target.ref,
			untrackedCount: repo.local.untracked,
		};
	}

	let annotation = `${plural(stat.files, "file")} changed, +${stat.insertions} -${stat.deletions}`;
	if (target.note) {
		annotation = `${target.note}, ${annotation}`;
	}

	if (repo.operation) {
		annotation += `, ${repo.operation} in progress`;
	}

	return {
		name: repo.name,
		status: target.status,
		reason: target.reason,
		annotation,
		stat,
		fileStat,
		diffRef: target.ref,
		untrackedCount: repo.local.untracked,
	};
}

// ── Pipe output ──────────────────────────────────────────────────

async function outputPipe(
	repos: RepoStatus[],
	wsDir: string,
	results: RepoDiffResult[],
	stat?: boolean,
): Promise<void> {
	// Emit skip warnings to stderr
	for (const r of results) {
		if (r.status === "detached" || r.status === "drifted") {
			process.stderr.write(`${r.name}: skipped \u2014 ${r.reason}\n`);
		}
	}

	// Emit untracked hints to stderr
	for (const r of results) {
		if (r.untrackedCount > 0) {
			process.stderr.write(`${r.name}: ${plural(r.untrackedCount, "untracked file")} not in diff\n`);
		}
	}

	// Output diff for each repo
	for (let i = 0; i < results.length; i++) {
		const repo = repos[i];
		const result = results[i];
		if (!repo || !result) continue;
		if (result.status === "detached" || result.status === "drifted" || result.status === "clean") continue;
		if (!result.diffRef) continue;

		const repoDir = `${wsDir}/${repo.name}`;
		const diffArgs = stat ? ["diff", "-M", "--stat", result.diffRef] : ["diff", "-M", result.diffRef];
		const diffResult = await git(repoDir, ...diffArgs);
		if (diffResult.exitCode === 0 && diffResult.stdout.trim()) {
			stdout(diffResult.stdout);
		}
	}
}

// ── JSON output ──────────────────────────────────────────────────

function outputJson(
	workspace: string,
	branch: string,
	base: string | null,
	results: RepoDiffResult[],
	stat?: boolean,
): void {
	let totalFiles = 0;
	let totalInsertions = 0;
	let totalDeletions = 0;
	let totalUntracked = 0;

	const repos: DiffJsonRepo[] = results.map((r) => {
		totalFiles += r.stat.files;
		totalInsertions += r.stat.insertions;
		totalDeletions += r.stat.deletions;
		totalUntracked += r.untrackedCount;

		const entry: DiffJsonRepo = {
			name: r.name,
			status: r.status,
			stat: r.stat,
		};
		if (r.reason) {
			entry.reason = r.reason;
		}
		if (stat && r.fileStat.length > 0) {
			entry.fileStat = r.fileStat;
		}
		if (r.untrackedCount > 0) {
			entry.untrackedCount = r.untrackedCount;
		}
		return entry;
	});

	const output: DiffJsonOutput = {
		workspace,
		branch,
		base,
		repos,
		totalFiles,
		totalInsertions,
		totalDeletions,
	};
	if (totalUntracked > 0) {
		output.totalUntracked = totalUntracked;
	}
	stdout(`${JSON.stringify(output, null, 2)}\n`);
}
