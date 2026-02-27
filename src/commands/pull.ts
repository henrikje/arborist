import { basename } from "node:path";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { reportConflicts, reportStashPopFailures } from "../lib/conflict-report";
import { ArbError } from "../lib/errors";
import {
	getCommitsBetweenFull,
	getDiffShortstat,
	getShortHead,
	git,
	predictMergeConflict,
	predictRebaseConflictCommits,
	predictStashPopConflict,
} from "../lib/git";
import { confirmOrExit, runPlanFlow } from "../lib/mutation-flow";
import {
	dim,
	dryRunNotice,
	error,
	finishSummary,
	info,
	inlineResult,
	inlineStart,
	plural,
	yellow,
} from "../lib/output";
import { formatSkipLine, formatStashHint, formatUpToDateLine } from "../lib/plan-format";
import type { RepoRemotes } from "../lib/remotes";
import { resolveRemotesMap } from "../lib/remotes";
import { resolveRepoSelection, workspaceRepoDirs } from "../lib/repos";
import type { SkipFlag } from "../lib/skip-flags";
import { type RepoStatus, computeFlags, gatherRepoStatus } from "../lib/status";
import { VERBOSE_COMMIT_LIMIT, formatVerboseCommits } from "../lib/status-verbose";
import { readNamesFromStdin } from "../lib/stdin";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";

export interface PullAssessment {
	repo: string;
	repoDir: string;
	outcome: "will-pull" | "up-to-date" | "skip";
	skipReason?: string;
	skipFlag?: SkipFlag;
	behind: number;
	toPush: number;
	rebased: number;
	pullMode: "rebase" | "merge";
	headSha: string;
	conflictPrediction?: "no-conflict" | "clean" | "conflict" | null;
	needsStash?: boolean;
	stashPopConflictFiles?: string[];
	commits?: { shortHash: string; subject: string }[];
	totalCommits?: number;
	diffStats?: { files: number; insertions: number; deletions: number };
	conflictCommits?: { shortHash: string; files: string[] }[];
}

