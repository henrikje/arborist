import confirm from "@inquirer/confirm";
import { configGet, writeConfig } from "./config";
import { getDefaultBranch, getShortHead, git, predictMergeConflict, remoteBranchExists } from "./git";
import {
	clearLines,
	countLines,
	dim,
	dryRunNotice,
	error,
	info,
	inlineResult,
	inlineStart,
	plural,
	skipConfirmNotice,
	success,
	warn,
	yellow,
} from "./output";
import { parallelFetch, reportFetchFailures } from "./parallel-fetch";
import { resolveRemotesMap } from "./remotes";
import { classifyRepos, resolveRepoSelection } from "./repos";
import { type RepoStatus, computeFlags, gatherRepoStatus } from "./status";
import { isTTY } from "./tty";
import type { ArbContext } from "./types";
import { workspaceBranch } from "./workspace-branch";
import { requireBranch, requireWorkspace } from "./workspace-context";

type IntegrateMode = "rebase" | "merge";

interface RepoAssessment {
	repo: string;
	repoDir: string;
	outcome: "will-operate" | "up-to-date" | "skip";
	skipReason?: string;
	baseBranch?: string;
	upstreamRemote: string;
	behind: number;
	ahead: number;
	headSha: string;
	shallow: boolean;
	conflictPrediction?: "clean" | "conflict" | null;
	retargetFrom?: string;
	retargetTo?: string;
}

