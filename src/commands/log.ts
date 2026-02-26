import { basename } from "node:path";
import type { Command } from "commander";
import { ArbError } from "../lib/errors";
import { getCommitsBetweenFull, git } from "../lib/git";
import type { LogJsonOutput, LogJsonRepo } from "../lib/json-types";
import { bold, dim, error, plural, stdout, success, yellow } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { resolveRemotesMap } from "../lib/remotes";
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

interface LogCommit {
	shortHash: string;
	fullHash: string;
	subject: string;
}

type RepoLogStatus = "ok" | "detached" | "drifted" | "no-base" | "fallback-base";

interface RepoLogResult {
	name: string;
	status: RepoLogStatus;
	reason?: string;
	annotation: string;
	commits: LogCommit[];
}

const NO_BASE_FALLBACK_LIMIT = 10;

export function registerLogCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("log [repos...]")
		.option("-F, --fetch", "Fetch from all remotes before showing log")
		.option("--no-fetch", "Skip fetching (default)")
		.option("-n, --max-count <count>", "Limit commits shown per repo")
		.option("-d, --dirty", "Only log dirty repos (shorthand for --where dirty)")
		.option("-w, --where <filter>", "Only log repos matching status filter (comma = OR, + = AND, ^ = negate)")
		.option("--json", "Output structured JSON to stdout")
		.summary("Show feature branch commits across repos")
		.description(
			"Show commits on the feature branch since diverging from the base branch across all repos in the workspace. Answers 'what have I done in this workspace?' by showing only the commits that belong to the current feature.\n\nShows commits in the range base..HEAD for each repo. Use -F/--fetch to fetch before showing log (skip with --no-fetch). Use -n to limit how many commits are shown per repo. Use --json for machine-readable output.\n\nRepos are positional arguments — name specific repos to filter, or omit to show all. Reads repo names from stdin when piped (one per line). Use --where to filter by status flags (comma = OR, + = AND; e.g. --where dirty+unpushed). Prefix any term with ^ to negate (e.g. --where ^dirty). Skipped repos (detached HEAD, wrong branch) are explained in the output, never silently omitted.",
		)
		.action(
			async (
				repoArgs: string[],
				options: { maxCount?: string; json?: boolean; dirty?: boolean; where?: string; fetch?: boolean },
			) => {
				const ctx = getCtx();
				const { wsDir, workspace } = requireWorkspace(ctx);
				const branch = await requireBranch(wsDir, workspace);

				let repoNames = repoArgs;
				if (repoNames.length === 0) {
					const stdinNames = await readNamesFromStdin();
					if (stdinNames.length > 0) repoNames = stdinNames;
				}
				const selectedRepos = resolveRepoSelection(wsDir, repoNames);

				if (options.fetch) {
					const allFetchDirs = workspaceRepoDirs(wsDir);
					const selectedSet = new Set(selectedRepos);
					const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
					const repos = fetchDirs.map((d) => basename(d));
					const remotesMap = await resolveRemotesMap(repos, ctx.reposDir);
					const results = await parallelFetch(fetchDirs, undefined, remotesMap);
					const failed = reportFetchFailures(repos, results);
					if (failed.length > 0) {
						error("Aborting due to fetch failures.");
						throw new ArbError("Aborting due to fetch failures.");
					}
				}
				const maxCount = options.maxCount ? Number.parseInt(options.maxCount, 10) : undefined;

				if (maxCount !== undefined && (Number.isNaN(maxCount) || maxCount < 1)) {
					error("--max-count must be a positive integer");
					throw new ArbError("--max-count must be a positive integer");
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

				const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir);
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
					await outputTTY(repos, wsDir, branch, maxCount);
				} else {
					const results = await Promise.all(repos.map((repo) => gatherRepoLog(repo, wsDir, branch, maxCount)));
					if (options.json) {
						outputJson(summary.workspace, summary.branch, summary.base, results);
					} else {
						outputPipe(results);
					}
				}
			},
		);
}

// ── TTY output: delegate to git for commit rendering ─────────────