export function registerPullCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("pull [repos...]")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-n, --dry-run", "Show what would happen without executing")
		.option("--rebase", "Pull with rebase")
		.option("--merge", "Pull with merge")
		.option("--autostash", "Stash uncommitted changes before pull, re-apply after")
		.option("-v, --verbose", "Show incoming commits in the plan")
		.summary("Pull the feature branch from the share remote")
		.description(
			"Pull the feature branch for all repos, or only the named repos. Pulls from the share remote (origin by default, or as configured for fork workflows). Fetches in parallel, then shows a plan and asks for confirmation before pulling. Repos with uncommitted changes are skipped unless --autostash is used. Repos that haven't been pushed yet or where the remote branch has been deleted are skipped. If any repos conflict, arb continues with the remaining repos and reports all conflicts at the end. Use --verbose to show the incoming commits for each repo in the plan. Use --autostash to stash uncommitted changes before pulling and re-apply them after.\n\nThe pull mode (rebase or merge) is determined per-repo from git config (branch.<name>.rebase, then pull.rebase), defaulting to merge if neither is set. Use --rebase or --merge to override for all repos.",
		)
		.action(
			async (
				repoArgs: string[],
				options: {
					rebase?: boolean;
					merge?: boolean;
					yes?: boolean;
					dryRun?: boolean;
					verbose?: boolean;
					autostash?: boolean;
				},
			) => {
				if (options.rebase && options.merge) {
					error("Cannot use both --rebase and --merge");
					throw new ArbError("Cannot use both --rebase and --merge");
				}

				const flagMode: "rebase" | "merge" | undefined = options.rebase
					? "rebase"
					: options.merge
						? "merge"
						: undefined;
				const ctx = getCtx();
				const { wsDir, workspace } = requireWorkspace(ctx);
				const branch = await requireBranch(wsDir, workspace);

				let repoNames = repoArgs;
				if (repoNames.length === 0) {
					const stdinNames = await readNamesFromStdin();
					if (stdinNames.length > 0) repoNames = stdinNames;
				}
				const selectedRepos = resolveRepoSelection(wsDir, repoNames);
				const selectedSet = new Set(selectedRepos);
				const remotesMap = await resolveRemotesMap(selectedRepos, ctx.reposDir);
				const configBase = configGet(`${wsDir}/.arbws/config`, "base");

				// Phase 1: fetch
				const allFetchDirs = workspaceRepoDirs(wsDir);
				const allRepos = allFetchDirs.map((d) => basename(d));
				const repos = allRepos.filter((r) => selectedSet.has(r));
				const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
				const autostash = options.autostash === true;

				// Phase 2: assess
				const assess = async (fetchFailed: string[]) => {
					return Promise.all(
						repos.map(async (repo) => {
							const repoDir = `${wsDir}/${repo}`;
							const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, remotesMap.get(repo));
							const headSha = await getShortHead(repoDir);
							const pullMode = flagMode ?? (await detectPullMode(repoDir, branch));
							return assessPullRepo(status, repoDir, branch, fetchFailed, pullMode, autostash, headSha);
						}),
					);
				};

				const postAssess = async (nextAssessments: PullAssessment[]) => {
					await predictPullConflicts(nextAssessments, remotesMap, branch);
					if (options.verbose) {
						await gatherPullVerboseCommits(nextAssessments, remotesMap, branch);
					}
				};

				const assessments = await runPlanFlow({
					fetchDirs,
					reposForFetchReport: repos,
					remotesMap,
					assess,
					postAssess,
					formatPlan: (nextAssessments) => formatPullPlan(nextAssessments, remotesMap, options.verbose),
				});

				const willPull = assessments.filter((a) => a.outcome === "will-pull");
				const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
				const skipped = assessments.filter((a) => a.outcome === "skip");

				if (willPull.length === 0) {
					info(upToDate.length > 0 ? "All repos up to date" : "Nothing to do");
					return;
				}

				if (options.dryRun) {
					dryRunNotice();
					return;
				}

				// Phase 3: confirm
				await confirmOrExit({
					yes: options.yes,
					message: `Pull ${plural(willPull.length, "repo")}?`,
				});

				process.stderr.write("\n");

				// Phase 4: execute
				let pullOk = 0;
				const conflicted: { assessment: PullAssessment; stdout: string; stderr: string }[] = [];
				const stashPopFailed: PullAssessment[] = [];

				for (const a of willPull) {
					inlineStart(a.repo, `pulling (${a.pullMode})`);
					const pullRemote = remotesMap.get(a.repo)?.share;
					if (!pullRemote) continue;

					if (a.pullMode === "rebase") {
						// Rebase mode: pass --autostash to git pull --rebase when needed
						const pullArgs = a.needsStash
							? ["pull", "--rebase", "--autostash", pullRemote, branch]
							: ["pull", "--rebase", pullRemote, branch];
						const pullResult = await git(a.repoDir, ...pullArgs);
						if (pullResult.exitCode === 0) {
							inlineResult(a.repo, `pulled ${plural(a.behind, "commit")} (${a.pullMode})`);
							pullOk++;
						} else {
							inlineResult(a.repo, yellow("conflict"));
							conflicted.push({ assessment: a, stdout: pullResult.stdout, stderr: pullResult.stderr });
						}
					} else {
						// Merge mode: manual stash cycle when needed
						if (a.needsStash) {
							await git(a.repoDir, "stash", "push", "-m", "arb: autostash before pull");
						}
						const pullResult = await git(a.repoDir, "pull", "--no-rebase", pullRemote, branch);
						if (pullResult.exitCode === 0) {
							let stashPopOk = true;
							if (a.needsStash) {
								const popResult = await git(a.repoDir, "stash", "pop");
								if (popResult.exitCode !== 0) {
									stashPopOk = false;
									stashPopFailed.push(a);
								}
							}
							let doneMsg = `pulled ${plural(a.behind, "commit")} (${a.pullMode})`;
							if (!stashPopOk) {
								doneMsg += ` ${yellow("(stash pop failed)")}`;
							}
							inlineResult(a.repo, doneMsg);
							pullOk++;
						} else {
							// Do NOT pop stash if pull conflicted
							inlineResult(a.repo, yellow("conflict"));
							conflicted.push({ assessment: a, stdout: pullResult.stdout, stderr: pullResult.stderr });
						}
					}
				}

				// Consolidated conflict report
				reportConflicts(
					conflicted.map((c) => ({
						repo: c.assessment.repo,
						stdout: c.stdout,
						stderr: c.stderr,
						subcommand: c.assessment.pullMode === "rebase" ? ("rebase" as const) : ("merge" as const),
					})),
				);

				// Stash pop failure report
				reportStashPopFailures(stashPopFailed, "Pull");

				// Phase 5: summary
				process.stderr.write("\n");
				const parts = [`Pulled ${plural(pullOk, "repo")}`];
				if (conflicted.length > 0) parts.push(`${conflicted.length} conflicted`);
				if (stashPopFailed.length > 0) parts.push(`${stashPopFailed.length} stash pop failed`);
				if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
				if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
				finishSummary(parts, conflicted.length > 0 || stashPopFailed.length > 0);
			},
		);
}