export async function integrate(
	ctx: ArbContext,
	mode: IntegrateMode,
	options: { fetch?: boolean; yes?: boolean; dryRun?: boolean; retarget?: boolean },
	repoArgs: string[],
): Promise<void> {
	const verb = mode === "rebase" ? "Rebase" : "Merge";
	const verbed = mode === "rebase" ? "Rebased" : "Merged";
	const retarget = options.retarget === true && mode === "rebase";

	// Phase 1: context & repo selection
	const { wsDir, workspace } = requireWorkspace(ctx);
	const branch = await requireBranch(wsDir, workspace);
	const configBase = configGet(`${wsDir}/.arbws/config`, "base");

	const selectedRepos = resolveRepoSelection(wsDir, repoArgs);

	// Resolve remotes for all repos
	const remotesMap = await resolveRemotesMap(selectedRepos, ctx.reposDir);

	// Phase 2: classify and fetch
	const shouldFetch = options.fetch !== false;
	const { repos, fetchDirs, localRepos } = await classifyRepos(wsDir, ctx.reposDir);
	const canTwoPhase = shouldFetch && fetchDirs.length > 0 && isTTY();

	const assess = async (fetchFailed: string[]) => {
		const assessments: RepoAssessment[] = [];
		for (const repo of selectedRepos) {
			const repoDir = `${wsDir}/${repo}`;
			const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, remotesMap.get(repo));
			assessments.push(await assessRepo(status, repoDir, branch, fetchFailed, retarget));
		}
		return assessments;
	};

	let assessments: RepoAssessment[];

	if (canTwoPhase) {
		// Two-phase: render stale plan immediately, re-render after fetch
		const fetchPromise = parallelFetch(fetchDirs, undefined, remotesMap, { silent: true });

		assessments = await assess([]);
		const stalePlan = formatIntegratePlan(assessments, mode, branch);
		const fetchingLine = `${dim(`Fetching ${plural(fetchDirs.length, "repo")}...`)}\n`;
		const staleOutput = stalePlan + fetchingLine;
		process.stderr.write(staleOutput);

		const fetchResults = await fetchPromise;

		// Compute fetch failures silently (no stderr output yet)
		const fetchFailed = getFetchFailedRepos(repos, localRepos, fetchResults);

		// Re-assess with fresh refs and predict conflicts
		assessments = await assess(fetchFailed);
		await predictIntegrateConflicts(assessments);
		const freshPlan = formatIntegratePlan(assessments, mode, branch);
		clearLines(countLines(staleOutput));
		process.stderr.write(freshPlan);

		reportFetchFailures(repos, localRepos, fetchResults);
	} else if (shouldFetch && fetchDirs.length > 0) {
		// Fallback: fetch with visible progress, then assess
		const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
		const fetchFailed = reportFetchFailures(repos, localRepos, fetchResults);
		assessments = await assess(fetchFailed);
		await predictIntegrateConflicts(assessments);
		process.stderr.write(formatIntegratePlan(assessments, mode, branch));
	} else {
		// No fetch needed
		assessments = await assess([]);
		await predictIntegrateConflicts(assessments);
		process.stderr.write(formatIntegratePlan(assessments, mode, branch));
	}

	// Phase 4: confirm
	const willOperate = assessments.filter((a) => a.outcome === "will-operate");
	const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
	const skipped = assessments.filter((a) => a.outcome === "skip");

	if (willOperate.length === 0) {
		info(upToDate.length > 0 ? "All repos up to date" : "Nothing to do");
		return;
	}

	if (options.dryRun) {
		dryRunNotice();
		return;
	}

	if (!options.yes) {
		if (!isTTY()) {
			error("Not a terminal. Use --yes to skip confirmation.");
			process.exit(1);
		}
		const ok = await confirm(
			{
				message: `${verb} ${plural(willOperate.length, "repo")}?`,
				default: false,
			},
			{ output: process.stderr },
		);
		if (!ok) {
			process.stderr.write("Aborted.\n");
			process.exit(130);
		}
	} else {
		skipConfirmNotice("--yes");
	}

	process.stderr.write("\n");

	// Phase 5: execute sequentially
	let succeeded = 0;
	const conflicted: { assessment: RepoAssessment; stdout: string }[] = [];
	for (const a of willOperate) {
		const ref = `${a.upstreamRemote}/${a.baseBranch}`;

		let result: { exitCode: number; stdout: string };
		if (a.retargetFrom) {
			const remoteRefExists = await remoteBranchExists(a.repoDir, a.retargetFrom, a.upstreamRemote);
			const oldBaseRef = remoteRefExists ? `${a.upstreamRemote}/${a.retargetFrom}` : a.retargetFrom;
			const progressMsg = `rebasing ${branch} onto ${ref} from ${a.retargetFrom} (retarget)`;
			inlineStart(a.repo, progressMsg);
			result = await git(a.repoDir, "rebase", "--onto", ref, oldBaseRef);
		} else {
			const progressMsg = mode === "rebase" ? `rebasing ${branch} onto ${ref}` : `merging ${ref} into ${branch}`;
			inlineStart(a.repo, progressMsg);
			result = await git(a.repoDir, mode, ref);
		}

		if (result.exitCode === 0) {
			let doneMsg: string;
			if (a.retargetFrom) {
				doneMsg = `rebased ${branch} onto ${ref} from ${a.retargetFrom} (retarget)`;
			} else {
				doneMsg = mode === "rebase" ? `rebased ${branch} onto ${ref}` : `merged ${ref} into ${branch}`;
			}
			inlineResult(a.repo, doneMsg);
			succeeded++;
		} else {
			inlineResult(a.repo, yellow("conflict"));
			conflicted.push({ assessment: a, stdout: result.stdout });
		}
	}

	// Consolidated conflict report
	if (conflicted.length > 0) {
		const subcommand = mode === "rebase" ? "rebase" : "merge";
		process.stderr.write(`\n  ${conflicted.length} repo(s) have conflicts:\n`);
		for (const { assessment: a, stdout: gitStdout } of conflicted) {
			process.stderr.write(`\n    ${a.repo}\n`);
			for (const line of gitStdout.split("\n").filter((l) => l.startsWith("CONFLICT"))) {
				process.stderr.write(`      ${dim(line)}\n`);
			}
			process.stderr.write(`      cd ${a.repo}\n`);
			process.stderr.write(`      # fix conflicts, then: git ${subcommand} --continue\n`);
			process.stderr.write(`      # or to undo: git ${subcommand} --abort\n`);
		}
	}

	// Update config after successful retarget
	const retargetAssessments = willOperate.filter((a) => a.retargetTo);
	if (retargetAssessments.length > 0 && conflicted.length === 0) {
		const retargetTo = retargetAssessments[0]?.retargetTo;
		if (retargetTo) {
			const configFile = `${wsDir}/.arbws/config`;
			// Resolve the repo's default branch to check if retargetTo matches
			// If retargeting to the default branch, remove the base key
			const wb = await workspaceBranch(wsDir);
			const wsBranch = wb?.branch ?? branch;
			writeConfig(configFile, wsBranch, undefined);
		}
	}

	// Phase 6: summary
	process.stderr.write("\n");
	const retargetedCount = willOperate.filter(
		(a) => a.retargetFrom && !conflicted.some((c) => c.assessment === a),
	).length;
	const normalCount = succeeded - retargetedCount;
	const parts: string[] = [];
	if (retargetedCount > 0) parts.push(`Retargeted ${plural(retargetedCount, "repo")}`);
	if (normalCount > 0 || retargetedCount === 0) parts.push(`${verbed} ${plural(normalCount, "repo")}`);
	if (conflicted.length > 0) parts.push(`${conflicted.length} conflicted`);
	if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
	if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
	if (conflicted.length > 0) {
		warn(parts.join(", "));
		process.exit(1);
	} else {
		success(parts.join(", "));
	}
}