async function outputTTY(repos: RepoStatus[], wsDir: string, branch: string, maxCount?: number): Promise<void> {
	let totalCommits = 0;

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

		// Build git log args
		const gitArgs: string[] = [];
		let note = "";

		if (!repo.base) {
			gitArgs.push("-n", `${maxCount ?? NO_BASE_FALLBACK_LIMIT}`, "HEAD");
			note = "no base branch, showing recent";
		} else {
			const baseFellBack = repo.base.configuredRef != null && repo.base.baseMergedIntoDefault == null;
			const ref = baseRef(repo.base);
			gitArgs.push(`${ref}..HEAD`);
			if (maxCount !== undefined) {
				gitArgs.push("-n", `${maxCount}`);
			}
			if (baseFellBack) {
				note = `base ${repo.base.configuredRef} not found, showing against ${repo.base.ref}`;
			}
		}

		if (repo.operation) {
			note = note ? `${note}, ${repo.operation} in progress` : `${repo.operation} in progress`;
		}

		// Header
		const header = bold(`==> ${repo.name} <==`);
		process.stderr.write(note ? `${header} ${dim(note)}\n` : `${header}\n`);

		// Let git render the commits
		const result = await git(repoDir, "log", "--oneline", "--no-decorate", "--color=always", ...gitArgs);
		if (result.exitCode === 0 && result.stdout.trim()) {
			stdout(result.stdout);
			totalCommits += result.stdout.trim().split("\n").length;
		}

		if (i < repos.length - 1) {
			process.stderr.write("\n");
		}
	}

	process.stderr.write("\n");
	success(`Logged ${plural(repos.length, "repo")} (${plural(totalCommits, "commit")})`);
}

// ── Structured gathering for pipe / JSON modes ───────────────────

async function gatherRepoLog(
	repo: RepoStatus,
	wsDir: string,
	branch: string,
	maxCount?: number,
): Promise<RepoLogResult> {
	const repoDir = `${wsDir}/${repo.name}`;
	const flags = computeFlags(repo, branch);

	if (flags.isDetached) {
		return {
			name: repo.name,
			status: "detached",
			reason: "HEAD is detached",
			annotation: "detached \u2014 skipping",
			commits: [],
		};
	}

	if (flags.isDrifted && repo.identity.headMode.kind === "attached") {
		const actual = repo.identity.headMode.branch;
		return {
			name: repo.name,
			status: "drifted",
			reason: `on ${actual}, expected ${branch}`,
			annotation: `on ${actual}, expected ${branch} \u2014 skipping`,
			commits: [],
		};
	}

	if (!repo.base) {
		const limit = maxCount ?? NO_BASE_FALLBACK_LIMIT;
		const commits = await getRecentCommits(repoDir, limit);
		return {
			name: repo.name,
			status: "no-base",
			reason: "no base branch resolved",
			annotation: `no base branch, showing ${commits.length} recent`,
			commits,
		};
	}

	const baseFellBack = repo.base.configuredRef != null && repo.base.baseMergedIntoDefault == null;
	const ref = baseRef(repo.base);
	let commits = await getCommitsBetweenFull(repoDir, ref, "HEAD");

	if (maxCount !== undefined && commits.length > maxCount) {
		commits = commits.slice(0, maxCount);
	}

	let annotation: string;
	if (baseFellBack) {
		annotation = `base ${repo.base.configuredRef ?? ""} not found, showing against ${repo.base.ref}`;
	} else if (commits.length === 0) {
		annotation = "no commits ahead of base";
	} else {
		annotation = plural(commits.length, "commit");
	}

	if (repo.operation) {
		annotation += `, ${repo.operation} in progress`;
	}

	return {
		name: repo.name,
		status: baseFellBack ? "fallback-base" : "ok",
		reason: baseFellBack ? `base ${repo.base.configuredRef} not found, using ${repo.base.ref}` : undefined,
		annotation,
		commits,
	};
}

async function getRecentCommits(repoDir: string, limit: number): Promise<LogCommit[]> {
	const result = await git(repoDir, "log", "--format=%h %H %s", "-n", `${limit}`, "HEAD");
	if (result.exitCode !== 0) return [];
	return result.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const first = line.indexOf(" ");
			const second = line.indexOf(" ", first + 1);
			return {
				shortHash: line.slice(0, first),
				fullHash: line.slice(first + 1, second),
				subject: line.slice(second + 1),
			};
		});
}

// ── Pipe output ──────────────────────────────────────────────────

function outputPipe(results: RepoLogResult[]): void {
	for (const r of results) {
		if (r.status === "detached" || r.status === "drifted") {
			process.stderr.write(`${r.name}: skipped \u2014 ${r.reason}\n`);
		}
	}

	for (const r of results) {
		if (r.status === "detached" || r.status === "drifted") continue;
		for (const c of r.commits) {
			stdout(`${r.name}\t${c.shortHash}\t${c.subject}\n`);
		}
	}
}

// ── JSON output ──────────────────────────────────────────────────

function outputJson(workspace: string, branch: string, base: string | null, results: RepoLogResult[]): void {
	let totalCommits = 0;
	const repos: LogJsonRepo[] = results.map((r) => {
		totalCommits += r.commits.length;
		const entry: LogJsonRepo = {
			name: r.name,
			status: r.status,
			commits: r.commits.map((c) => ({
				hash: c.fullHash,
				shortHash: c.shortHash,
				subject: c.subject,
			})),
		};
		if (r.reason) {
			entry.reason = r.reason;
		}
		return entry;
	});

	const output: LogJsonOutput = { workspace, branch, base, repos, totalCommits };
	stdout(`${JSON.stringify(output, null, 2)}\n`);
}
