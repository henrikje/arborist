import { basename } from "node:path";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { git, parseGitNumstat } from "../lib/git";
import type { DiffJsonFileStat, DiffJsonOutput, DiffJsonRepo } from "../lib/json-types";
import { bold, dim, error, plural, stdout, success, yellow } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { resolveRemotesMap } from "../lib/remotes";
import { resolveRepoSelection, workspaceRepoDirs } from "../lib/repos";
import {
	type RepoStatus,
	baseRef,
	computeFlags,
	gatherRepoStatus,
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
		.option("-F, --fetch", "Fetch from all remotes before showing diff")
		.option("--no-fetch", "Skip fetching (default)", false)
		.option("--stat", "Show diffstat summary instead of full diff")
		.option("--json", "Output structured JSON to stdout")
		.option("-d, --dirty", "Only diff dirty repos (shorthand for --where dirty)")
		.option("-w, --where <filter>", "Only diff repos matching status filter (comma = OR, + = AND, ^ = negate)")
		.summary("Show feature branch diff across repos")
		.description(
			"Show the cumulative diff of the feature branch since diverging from the base branch across all repos in the workspace. Answers 'what has this feature branch changed?' by showing the total change set.\n\nDiffs from the merge-base to the working tree, so the output includes committed, staged, and unstaged changes to tracked files — the complete change set of the feature branch. Use -F/--fetch to fetch before showing diff (skip with --no-fetch). Use --stat for a summary of changed files. Use --json for machine-readable output.\n\nRepos are positional arguments — name specific repos to filter, or omit to show all. Use --where to filter by status flags (comma = OR, + = AND; e.g. --where dirty+unpushed). Prefix any term with ^ to negate (e.g. --where ^dirty). Skipped repos (detached HEAD, wrong branch) are explained in the output, never silently omitted.",
		)
		.action(
			async (
				repoArgs: string[],
				options: { stat?: boolean; json?: boolean; dirty?: boolean; where?: string; fetch?: boolean },
			) => {
				const ctx = getCtx();
				const { wsDir, workspace } = requireWorkspace(ctx);
				const branch = await requireBranch(wsDir, workspace);

				if (options.fetch) {
					const fetchDirs = workspaceRepoDirs(wsDir);
					const repos = fetchDirs.map((d) => basename(d));
					const remotesMap = await resolveRemotesMap(repos, ctx.reposDir);
					const results = await parallelFetch(fetchDirs, undefined, remotesMap);
					const failed = reportFetchFailures(repos, results);
					if (failed.length > 0) process.exit(1);
				}

				let repoNames = repoArgs;
				if (repoNames.length === 0) {
					const stdinNames = await readNamesFromStdin();
					if (stdinNames.length > 0) repoNames = stdinNames;
				}
				const selectedRepos = resolveRepoSelection(wsDir, repoNames);

				// Resolve --dirty as shorthand for --where dirty
				if (options.dirty && options.where) {
					error("Cannot combine --dirty with --where. Use --where dirty,... instead.");
					process.exit(1);
				}
				const where = options.dirty ? "dirty" : options.where;

				if (where) {
					const err = validateWhere(where);
					if (err) {
						error(err);
						process.exit(1);
					}
				}

				const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir);
				const selectedSet = new Set(selectedRepos);
				let repos = summary.repos.filter((r) => selectedSet.has(r.name));

				// Apply --where filter
				if (where) {
					const configBase = configGet(`${wsDir}/.arbws/config`, "base");
					const filterResults = await Promise.all(
						repos.map(async (repo) => {
							const repoDir = `${wsDir}/${repo.name}`;
							const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase);
							const flags = computeFlags(status, branch);
							return { repo, matches: repoMatchesWhere(flags, where) };
						}),
					);
					repos = filterResults.filter((r) => r.matches).map((r) => r.repo);
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

	for (let i = 0; i < repos.length; i++) {
		const repo = repos[i];
		if (!repo) continue;

		const repoDir = `${wsDir}/${repo.name}`;
		const flags = computeFlags(repo, branch);

		// Detached HEAD — skip
		if (flags.isDetached) {
			process.stderr.write(`${bold(`==> ${repo.name} <==`)} ${yellow("detached \u2014 skipping")}\n`);
			if (i < repos.length - 1) process.stderr.write("\n");
			continue;
		}

		// Drifted branch — skip
		if (flags.isDrifted && repo.identity.headMode.kind === "attached") {
			const actual = repo.identity.headMode.branch;
			process.stderr.write(
				`${bold(`==> ${repo.name} <==`)} ${yellow(`on ${actual}, expected ${branch} \u2014 skipping`)}\n`,
			);
			if (i < repos.length - 1) process.stderr.write("\n");
			continue;
		}

		// Resolve the merge-base ref (single ref: compares merge-base to working tree)
		const target = await resolveDiffTarget(repoDir, repo);
		const gitArgs = target ? [target.ref] : [];
		let note = target?.note ?? "";

		if (repo.operation) {
			note = note ? `${note}, ${repo.operation} in progress` : `${repo.operation} in progress`;
		}

		// Gather stats for summary
		const numstatResult = await git(repoDir, "diff", "--numstat", ...gitArgs);
		if (numstatResult.exitCode === 0 && numstatResult.stdout.trim()) {
			const parsed = parseGitNumstat(numstatResult.stdout);
			for (const f of parsed) {
				totalFiles++;
				totalInsertions += f.insertions;
				totalDeletions += f.deletions;
			}
		}

		// Header
		const header = bold(`==> ${repo.name} <==`);
		process.stderr.write(note ? `${header} ${dim(note)}\n` : `${header}\n`);

		// Let git render the diff
		const diffArgs = stat ? ["diff", "--stat", "--color=always", ...gitArgs] : ["diff", "--color=always", ...gitArgs];
		const result = await git(repoDir, ...diffArgs);
		if (result.exitCode === 0 && result.stdout.trim()) {
			stdout(result.stdout);
		}

		if (i < repos.length - 1) {
			process.stderr.write("\n");
		}
	}

	process.stderr.write("\n");
	success(
		`Diffed ${plural(repos.length, "repo")} (${plural(totalFiles, "file")} changed, +${totalInsertions} -${totalDeletions})`,
	);
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
		};
	}

	// Run numstat
	const result = await git(repoDir, "diff", "--numstat", target.ref);
	if (result.exitCode !== 0) {
		return {
			name: repo.name,
			status: target.status,
			reason: target.reason,
			annotation: target.note || "diff failed",
			stat: emptyStat,
			fileStat: [],
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

	// Output diff for each repo
	for (let i = 0; i < results.length; i++) {
		const repo = repos[i];
		const result = results[i];
		if (!repo || !result) continue;
		if (result.status === "detached" || result.status === "drifted" || result.status === "clean") continue;
		if (!result.diffRef) continue;

		const repoDir = `${wsDir}/${repo.name}`;
		const diffArgs = stat ? ["diff", "--stat", result.diffRef] : ["diff", result.diffRef];
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

	const repos: DiffJsonRepo[] = results.map((r) => {
		totalFiles += r.stat.files;
		totalInsertions += r.stat.insertions;
		totalDeletions += r.stat.deletions;

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
	stdout(`${JSON.stringify(output, null, 2)}\n`);
}