function formatIntegratePlan(assessments: RepoAssessment[], mode: IntegrateMode, branch: string): string {
	let out = "\n";
	for (const a of assessments) {
		if (a.outcome === "will-operate") {
			const baseRef = `${a.upstreamRemote}/${a.baseBranch}`;

			if (a.retargetFrom) {
				// Retarget display
				out += `  ${a.repo}   rebase onto ${baseRef} from ${a.retargetFrom} (retarget)`;
				const headStr = a.headSha ? `  ${dim(`(HEAD ${a.headSha})`)}` : "";
				out += `${headStr}\n`;
			} else {
				const diffParts = [a.behind > 0 && `${a.behind} behind`, a.ahead > 0 && `${a.ahead} ahead`]
					.filter(Boolean)
					.join(", ");
				const diffStr = diffParts ? ` \u2014 ${diffParts}` : "";
				const mergeType = mode === "merge" ? (a.ahead === 0 ? " (fast-forward)" : " (three-way)") : "";
				const action =
					mode === "rebase" ? `rebase ${branch} onto ${baseRef}` : `merge ${baseRef} into ${branch}${mergeType}`;
				let conflictHint = "";
				if (a.conflictPrediction === "conflict") {
					conflictHint = mode === "merge" ? ` ${yellow("(will conflict)")}` : ` ${yellow("(conflict likely)")}`;
				} else if (a.conflictPrediction === "clean") {
					conflictHint = mode === "merge" ? " (no conflict)" : " (conflict unlikely)";
				}
				const headStr = a.headSha ? `  ${dim(`(HEAD ${a.headSha})`)}` : "";
				out += `  ${a.repo}   ${action}${diffStr}${conflictHint}${headStr}\n`;
			}
		} else if (a.outcome === "up-to-date") {
			out += `  ${a.repo}   up to date\n`;
		} else {
			out += `  ${yellow(`${a.repo}   skipped \u2014 ${a.skipReason}`)}\n`;
		}
	}

	// Shallow clone warnings (included in plan block so they get cleared on re-render)
	const shallowRepos = assessments.filter((a) => a.shallow);
	if (shallowRepos.length > 0) {
		out += "\n";
		for (const a of shallowRepos) {
			out += `${yellow(`  ${a.repo} is a shallow clone; ahead/behind counts may be inaccurate and ${mode} may fail if the merge base is beyond the shallow boundary`)}\n`;
		}
	}

	out += "\n";
	return out;
}