export function assessPullRepo(
	status: RepoStatus,
	repoDir: string,
	branch: string,
	fetchFailed: string[],
	pullMode: "rebase" | "merge",
	autostash: boolean,
	headSha: string,
): PullAssessment {
	const base: PullAssessment = {
		repo: status.name,
		repoDir,
		outcome: "skip",
		behind: 0,
		toPush: 0,
		rebased: 0,
		pullMode,
		headSha,
	};

	// Fetch failed for this repo
	if (fetchFailed.includes(status.name)) {
		return { ...base, skipReason: "fetch failed", skipFlag: "fetch-failed" };
	}

	// Branch check — detached or drifted
	if (status.identity.headMode.kind === "detached") {
		return { ...base, skipReason: "HEAD is detached", skipFlag: "detached-head" };
	}
	if (status.identity.headMode.branch !== branch) {
		return {
			...base,
			skipReason: `on branch ${status.identity.headMode.branch}, expected ${branch}`,
			skipFlag: "drifted",
		};
	}

	// Dirty check
	const flags = computeFlags(status, branch);
	if (flags.isDirty) {
		if (!autostash) {
			return { ...base, skipReason: "uncommitted changes (use --autostash)", skipFlag: "dirty" };
		}
		// Only stash if there are staged or modified files (not untracked-only)
		if (status.local.staged > 0 || status.local.modified > 0) {
			base.needsStash = true;
		}
	}

	// Not pushed yet
	if (status.share.refMode === "noRef") {
		return { ...base, skipReason: "not pushed yet", skipFlag: "not-pushed" };
	}

	// Remote branch gone
	if (status.share.refMode === "gone") {
		return { ...base, skipReason: "remote branch gone", skipFlag: "remote-gone" };
	}

	// Base branch merged into default — retarget before pulling
	if (status.base?.baseMergedIntoDefault != null) {
		const baseName = status.base.configuredRef ?? status.base.ref;
		return {
			...base,
			skipReason: `base branch ${baseName} was merged into default (retarget first with 'arb rebase --retarget')`,
			skipFlag: "base-merged-into-default",
		};
	}

	// Already merged into base — but only skip if share has nothing to pull
	// (e.g. on main behind origin/main, mergedIntoBase is set but toPull > 0)
	if (status.base?.mergedIntoBase != null && (status.share.toPull ?? 0) === 0) {
		return { ...base, skipReason: `already merged into ${status.base.ref}`, skipFlag: "already-merged" };
	}

	// Check toPull count
	const toPull = status.share.toPull ?? 0;
	if (toPull === 0) {
		return { ...base, outcome: "up-to-date" };
	}

	// Skip if all to-pull commits are rebased locally
	const rebased = status.share.rebased ?? 0;
	if (rebased > 0 && rebased >= toPull) {
		return { ...base, skipReason: "rebased locally (push --force instead)", skipFlag: "rebased-locally" };
	}

	const toPush = status.share.toPush ?? 0;
	return { ...base, outcome: "will-pull", behind: toPull, toPush, rebased };
}