async function predictIntegrateConflicts(assessments: RepoAssessment[]): Promise<void> {
	await Promise.all(
		assessments
			.filter((a) => a.outcome === "will-operate" && !a.retargetFrom)
			.map(async (a) => {
				if (a.ahead > 0 && a.behind > 0) {
					const ref = `${a.upstreamRemote}/${a.baseBranch}`;
					const prediction = await predictMergeConflict(a.repoDir, ref);
					a.conflictPrediction = prediction === null ? null : prediction.hasConflict ? "conflict" : "clean";
				} else {
					a.conflictPrediction = "clean";
				}
			}),
	);
}

function getFetchFailedRepos(
	repos: string[],
	localRepos: string[],
	results: Map<string, { exitCode: number; output: string }>,
): string[] {
	return repos
		.filter((repo) => !localRepos.includes(repo))
		.filter((repo) => {
			const fr = results.get(repo);
			return !fr || fr.exitCode !== 0;
		});
}

async function assessRepo(
	status: RepoStatus,
	repoDir: string,
	branch: string,
	fetchFailed: string[],
	retarget = false,
): Promise<RepoAssessment> {
	const upstreamRemote = status.base?.remote ?? "origin";

	const headSha = await getShortHead(repoDir);

	const base: RepoAssessment = {
		repo: status.name,
		repoDir,
		outcome: "skip",
		behind: 0,
		ahead: 0,
		upstreamRemote,
		headSha,
		shallow: status.identity.shallow,
	};

	// Local repo — no remote
	if (status.share === null) {
		return { ...base, skipReason: "local repo" };
	}

	// Fetch failed for this repo
	if (fetchFailed.includes(status.name)) {
		return { ...base, skipReason: "fetch failed" };
	}

	// Operation in progress
	if (status.operation !== null) {
		return { ...base, skipReason: `${status.operation} in progress` };
	}

	// Branch check — detached or drifted
	if (status.identity.headMode.kind === "detached") {
		return { ...base, skipReason: "HEAD is detached" };
	}
	if (status.identity.headMode.branch !== branch) {
		return { ...base, skipReason: `on branch ${status.identity.headMode.branch}, expected ${branch}` };
	}

	// Dirty check
	const flags = computeFlags(status, branch);
	if (flags.isDirty) {
		return { ...base, skipReason: "uncommitted changes" };
	}

	// No base branch resolved
	if (status.base === null) {
		return { ...base, skipReason: "no base branch" };
	}

	// Stacked base branch has been merged into default
	if (status.base.baseMergedIntoDefault != null) {
		if (!retarget) {
			return {
				...base,
				skipReason: `base branch ${status.base.configuredRef ?? status.base.ref} was merged into default (use --retarget)`,
			};
		}

		// Resolve the true default branch for retarget
		const trueDefault = await getDefaultBranch(repoDir, upstreamRemote);
		if (!trueDefault) {
			return { ...base, skipReason: "cannot resolve default branch for retarget" };
		}

		// For squash-merged repos, check if already retargeted
		if (status.base.baseMergedIntoDefault === "squash") {
			const defaultRef = `${upstreamRemote}/${trueDefault}`;
			const alreadyOnDefault = await git(repoDir, "merge-base", "--is-ancestor", defaultRef, "HEAD");
			if (alreadyOnDefault.exitCode === 0) {
				return { ...base, outcome: "up-to-date", baseBranch: trueDefault };
			}
		}

		return {
			...base,
			outcome: "will-operate",
			baseBranch: trueDefault,
			retargetFrom: status.base.configuredRef ?? status.base.ref,
			retargetTo: trueDefault,
			behind: status.base.behind,
			ahead: status.base.ahead,
		};
	}

	// Up-to-date or will-operate
	if (status.base.behind === 0) {
		return { ...base, outcome: "up-to-date", baseBranch: status.base.ref, behind: 0, ahead: status.base.ahead };
	}

	return {
		...base,
		outcome: "will-operate",
		baseBranch: status.base.ref,
		behind: status.base.behind,
		ahead: status.base.ahead,
	};
}