export function formatPullPlan(
	assessments: PullAssessment[],
	remotesMap: Map<string, RepoRemotes>,
	verbose?: boolean,
): string {
	let out = "\n";
	for (const a of assessments) {
		const remotes = remotesMap.get(a.repo);
		const forkSuffix = remotes && remotes.base !== remotes.share ? ` ← ${remotes.share}` : "";
		const headStr = a.headSha ? `  ${dim(`(HEAD ${a.headSha})`)}` : "";
		if (a.outcome === "will-pull") {
			let conflictHint = "";
			if (a.conflictPrediction === "conflict") {
				conflictHint = `, ${yellow("conflict likely")}`;
			} else if (a.conflictPrediction === "no-conflict") {
				conflictHint = ", no conflict";
			} else if (a.conflictPrediction === "clean") {
				conflictHint = ", conflict unlikely";
			}
			const rebasedHint = a.rebased > 0 ? `, ${a.rebased} rebased` : "";
			const stashHint = formatStashHint(a);
			const mergeType = a.pullMode === "merge" ? (a.toPush === 0 ? ", fast-forward" : ", three-way") : "";
			out += `  ${a.repo}   ${plural(a.behind, "commit")} to pull (${a.pullMode}${mergeType}${rebasedHint}${conflictHint})${stashHint}${forkSuffix}${headStr}\n`;
			if (verbose && a.commits && a.commits.length > 0) {
				const shareRemote = remotes?.share ?? "origin";
				const label = `Incoming from ${shareRemote}:`;
				out += formatVerboseCommits(a.commits, a.totalCommits ?? a.commits.length, label, {
					diffStats: a.diffStats,
					conflictCommits: a.conflictCommits,
				});
			}
		} else if (a.outcome === "up-to-date") {
			out += formatUpToDateLine(a.repo);
		} else {
			out += formatSkipLine(a.repo, a.skipReason ?? "", a.skipFlag);
		}
	}
	out += "\n";
	return out;
}

async function predictPullConflicts(
	assessments: PullAssessment[],
	remotesMap: Map<string, RepoRemotes>,
	branch: string,
): Promise<void> {
	await Promise.all(
		assessments
			.filter((a) => a.outcome === "will-pull")
			.map(async (a) => {
				const shareRemote = remotesMap.get(a.repo)?.share;
				if (!shareRemote) return;
				const ref = `${shareRemote}/${branch}`;
				if (a.behind > 0 && a.toPush > 0) {
					const prediction = await predictMergeConflict(a.repoDir, ref);
					a.conflictPrediction = prediction === null ? null : prediction.hasConflict ? "conflict" : "clean";
					// Per-commit conflict detail for rebase-mode pulls
					if (prediction?.hasConflict && a.pullMode === "rebase") {
						const conflictCommits = await predictRebaseConflictCommits(a.repoDir, ref);
						if (conflictCommits.length > 0) a.conflictCommits = conflictCommits;
					}
				} else {
					a.conflictPrediction = "no-conflict";
				}
				if (a.needsStash) {
					const stashPrediction = await predictStashPopConflict(a.repoDir, ref);
					a.stashPopConflictFiles = stashPrediction.overlapping;
				}
			}),
	);
}

async function gatherPullVerboseCommits(
	assessments: PullAssessment[],
	remotesMap: Map<string, RepoRemotes>,
	branch: string,
): Promise<void> {
	await Promise.all(
		assessments
			.filter((a) => a.outcome === "will-pull")
			.map(async (a) => {
				const shareRemote = remotesMap.get(a.repo)?.share;
				if (!shareRemote) return;
				const ref = `${shareRemote}/${branch}`;
				const commits = await getCommitsBetweenFull(a.repoDir, "HEAD", ref);
				const total = commits.length;
				a.commits = commits.slice(0, VERBOSE_COMMIT_LIMIT).map((c) => ({
					shortHash: c.shortHash,
					subject: c.subject,
				}));
				a.totalCommits = total;

				// Diff stats
				a.diffStats = (await getDiffShortstat(a.repoDir, "HEAD", ref)) ?? undefined;
			}),
	);
}

async function detectPullMode(repoDir: string, branch: string): Promise<"rebase" | "merge"> {
	const branchRebase = await git(repoDir, "config", "--get", `branch.${branch}.rebase`);
	if (branchRebase.exitCode === 0) {
		return branchRebase.stdout.trim() !== "false" ? "rebase" : "merge";
	}
	const pullRebase = await git(repoDir, "config", "--get", "pull.rebase");
	if (pullRebase.exitCode === 0) {
		return pullRebase.stdout.trim() !== "false" ? "rebase" : "merge";
	}
	return "merge";
}
